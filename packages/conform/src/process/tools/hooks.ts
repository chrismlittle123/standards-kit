import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";

/** Hooks configuration from standards.toml */
interface HooksConfig {
  enabled?: boolean;
  require_husky?: boolean;
  require_hooks?: string[];
  commands?: Record<string, string[]>;
  protected_branches?: string[];
  templates?: Record<string, string>;
}

/**
 * Git hooks validation runner.
 * Checks that husky is installed and required hooks are configured.
 */
export class HooksRunner extends BaseProcessToolRunner {
  readonly name = "Hooks";
  readonly rule = "process.hooks";
  readonly toolId = "hooks";

  private config: HooksConfig = {
    enabled: false,
    require_husky: true,
  };

  /**
   * Set configuration from standards.toml
   */
  setConfig(config: HooksConfig): void {
    this.config = { ...this.config, ...config };
  }

  /** Check if husky is installed */
  private checkHuskyInstalled(projectRoot: string): Violation | null {
    if (this.config.require_husky === false) {
      return null;
    }
    if (this.directoryExists(projectRoot, ".husky")) {
      return null;
    }
    return {
      rule: `${this.rule}.husky`,
      tool: this.toolId,
      message: "Husky not installed (.husky/ directory not found)",
      severity: "error",
    };
  }

  /** Check that required hooks exist */
  private checkRequiredHooks(projectRoot: string): Violation[] {
    const hooks = this.config.require_hooks ?? [];
    return hooks
      .filter((hook) => !this.fileExists(projectRoot, `.husky/${hook}`))
      .map((hook) => ({
        rule: `${this.rule}.${hook}`,
        tool: this.toolId,
        file: `.husky/${hook}`,
        message: `Required hook '${hook}' not found`,
        severity: "error" as const,
      }));
  }

  /** Check that hooks contain required commands */
  private checkHookCommands(projectRoot: string): Violation[] {
    const commands = this.config.commands ?? {};
    const violations: Violation[] = [];

    for (const [hook, requiredCommands] of Object.entries(commands)) {
      const hookPath = `.husky/${hook}`;
      if (!this.fileExists(projectRoot, hookPath)) {
        continue;
      }
      for (const command of requiredCommands) {
        if (!this.fileContains(projectRoot, hookPath, command)) {
          violations.push({
            rule: `${this.rule}.${hook}.commands`,
            tool: this.toolId,
            file: hookPath,
            message: `Hook '${hook}' does not contain required command: ${command}`,
            severity: "error",
          });
        }
      }
    }
    return violations;
  }

  /** Create a pre-push hook violation */
  private createPrePushViolation(ruleId: string, message: string): Violation {
    return {
      rule: `${this.rule}.${ruleId}`,
      tool: this.toolId,
      file: ".husky/pre-push",
      message,
      severity: "error",
    };
  }

  /** Check if pre-push hook has branch detection */
  private hasBranchDetection(projectRoot: string): boolean {
    const branchDetectionPatterns = [
      "git rev-parse --abbrev-ref HEAD",
      "git branch --show-current",
      "git symbolic-ref --short HEAD",
    ];
    const hookPath = ".husky/pre-push";
    return branchDetectionPatterns.some((pattern) =>
      this.fileContains(projectRoot, hookPath, pattern)
    );
  }

  /** Check that hook files match expected template content */
  private checkHookTemplates(projectRoot: string): Violation[] {
    const templates = this.config.templates ?? {};
    const violations: Violation[] = [];

    for (const [hook, expectedContent] of Object.entries(templates)) {
      const hookPath = `.husky/${hook}`;
      const actual = this.readFile(projectRoot, hookPath);
      if (actual === null) {
        continue; // Skip if hook file doesn't exist (checkRequiredHooks handles that)
      }
      if (actual.trim() !== expectedContent.trim()) {
        violations.push({
          rule: `${this.rule}.${hook}.template`,
          tool: this.toolId,
          file: hookPath,
          message: `Hook '${hook}' does not match expected template`,
          severity: "error",
        });
      }
    }
    return violations;
  }

  /** Check that pre-push hook prevents direct pushes to protected branches */
  private checkProtectedBranches(projectRoot: string): Violation[] {
    const protectedBranches = this.config.protected_branches ?? [];
    if (protectedBranches.length === 0) {
      return [];
    }

    const hookPath = ".husky/pre-push";

    // First check if pre-push hook exists
    if (!this.fileExists(projectRoot, hookPath)) {
      return [
        this.createPrePushViolation(
          "pre-push",
          "Pre-push hook not found. Required for protected branch enforcement."
        ),
      ];
    }

    // Check for branch detection pattern
    if (!this.hasBranchDetection(projectRoot)) {
      return [
        this.createPrePushViolation(
          "pre-push.branch-detection",
          "Pre-push hook does not detect current branch. Expected one of: git rev-parse --abbrev-ref HEAD, git branch --show-current"
        ),
      ];
    }

    // Check that each protected branch is referenced in the hook
    return protectedBranches
      .filter((branch) => !this.fileContains(projectRoot, hookPath, branch))
      .map((branch) =>
        this.createPrePushViolation(
          "pre-push.protected-branch",
          `Pre-push hook does not check for protected branch "${branch}"`
        )
      );
  }

  /** Run hooks validation */
  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    // Check husky first - if not installed, can't check hooks
    const huskyViolation = this.checkHuskyInstalled(projectRoot);
    if (huskyViolation) {
      return this.fromViolations([huskyViolation], elapsed());
    }

    const violations = [
      ...this.checkRequiredHooks(projectRoot),
      ...this.checkHookCommands(projectRoot),
      ...this.checkHookTemplates(projectRoot),
      ...this.checkProtectedBranches(projectRoot),
    ];

    return this.fromViolations(violations, elapsed());
  }
}
