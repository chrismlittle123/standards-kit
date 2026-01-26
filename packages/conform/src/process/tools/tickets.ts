import { execa } from "execa";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";

/** Tickets configuration from standards.toml */
interface TicketsConfig {
  enabled?: boolean;
  pattern?: string;
  require_in_commits?: boolean;
  require_in_branch?: boolean;
}

/**
 * Ticket reference validation runner.
 * Checks that commit messages and/or branch names contain ticket references.
 */
export class TicketsRunner extends BaseProcessToolRunner {
  readonly name = "Tickets";
  readonly rule = "process.tickets";
  readonly toolId = "tickets";

  private config: TicketsConfig = {
    enabled: false,
    require_in_commits: true,
    require_in_branch: false,
  };

  /**
   * Set configuration from standards.toml
   */
  setConfig(config: TicketsConfig): void {
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

  /** Get the HEAD commit message */
  private async getHeadCommitMessage(projectRoot: string): Promise<string | null> {
    try {
      const result = await execa("git", ["log", "-1", "--format=%s"], {
        cwd: projectRoot,
      });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** Check if text contains a match for the ticket pattern */
  private matchesPattern(text: string, pattern: string): boolean {
    try {
      const regex = new RegExp(pattern);
      return regex.test(text);
    } catch {
      return false;
    }
  }

  /** Validate the regex pattern is valid */
  private isValidPattern(pattern: string): boolean {
    try {
      new RegExp(pattern);
      return true;
    } catch {
      return false;
    }
  }

  /** Check configuration validity */
  private hasValidConfig(): { valid: boolean; reason?: string } {
    if (!this.config.pattern) {
      return { valid: false, reason: "No ticket pattern configured" };
    }
    if (!this.isValidPattern(this.config.pattern)) {
      return { valid: false, reason: `Invalid regex pattern: ${this.config.pattern}` };
    }
    if (!this.config.require_in_commits && !this.config.require_in_branch) {
      return {
        valid: false,
        reason: "Neither require_in_commits nor require_in_branch is enabled",
      };
    }
    return { valid: true };
  }

  /** Validate branch name contains ticket reference */
  private async validateBranch(
    projectRoot: string,
    pattern: string
  ): Promise<{ skip?: string; violation?: Violation }> {
    const branch = await this.getCurrentBranch(projectRoot);
    if (!branch) {
      return { skip: "Not in a git repository or no branch checked out" };
    }
    if (!this.matchesPattern(branch, pattern)) {
      return {
        violation: {
          rule: `${this.rule}.branch`,
          tool: this.toolId,
          message: `Branch '${branch}' does not contain ticket reference matching: ${pattern}`,
          severity: "error",
        },
      };
    }
    return {};
  }

  /** Validate commit message contains ticket reference */
  private async validateCommit(
    projectRoot: string,
    pattern: string
  ): Promise<{ skip?: string; violation?: Violation }> {
    const commitMessage = await this.getHeadCommitMessage(projectRoot);
    if (!commitMessage) {
      return { skip: "Not in a git repository or no commits" };
    }
    if (!this.matchesPattern(commitMessage, pattern)) {
      return {
        violation: {
          rule: `${this.rule}.commits`,
          tool: this.toolId,
          message: `Commit message does not contain ticket reference matching: ${pattern}`,
          severity: "error",
        },
      };
    }
    return {};
  }

  /** Perform all validations and collect results */
  private async runValidations(
    projectRoot: string,
    pattern: string
  ): Promise<{ skip?: string; violations: Violation[] }> {
    const violations: Violation[] = [];

    if (this.config.require_in_branch) {
      const result = await this.validateBranch(projectRoot, pattern);
      if (result.skip) {
        return { skip: result.skip, violations: [] };
      }
      if (result.violation) {
        violations.push(result.violation);
      }
    }

    if (this.config.require_in_commits) {
      const result = await this.validateCommit(projectRoot, pattern);
      if (result.skip) {
        return { skip: result.skip, violations: [] };
      }
      if (result.violation) {
        violations.push(result.violation);
      }
    }

    return { violations };
  }

  /** Run ticket validation */
  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    const configCheck = this.hasValidConfig();
    if (!configCheck.valid) {
      return this.skip(configCheck.reason ?? "Invalid configuration", elapsed());
    }

    const pattern = this.config.pattern as string;
    const { skip, violations } = await this.runValidations(projectRoot, pattern);

    if (skip) {
      return this.skip(skip, elapsed());
    }
    return violations.length > 0
      ? this.fromViolations(violations, elapsed())
      : this.pass(elapsed());
  }
}
