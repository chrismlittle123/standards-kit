 
import { execa } from "execa";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";

/** Bypass actor configuration */
interface BypassActorConfig {
  actor_type: "Integration" | "OrganizationAdmin" | "RepositoryRole" | "Team" | "DeployKey";
  actor_id?: number;
  bypass_mode?: "always" | "pull_request";
}

/** Ruleset configuration (uses GitHub Rulesets API) */
interface RulesetConfig {
  name?: string;
  branch?: string;
  enforcement?: "active" | "evaluate" | "disabled";
  required_reviews?: number;
  dismiss_stale_reviews?: boolean;
  require_code_owner_reviews?: boolean;
  require_status_checks?: string[];
  require_branches_up_to_date?: boolean;
  require_signed_commits?: boolean;
  enforce_admins?: boolean;
  bypass_actors?: BypassActorConfig[];
}

/** Tag protection configuration */
interface TagProtectionConfig {
  patterns?: string[];
  prevent_deletion?: boolean;
  prevent_update?: boolean;
}

/** Repository configuration */
interface RepoConfig {
  enabled?: boolean;
  require_branch_protection?: boolean;
  require_codeowners?: boolean;
  ruleset?: RulesetConfig;
  tag_protection?: TagProtectionConfig;
}

/** GitHub Ruleset bypass actor */
interface RulesetBypassActor {
  actor_id: number | null;
  actor_type: string;
  bypass_mode: string;
}

/** GitHub Ruleset rule */
interface RulesetRule {
  type: string;
  parameters?: {
    required_approving_review_count?: number;
    dismiss_stale_reviews_on_push?: boolean;
    require_code_owner_review?: boolean;
    required_status_checks?: { context: string }[];
    strict_required_status_checks_policy?: boolean;
  };
}

/** GitHub Ruleset response */
interface RulesetResponse {
  id: number;
  name: string;
  target: string;
  enforcement: string;
  conditions?: { ref_name?: { include?: string[]; exclude?: string[] } };
  bypass_actors?: RulesetBypassActor[];
  rules?: RulesetRule[];
}

/** Runner for repository settings validation */
export class RepoRunner extends BaseProcessToolRunner {
  readonly name = "Repository";
  readonly rule = "process.repo";
  readonly toolId = "repo";
  private config: RepoConfig = {
    enabled: false,
    require_branch_protection: false,
    require_codeowners: false,
  };

  setConfig(config: RepoConfig): void {
    this.config = { ...this.config, ...config };
  }

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    if (!(await this.isGhCliAvailable())) {
      return this.skip("GitHub CLI (gh) not available", elapsed());
    }
    const repoInfo = await this.getRepoInfo(projectRoot);
    if (!repoInfo) {
      return this.skip("Could not determine GitHub repository from git remote", elapsed());
    }

