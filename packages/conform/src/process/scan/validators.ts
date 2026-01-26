import { type Config } from "../../core/index.js";
import { type Violation } from "../../core/index.js";

/** GitHub Ruleset response types */
interface RulesetBypassActor {
  actor_id: number | null;
  actor_type: string;
  bypass_mode: string;
}

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

export interface RulesetResponse {
  id: number;
  name: string;
  target: string;
  enforcement: string;
  conditions?: { ref_name?: { include?: string[]; exclude?: string[] } };
  bypass_actors?: RulesetBypassActor[];
  rules?: RulesetRule[];
}

type RulesetConfig = NonNullable<NonNullable<Config["process"]>["repo"]>["ruleset"];
type TagProtectionConfig = NonNullable<NonNullable<Config["process"]>["repo"]>["tag_protection"];

/** Check if branch matches any of the include patterns */
function matchesBranch(patterns: string[], branch: string): boolean {
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

/** Find branch ruleset matching the target branch */
function findBranchRuleset(
  rulesets: RulesetResponse[],
  branch: string
): RulesetResponse | undefined {
  return rulesets.find(
    (r) =>
      r.target === "branch" &&
      r.enforcement === "active" &&
      matchesBranch(r.conditions?.ref_name?.include ?? [], branch)
  );
}

/** Validate rulesets against config */
// eslint-disable-next-line complexity
export function validateRulesets(
  rulesets: RulesetResponse[],
  repoConfig: NonNullable<Config["process"]>["repo"]
): Violation[] {
  if (!repoConfig) {
    return [];
  }

  const violations: Violation[] = [];
  const rulesetConfig = repoConfig.ruleset;
  const branch = rulesetConfig?.branch ?? "main";
  const branchRuleset = findBranchRuleset(rulesets, branch);

  if (repoConfig.require_branch_protection && !branchRuleset) {
    violations.push({
      rule: "process.repo.branch_protection",
      tool: "scan",
      message: `Branch '${branch}' does not have a branch protection ruleset`,
      severity: "error",
    });
  }

  if (branchRuleset && rulesetConfig) {
    violations.push(...validateBranchRuleset(branchRuleset, rulesetConfig, branch));
  }

  if (repoConfig.tag_protection?.patterns?.length) {
    violations.push(...validateTagProtection(rulesets, repoConfig.tag_protection));
  }

  return violations;
}

/** Validate branch ruleset settings against config */
function validateBranchRuleset(
  ruleset: RulesetResponse,
  config: RulesetConfig,
  branch: string
): Violation[] {
  if (!config) {
    return [];
  }

  const violations: Violation[] = [];
  const rules = ruleset.rules ?? [];
  const prRule = rules.find((r) => r.type === "pull_request");
  const statusRule = rules.find((r) => r.type === "required_status_checks");

  violations.push(...validatePullRequestRule(prRule, config, branch));
  violations.push(...validateStatusChecksRule(statusRule, config, branch));
  violations.push(...validateSignedCommits(rules, config, branch));
  violations.push(...validateBypassActors(ruleset.bypass_actors ?? [], config, branch));

  return violations;
}

/** Validate pull request rule settings */
// eslint-disable-next-line complexity
function validatePullRequestRule(
  prRule: RulesetRule | undefined,
  config: RulesetConfig,
  branch: string
): Violation[] {
  if (!config) {
    return [];
  }

  const violations: Violation[] = [];
  const params = prRule?.parameters;

  if (config.required_reviews !== undefined) {
    const actualReviews = params?.required_approving_review_count ?? 0;
    if (actualReviews < config.required_reviews) {
      violations.push({
        rule: "process.repo.branch_protection.required_reviews",
        tool: "scan",
        message: `Branch '${branch}' requires ${actualReviews} reviews, expected at least ${config.required_reviews}`,
        severity: "error",
      });
    }
  }

  if (config.dismiss_stale_reviews === true && !(params?.dismiss_stale_reviews_on_push ?? false)) {
    violations.push({
      rule: "process.repo.branch_protection.dismiss_stale_reviews",
      tool: "scan",
      message: `Branch '${branch}' does not dismiss stale reviews on new commits`,
      severity: "error",
    });
  }

  if (config.require_code_owner_reviews === true && !(params?.require_code_owner_review ?? false)) {
    violations.push({
      rule: "process.repo.branch_protection.require_code_owner_reviews",
      tool: "scan",
      message: `Branch '${branch}' does not require code owner reviews`,
      severity: "error",
    });
  }

  return violations;
}

/** Validate status checks rule settings */
// eslint-disable-next-line complexity
function validateStatusChecksRule(
  statusRule: RulesetRule | undefined,
  config: RulesetConfig,
  branch: string
): Violation[] {
  if (!config) {
    return [];
  }

  const violations: Violation[] = [];
  const params = statusRule?.parameters;

  if (config.require_status_checks && config.require_status_checks.length > 0) {
    const actualChecks = params?.required_status_checks?.map((c) => c.context) ?? [];
    const missingChecks = config.require_status_checks.filter(
      (check) => !actualChecks.includes(check)
    );
    if (missingChecks.length > 0) {
      violations.push({
        rule: "process.repo.branch_protection.require_status_checks",
        tool: "scan",
        message: `Branch '${branch}' missing required status checks: ${missingChecks.join(", ")}`,
        severity: "error",
      });
    }
  }

  if (
    config.require_branches_up_to_date === true &&
    !(params?.strict_required_status_checks_policy ?? false)
  ) {
    violations.push({
      rule: "process.repo.branch_protection.require_branches_up_to_date",
      tool: "scan",
      message: `Branch '${branch}' does not require branches to be up to date before merging`,
      severity: "error",
    });
  }

  return violations;
}

/** Validate signed commits requirement */
function validateSignedCommits(
  rules: RulesetRule[],
  config: RulesetConfig,
  branch: string
): Violation[] {
  if (config?.require_signed_commits !== true) {
    return [];
  }

  if (!rules.some((r) => r.type === "required_signatures")) {
    return [
      {
        rule: "process.repo.branch_protection.require_signed_commits",
        tool: "scan",
        message: `Branch '${branch}' does not require signed commits`,
        severity: "error",
      },
    ];
  }

  return [];
}

/** Validate bypass actors configuration */
function validateBypassActors(
  actualBypass: RulesetBypassActor[],
  config: RulesetConfig,
  branch: string
): Violation[] {
  if (config?.enforce_admins !== true || actualBypass.length === 0) {
    return [];
  }

  return [
    {
      rule: "process.repo.branch_protection.enforce_admins",
      tool: "scan",
      message: `Branch '${branch}' has bypass actors configured but enforce_admins requires no bypasses`,
      severity: "error",
    },
  ];
}

/** Validate tag protection rulesets */
function validateTagProtection(
  rulesets: RulesetResponse[],
  tagConfig: TagProtectionConfig
): Violation[] {
  if (!tagConfig?.patterns?.length) {
    return [];
  }

  const violations: Violation[] = [];
  const tagRuleset = rulesets.find((r) => r.target === "tag" && r.enforcement === "active");

  if (!tagRuleset) {
    return [
      {
        rule: "process.repo.tag_protection",
        tool: "scan",
        message: "No active tag protection ruleset found",
        severity: "error",
      },
    ];
  }

  violations.push(...validateTagPatterns(tagConfig.patterns, tagRuleset));
  violations.push(...validateTagRules(tagConfig, tagRuleset.rules ?? []));

  return violations;
}

/** Validate tag patterns match */
function validateTagPatterns(expectedPatterns: string[], tagRuleset: RulesetResponse): Violation[] {
  const expected = expectedPatterns.map((p) => `refs/tags/${p}`).sort();
  const actual = [...(tagRuleset.conditions?.ref_name?.include ?? [])].sort();

  if (expected.length === actual.length && expected.every((v, i) => v === actual[i])) {
    return [];
  }

  const found = actual.map((p) => p.replace(/^refs\/tags\//, "")).join(", ");
  return [
    {
      rule: "process.repo.tag_protection.patterns",
      tool: "scan",
      message: `Tag protection patterns mismatch: expected [${expectedPatterns.join(", ")}], found [${found}]`,
      severity: "error",
    },
  ];
}

/** Validate tag protection rules */
function validateTagRules(tagConfig: TagProtectionConfig, rules: RulesetRule[]): Violation[] {
  if (!tagConfig) {
    return [];
  }

  const violations: Violation[] = [];

  if (tagConfig.prevent_deletion !== false && !rules.some((r) => r.type === "deletion")) {
    violations.push({
      rule: "process.repo.tag_protection.prevent_deletion",
      tool: "scan",
      message: "Tag protection does not prevent deletion",
      severity: "error",
    });
  }

  if (tagConfig.prevent_update !== false && !rules.some((r) => r.type === "update")) {
    violations.push({
      rule: "process.repo.tag_protection.prevent_update",
      tool: "scan",
      message: "Tag protection does not prevent updates (force-push)",
      severity: "error",
    });
  }

  return violations;
}
