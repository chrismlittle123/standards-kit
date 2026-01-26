import { execa } from "execa";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";

/** Commits configuration from standards.toml */
interface CommitsConfig {
  enabled?: boolean;
  pattern?: string;
  types?: string[];
  require_scope?: boolean;
  max_subject_length?: number;
}

/**
 * Commit message format validation runner.
 * Validates that commit messages follow conventional commit format or custom patterns.
 */
export class CommitsRunner extends BaseProcessToolRunner {
  readonly name = "Commits";
  readonly rule = "process.commits";
  readonly toolId = "commits";

  private config: CommitsConfig = {
    enabled: false,
    require_scope: false,
  };

  /**
   * Set configuration from standards.toml
   */
  setConfig(config: CommitsConfig): void {
    this.config = { ...this.config, ...config };
  }

  /** Get the HEAD commit message (subject line only) */
  private async getHeadCommitSubject(projectRoot: string): Promise<string | null> {
    try {
      const result = await execa("git", ["log", "-1", "--format=%s"], {
        cwd: projectRoot,
      });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** Build conventional commits pattern from config */
  private buildConventionalPattern(): string {
    const types = this.config.types;
    if (!types || types.length === 0) {
      return "";
    }

    const typePattern = types.join("|");
    // Use [^)]+ instead of .+ to avoid greedy matching through multiple parentheses
    const scopePattern = this.config.require_scope ? "\\([^)]+\\)" : "(\\([^)]+\\))?";

    // Pattern: type(scope)?: description
    // e.g., feat(api): add new endpoint
    return `^(${typePattern})${scopePattern}: .+`;
  }

  /** Check if text matches a pattern */
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
  private hasValidConfig(): { valid: boolean; reason?: string; pattern?: string } {
    // If explicit pattern is provided, use it
    if (this.config.pattern) {
      if (!this.isValidPattern(this.config.pattern)) {
        return { valid: false, reason: `Invalid regex pattern: ${this.config.pattern}` };
      }
      return { valid: true, pattern: this.config.pattern };
    }

    // If types are provided, build conventional commits pattern
    if (this.config.types && this.config.types.length > 0) {
      const pattern = this.buildConventionalPattern();
      return { valid: true, pattern };
    }

    // No pattern and no types - need at least one
    return { valid: false, reason: "No pattern or types configured for commit validation" };
  }

  /** Validate commit message format */
  private validateCommitFormat(
    subject: string,
    pattern: string,
    elapsed: () => number
  ): CheckResult {
    const violations: Violation[] = [];

    // Check pattern match
    if (!this.matchesPattern(subject, pattern)) {
      const typesHint = this.config.types
        ? ` Expected format: ${this.config.types.join("|")}${this.config.require_scope ? "(scope)" : "(scope)?"}: description`
        : "";
      violations.push({
        rule: `${this.rule}.pattern`,
        tool: this.toolId,
        message: `Commit message does not match required format.${typesHint}`,
        severity: "error",
      });
    }

    // Check max subject length
    if (this.config.max_subject_length && subject.length > this.config.max_subject_length) {
      violations.push({
        rule: `${this.rule}.max_subject_length`,
        tool: this.toolId,
        message: `Commit subject is ${subject.length} characters, exceeds max of ${this.config.max_subject_length}`,
        severity: "error",
      });
    }

    return violations.length > 0
      ? this.fromViolations(violations, elapsed())
      : this.pass(elapsed());
  }

  /** Run commit message validation */
  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    const configCheck = this.hasValidConfig();
    if (!configCheck.valid) {
      return this.skip(configCheck.reason ?? "Invalid configuration", elapsed());
    }

    const subject = await this.getHeadCommitSubject(projectRoot);
    if (!subject) {
      return this.skip("Not in a git repository or no commits", elapsed());
    }

    return this.validateCommitFormat(subject, configCheck.pattern as string, elapsed);
  }
}