    const violations = await this.collectViolations(projectRoot, repoInfo);
    return this.fromViolations(violations, elapsed());
  }

  private async collectViolations(
    projectRoot: string,
    repoInfo: { owner: string; repo: string }
  ): Promise<Violation[]> {
    const violations: Violation[] = [];
    if (this.config.require_codeowners) {
      violations.push(...this.checkCodeowners(projectRoot));
    }
    if (this.config.require_branch_protection || this.config.ruleset) {
      violations.push(...(await this.checkBranchProtection(repoInfo)));
    }
    if (this.config.tag_protection?.patterns?.length) {
      violations.push(...(await this.checkTagProtection(repoInfo)));
    }
    return violations;
  }

  private async isGhCliAvailable(): Promise<boolean> {
    try {
      await execa("gh", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  private async getRepoInfo(projectRoot: string): Promise<{ owner: string; repo: string } | null> {
    try {
      // Use gh to get the current repo
      const result = await execa("gh", ["repo", "view", "--json", "owner,name"], {
        cwd: projectRoot,
      });
      const data = JSON.parse(result.stdout) as { owner: { login: string }; name: string };
      return { owner: data.owner.login, repo: data.name };
    } catch {
      return null;
    }
  }

  private checkCodeowners(projectRoot: string): Violation[] {
    const locations = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"];
    if (locations.some((loc) => this.fileExists(projectRoot, loc))) {
      return [];
    }
    return [
      {
        rule: `${this.rule}.codeowners`,
        tool: this.toolId,
        severity: "error",
        message:
          "CODEOWNERS file not found (checked CODEOWNERS, .github/CODEOWNERS, docs/CODEOWNERS)",
      },
    ];
  }

  private async checkBranchProtection(repoInfo: {
    owner: string;
    repo: string;
  }): Promise<Violation[]> {
    const rulesetConfig = this.config.ruleset;
    const branch = rulesetConfig?.branch ?? "main";

    try {
      const result = await execa("gh", [
        "api",
        `repos/${repoInfo.owner}/${repoInfo.repo}/rulesets`,
      ]);

      const rulesets = JSON.parse(result.stdout) as RulesetResponse[];
      const branchRuleset = this.findBranchRuleset(rulesets, branch);

      if (!branchRuleset) {
        return this.handleNoBranchRuleset(branch);
      }

      return this.validateBranchRulesetSettings(branchRuleset, branch);
    } catch (error) {
      return this.handleBranchProtectionError(error, branch);
    }
  }

  private findBranchRuleset(
    rulesets: RulesetResponse[],
    branch: string
  ): RulesetResponse | undefined {
    return rulesets.find(
      (r) =>
        r.target === "branch" &&
        r.enforcement === "active" &&
        this.matchesBranch(r.conditions?.ref_name?.include ?? [], branch)
    );
  }

  private matchesBranch(patterns: string[], branch: string): boolean {
    for (const pattern of patterns) {
      const cleanPattern = pattern.replace(/^refs\/heads\//, "");
      if (cleanPattern === branch) {
        return true;
      }
      if (cleanPattern === "~DEFAULT_BRANCH" && branch === "main") {
        return true;
      }
      if (cleanPattern === "~ALL") {
        return true;
      }
      if (cleanPattern.includes("*")) {
        const regex = new RegExp(`^${cleanPattern.replace(/\*/g, ".*")}$`);
        if (regex.test(branch)) {
          return true;
        }
      }
    }
    return false;
  }

  private handleNoBranchRuleset(branch: string): Violation[] {
    if (this.config.require_branch_protection) {
      return [
        {
          rule: `${this.rule}.branch_protection`,
          tool: this.toolId,
          message: `Branch '${branch}' does not have a branch protection ruleset`,
          severity: "error",
        },
      ];
    }
    return [];
  }

  private handleBranchProtectionError(error: unknown, branch: string): Violation[] {
    const msg = error instanceof Error ? error.message : String(error);
    const v = (message: string, severity: "error" | "warning" = "error"): Violation[] => [
      { rule: `${this.rule}.branch_protection`, tool: this.toolId, message, severity },
    ];
    if (msg.includes("404")) {
      return this.config.require_branch_protection
        ? v(`Branch '${branch}' does not have branch protection enabled`)
        : [];
    }
    if (msg.includes("403") || msg.includes("Must have admin rights")) {
      return v(
        "Cannot check branch protection: insufficient permissions (requires admin access)",
        "warning"
      );
    }
    return v(`Failed to check branch protection: ${msg}`);
  }

  private validateBranchRulesetSettings(ruleset: RulesetResponse, branch: string): Violation[] {
    const bpConfig = this.config.ruleset;
    if (!bpConfig) {
      return [];
    }

    const violations: Violation[] = [];
    const rules = ruleset.rules ?? [];

    const prRule = rules.find((r) => r.type === "pull_request");
    violations.push(...this.checkPullRequestRuleSettings(prRule, bpConfig, branch));

    const statusRule = rules.find((r) => r.type === "required_status_checks");
    violations.push(...this.checkStatusChecksRuleSettings(statusRule, bpConfig, branch));

    if (bpConfig.require_signed_commits === true) {
      if (!rules.some((r) => r.type === "required_signatures")) {
        violations.push({
          rule: `${this.rule}.branch_protection.require_signed_commits`,
          tool: this.toolId,
          message: `Branch '${branch}' does not require signed commits`,
          severity: "error",
        });
      }
    }

    violations.push(...this.checkBypassActorsSettings(ruleset, bpConfig, branch));

    return violations;
  }

   
  private checkPullRequestRuleSettings(
    prRule: RulesetRule | undefined,
    bpConfig: RulesetConfig,
    branch: string
  ): Violation[] {
    const violations: Violation[] = [];
    const params = prRule?.parameters;

    if (bpConfig.required_reviews !== undefined) {
      const actualReviews = params?.required_approving_review_count ?? 0;
      if (actualReviews < bpConfig.required_reviews) {
        violations.push({
          rule: `${this.rule}.branch_protection.required_reviews`,
          tool: this.toolId,
          message: `Branch '${branch}' requires ${actualReviews} reviews, expected at least ${bpConfig.required_reviews}`,
          severity: "error",
        });
      }
    }

    if (bpConfig.dismiss_stale_reviews === true) {
      if (!(params?.dismiss_stale_reviews_on_push ?? false)) {
        violations.push({
          rule: `${this.rule}.branch_protection.dismiss_stale_reviews`,
          tool: this.toolId,
          message: `Branch '${branch}' does not dismiss stale reviews on new commits`,
          severity: "error",
        });
      }
    }

    if (bpConfig.require_code_owner_reviews === true) {
      if (!(params?.require_code_owner_review ?? false)) {
        violations.push({
          rule: `${this.rule}.branch_protection.require_code_owner_reviews`,
          tool: this.toolId,
          message: `Branch '${branch}' does not require code owner reviews`,
          severity: "error",
        });
      }
    }

    return violations;
  }

   
  private checkStatusChecksRuleSettings(
    statusRule: RulesetRule | undefined,
    bpConfig: RulesetConfig,
    branch: string
  ): Violation[] {
    const violations: Violation[] = [];
    const params = statusRule?.parameters;

    if (bpConfig.require_status_checks && bpConfig.require_status_checks.length > 0) {
      const actualChecks = params?.required_status_checks?.map((c) => c.context) ?? [];
      const missingChecks = bpConfig.require_status_checks.filter(
        (check) => !actualChecks.includes(check)
      );
      if (missingChecks.length > 0) {
        violations.push({
          rule: `${this.rule}.branch_protection.require_status_checks`,
          tool: this.toolId,
          message: `Branch '${branch}' missing required status checks: ${missingChecks.join(", ")}`,
          severity: "error",
        });
      }
    }

    if (bpConfig.require_branches_up_to_date === true) {
      if (!(params?.strict_required_status_checks_policy ?? false)) {
        violations.push({
          rule: `${this.rule}.branch_protection.require_branches_up_to_date`,
          tool: this.toolId,
          message: `Branch '${branch}' does not require branches to be up to date before merging`,
          severity: "error",
        });
      }
    }

    return violations;
  }

  private checkBypassActorsSettings(
    ruleset: RulesetResponse,
    bpConfig: RulesetConfig,
    branch: string
  ): Violation[] {
    const violations: Violation[] = [];
    const actualBypass = ruleset.bypass_actors ?? [];

    // enforce_admins means no bypass actors should be configured
    if (bpConfig.enforce_admins === true && actualBypass.length > 0) {
      violations.push({
        rule: `${this.rule}.branch_protection.enforce_admins`,
        tool: this.toolId,
        message: `Branch '${branch}' has bypass actors configured but enforce_admins requires no bypasses`,
        severity: "error",
      });
    }

    // Check if configured bypass actors are present
    if (bpConfig.bypass_actors && bpConfig.bypass_actors.length > 0) {
      for (const expected of bpConfig.bypass_actors) {
        const found = actualBypass.some(
          (a) =>
            a.actor_type === expected.actor_type &&
            (expected.actor_id === undefined || a.actor_id === expected.actor_id)
        );
        if (!found) {
          violations.push({
            rule: `${this.rule}.branch_protection.bypass_actors`,
            tool: this.toolId,
            message: `Branch '${branch}' missing bypass actor: ${expected.actor_type}${expected.actor_id ? ` (id: ${expected.actor_id})` : ""}`,
            severity: "error",
          });
        }
      }
    }

    return violations;
  }

  // ===========================================================================
  // Tag Protection
  // ===========================================================================

  private async checkTagProtection(repoInfo: {
    owner: string;
    repo: string;
  }): Promise<Violation[]> {
    try {
      const result = await execa("gh", [
        "api",
        `repos/${repoInfo.owner}/${repoInfo.repo}/rulesets`,
      ]);

      const rulesets = JSON.parse(result.stdout) as RulesetResponse[];
      return this.validateTagProtection(rulesets);
    } catch (error) {
      return this.handleTagProtectionError(error);
    }
  }

  private validateTagProtection(rulesets: RulesetResponse[]): Violation[] {
    const cfg = this.config.tag_protection;
    if (!cfg?.patterns?.length) {
      return [];
    }
    const ruleset = rulesets.find((r) => r.target === "tag" && r.enforcement === "active");
    if (!ruleset) {
      return [this.tagViolation("tag_protection", "No active tag protection ruleset found")];
    }
    return [
      ...this.checkTagPatterns(cfg.patterns, ruleset.conditions?.ref_name?.include ?? []),
      ...this.checkTagRules(cfg, ruleset.rules ?? []),
    ];
  }

  private checkTagPatterns(expected: string[], actual: string[]): Violation[] {
    const exp = expected.map((p) => `refs/tags/${p}`).sort();
    const act = [...actual].sort();
    if (exp.length === act.length && exp.every((v, i) => v === act[i])) {
      return [];
    }
    const found = act.map((p) => p.replace(/^refs\/tags\//, "")).join(", ");
    return [
      this.tagViolation(
        "tag_protection.patterns",
        `Tag protection patterns mismatch: expected [${expected.join(", ")}], found [${found}]`
      ),
    ];
  }

  private checkTagRules(cfg: TagProtectionConfig, rules: { type: string }[]): Violation[] {
    const v: Violation[] = [];
    if (cfg.prevent_deletion !== false && !rules.some((r) => r.type === "deletion")) {
      v.push(
        this.tagViolation(
          "tag_protection.prevent_deletion",
          "Tag protection does not prevent deletion"
        )
      );
    }
    if (cfg.prevent_update !== false && !rules.some((r) => r.type === "update")) {
      v.push(
        this.tagViolation(
          "tag_protection.prevent_update",
          "Tag protection does not prevent updates (force-push)"
        )
      );
    }
    return v;
  }

  private tagViolation(
    rule: string,
    message: string,
    severity: "error" | "warning" = "error"
  ): Violation {
    return { rule: `${this.rule}.${rule}`, tool: this.toolId, message, severity };
  }

  private handleTagProtectionError(error: unknown): Violation[] {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("403") || msg.includes("Must have admin rights")) {
      return [
        this.tagViolation(
          "tag_protection",
          "Cannot check tag protection: insufficient permissions (requires admin access)",
          "warning"
        ),
      ];
    }
    return [this.tagViolation("tag_protection", `Failed to check tag protection: ${msg}`)];
  }
}
