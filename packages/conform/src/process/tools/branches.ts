import { execa } from "execa";

import { type CheckResult } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";

/** Branches configuration from standards.toml */
interface BranchesConfig {
  enabled?: boolean;
  pattern?: string;
  exclude?: string[];
  require_issue?: boolean;
  issue_pattern?: string;
}

/** Default pattern to extract issue number from branch name */
const DEFAULT_ISSUE_PATTERN = "^(?:feature|fix|hotfix|docs)/([0-9]+)/.*$";

/**
 * Branch naming validation runner.
 * Checks that the current git branch name matches a required pattern.
 */
export class BranchesRunner extends BaseProcessToolRunner {
  readonly name = "Branches";
  readonly rule = "process.branches";
  readonly toolId = "branches";

  private config: BranchesConfig = {
    enabled: false,
    require_issue: false,
  };

  /**
   * Set configuration from standards.toml
   */
  setConfig(config: BranchesConfig): void {
    this.config = { ...this.config, ...config };
  }

  /** Get the current git branch name */
  private async getCurrentBranch(projectRoot: string): Promise<string | null> {
    try {
      const result = await execa("git", ["branch", "--show-current"], {
        cwd: projectRoot,
      });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** Check if branch is excluded from validation */
  private isExcluded(branch: string): boolean {
    const excludeList = this.config.exclude ?? [];
    return excludeList.includes(branch);
  }

  /** Validate branch name against pattern */
  private validateBranchPattern(branch: string): { passed: boolean; error?: string } {
    const pattern = this.config.pattern;
    if (!pattern) {
      return { passed: true }; // No pattern = no validation
    }

    try {
      const regex = new RegExp(pattern);
      if (regex.test(branch)) {
        return { passed: true };
      }
      return {
        passed: false,
        error: `Branch '${branch}' does not match pattern: ${pattern}`,
      };
    } catch {
      return {
        passed: false,
        error: `Invalid regex pattern: ${pattern}`,
      };
    }
  }

  /** Extract issue number from branch name */
  private extractIssueNumber(branch: string): string | null {
    const pattern = this.config.issue_pattern ?? DEFAULT_ISSUE_PATTERN;
    try {
      const regex = new RegExp(pattern);
      const match = branch.match(regex);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  /** Validate that branch contains issue reference */
  private validateIssueReference(branch: string): { passed: boolean; error?: string } {
    if (!this.config.require_issue) {
      return { passed: true };
    }

    const issueNumber = this.extractIssueNumber(branch);
    if (issueNumber) {
      return { passed: true };
    }

    const pattern = this.config.issue_pattern ?? DEFAULT_ISSUE_PATTERN;
    return {
      passed: false,
      error: `Branch '${branch}' does not contain issue number. Expected format matching: ${pattern} (e.g., feature/123/description)`,
    };
  }

  /** Check if any validation is configured */
  private hasValidationConfigured(): boolean {
    return this.config.pattern !== undefined || this.config.require_issue === true;
  }

  /** Collect violations from all validations */
  private collectViolations(
    branch: string
  ): { rule: string; tool: string; message: string; severity: "error" | "warning" }[] {
    const violations: {
      rule: string;
      tool: string;
      message: string;
      severity: "error" | "warning";
    }[] = [];

    const patternResult = this.validateBranchPattern(branch);
    if (!patternResult.passed && patternResult.error) {
      violations.push({
        rule: `${this.rule}.pattern`,
        tool: this.toolId,
        message: patternResult.error,
        severity: "error",
      });
    }

    const issueResult = this.validateIssueReference(branch);
    if (!issueResult.passed && issueResult.error) {
      violations.push({
        rule: `${this.rule}.require_issue`,
        tool: this.toolId,
        message: issueResult.error,
        severity: "error",
      });
    }

    return violations;
  }

  /** Run branch naming validation */
  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    if (!this.hasValidationConfigured()) {
      return this.skip("No branch pattern or issue requirement configured", elapsed());
    }

    const branch = await this.getCurrentBranch(projectRoot);
    if (!branch) {
      return this.skip("Not in a git repository or no branch checked out", elapsed());
    }

    if (this.isExcluded(branch)) {
      return this.pass(elapsed());
    }

    const violations = this.collectViolations(branch);
    return violations.length > 0
      ? this.fromViolations(violations, elapsed())
      : this.pass(elapsed());
  }
}
