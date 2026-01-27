import * as path from "node:path";

import { execa } from "execa";
import { globSync } from "glob";

import { TIMEOUTS } from "../../constants.js";
import { CheckResultBuilder, type CheckResult, type Violation } from "../../core/index.js";
import { BaseToolRunner } from "./base.js";

/** ESLint JSON output message format */
interface ESLintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
}

/** ESLint JSON output file result format */
interface ESLintFileResult {
  filePath: string;
  messages: ESLintMessage[];
}

/**
 * ESLint rule with options in TOML-friendly object format.
 * Example: { severity: "error", max: 10 }
 */
interface ESLintRuleWithOptions {
  severity: "off" | "warn" | "error";
  [key: string]: unknown;
}

/** ESLint rule value - severity string or object with options */
type ESLintRuleValue = "off" | "warn" | "error" | ESLintRuleWithOptions;

/** ESLint configuration options */
interface ESLintConfig {
  enabled?: boolean;
  files?: string[];
  ignore?: string[];
  "max-warnings"?: number;
  rules?: Record<string, ESLintRuleValue>;
}

/** ESLint --print-config output format */
interface ESLintPrintConfig {
  rules?: Record<string, unknown[]>;
}

/**
 * ESLint tool runner
 */
export class ESLintRunner extends BaseToolRunner {
  readonly name = "ESLint";
  readonly rule = "code.linting";
  readonly toolId = "eslint";
  readonly configFiles = [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    ".eslintrc.js",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc.yaml",
  ];

  private config: ESLintConfig = {};

  /**
   * Set ESLint configuration options
   */
  setConfig(config: ESLintConfig): void {
    this.config = config;
  }

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    if (!this.hasConfig(projectRoot)) {
      return this.failNoConfig(Date.now() - startTime);
    }

    try {
      const args = this.buildArgs();
      const result = await execa("npx", ["eslint", ...args], {
        cwd: projectRoot,
        reject: false,
        timeout: TIMEOUTS.codeTool,
      });

      const violations = this.parseOutput(result.stdout, projectRoot);

      // Handle parse failure with non-zero exit
      if (violations === null && result.exitCode !== 0 && result.stderr) {
        return this.fail(
          [this.createErrorViolation(`ESLint error: ${result.stderr}`)],
          Date.now() - startTime
        );
      }

      return this.fromViolations(violations ?? [], Date.now() - startTime);
    } catch (error) {
      if (this.isNotInstalledError(error)) {
        return this.skipNotInstalled(Date.now() - startTime);
      }

      const message = error instanceof Error ? error.message : "Unknown error";
      return this.fail(
        [this.createErrorViolation(`ESLint error: ${message}`)],
        Date.now() - startTime
      );
    }
  }

  /**
   * Audit ESLint config - verify config exists and required rules are present
   */
  async audit(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    // First check if config exists
    if (!this.hasConfig(projectRoot)) {
      return this.fail(
        [
          {
            rule: `${this.rule}.${this.toolId}`,
            tool: "audit",
            message: `${this.name} config not found. Expected one of: ${this.configFiles.join(", ")}`,
            severity: "error",
          },
        ],
        elapsed()
      );
    }

    // If no rules defined, just pass
    if (!this.config.rules || Object.keys(this.config.rules).length === 0) {
      return CheckResultBuilder.pass(`${this.name} Config`, this.rule, elapsed());
    }

    // Get effective ESLint config and verify rules
    const violations = await this.auditRules(projectRoot);
    if (violations.length === 0) {
      return CheckResultBuilder.pass(`${this.name} Config`, this.rule, elapsed());
    }

    return CheckResultBuilder.fail(`${this.name} Config`, this.rule, violations, elapsed());
  }

  /**
   * Audit that required rules are present in ESLint config
   */
  private async auditRules(projectRoot: string): Promise<Violation[]> {
    // Check if files pattern is configured
    if (!this.config.files || this.config.files.length === 0) {
      return [
        this.createAuditViolation(
          'Rules audit requires "files" to be configured in standards.toml (e.g., files = ["src/**/*.ts"])',
          "error"
        ),
      ];
    }

    const sampleFile = this.findSampleFile(projectRoot);
    if (!sampleFile) {
      return [
        this.createAuditViolation(
          `No files found matching patterns: ${this.config.files.join(", ")}`,
          "error"
        ),
      ];
    }

    const effectiveRules = await this.getEffectiveRules(projectRoot, sampleFile);
    if ("error" in effectiveRules) {
      return [this.createAuditViolation(effectiveRules.error, "error")];
    }

    return this.compareRules(projectRoot, this.config.rules ?? {}, effectiveRules.rules);
  }

  /**
   * Get effective ESLint rules for a file
   */
  private async getEffectiveRules(
    projectRoot: string,
    sampleFile: string
  ): Promise<{ rules: Record<string, unknown[]> } | { error: string }> {
    try {
      const result = await execa("npx", ["eslint", "--print-config", sampleFile], {
        cwd: projectRoot,
        reject: false,
        timeout: TIMEOUTS.quick,
      });

      if (result.exitCode !== 0) {
        return { error: `Failed to read ESLint config: ${result.stderr || "Unknown error"}` };
      }

      const config = JSON.parse(result.stdout) as ESLintPrintConfig;
      return { rules: config.rules ?? {} };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return { error: `Failed to audit ESLint config: ${msg}` };
    }
  }

  /**
   * Extract options from a rule value (excludes severity)
   */
  private extractRuleOptions(value: ESLintRuleValue): unknown[] | null {
    if (typeof value === "string") {
      return null; // No options for severity-only rules
    }
    if (this.isRuleWithOptions(value)) {
      // For object format, convert to array format for comparison
      const { severity: _, ...options } = value;
      return Object.keys(options).length > 0 ? [options] : null;
    }
    return null;
  }

  /**
   * Get effective option value, handling both object and primitive formats.
   * ESLint normalizes some rules like max-depth from ["error", { max: 4 }] to [2, 4].
   */
  private getEffectiveOptionValue(effectiveOptions: unknown, optionName: string): unknown {
    // If effectiveOptions is an object, look up the key
    if (typeof effectiveOptions === "object" && effectiveOptions !== null) {
      return (effectiveOptions as Record<string, unknown>)[optionName];
    }
    // If effectiveOptions is a primitive and we're looking for "max", return the primitive
    // This handles rules like max-depth, max-params, complexity where ESLint uses [severity, number]
    if (
      optionName === "max" &&
      (typeof effectiveOptions === "number" || typeof effectiveOptions === "string")
    ) {
      return effectiveOptions;
    }
    return undefined;
  }

  /**
   * Compare rule options between required and effective config.
   */
  private compareRuleOptions(
    ruleName: string,
    requiredOptions: unknown[],
    effectiveRule: unknown[],
    configFile: string | undefined
  ): Violation[] {
    const effectiveOptions = effectiveRule.slice(1);
    if (this.deepEqual(requiredOptions, effectiveOptions)) {
      return [];
    }
    // For single-object rules, try detailed comparison
    if (requiredOptions.length === 1 && typeof requiredOptions[0] === "object") {
      return this.compareObjectOptions(ruleName, requiredOptions[0], effectiveOptions, configFile);
    }
    // For complex rules, show full mismatch
    const msg = `Rule "${ruleName}": options mismatch`;
    return [this.createAuditViolation(msg, "error", configFile)];
  }

  /** Compare single-object rule options for detailed error messages */
  private compareObjectOptions(
    ruleName: string,
    reqObj: unknown,
    effectiveOptions: unknown[],
    configFile: string | undefined
  ): Violation[] {
    const violations: Violation[] = [];
    const required = reqObj as Record<string, unknown>;
    const effective = typeof effectiveOptions[0] === "object" ? effectiveOptions[0] : {};
    for (const [key, reqVal] of Object.entries(required)) {
      const effVal = this.getEffectiveOptionValue(effective, key);
      if (effVal === undefined) {
        violations.push(
          this.createAuditViolation(`Rule "${ruleName}": "${key}" required`, "error", configFile)
        );
      } else if (!this.deepEqual(reqVal, effVal)) {
        violations.push(
          this.createAuditViolation(`Rule "${ruleName}": "${key}" mismatch`, "error", configFile)
        );
      }
    }
    return violations;
  }

  /**
   * Deep equality check for comparing option values
   */
  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true;
    }
    if (typeof a !== typeof b) {
      return false;
    }
    if (typeof a !== "object" || a === null || b === null) {
      return false;
    }
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) {
      return false;
    }
    for (const key of keysA) {
      if (
        !this.deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Compare a single rule against effective config
   */
  private compareSingleRule(
    ruleName: string,
    requiredValue: ESLintRuleValue,
    effectiveRule: unknown[] | undefined,
    configFile: string | undefined
  ): Violation[] {
    if (!effectiveRule) {
      return [
        this.createAuditViolation(
          `Rule "${ruleName}" is required but not configured`,
          "error",
          configFile
        ),
      ];
    }

    const violations: Violation[] = [];
    const requiredSeverity = this.normalizeSeverity(requiredValue);
    const effectiveSeverity = this.normalizeSeverity(effectiveRule[0]);

    if (requiredSeverity !== effectiveSeverity) {
      const msg = `Rule "${ruleName}": expected "${this.severityToString(requiredSeverity)}", got "${this.severityToString(effectiveSeverity)}"`;
      violations.push(this.createAuditViolation(msg, "error", configFile));
    }

    const requiredOptions = this.extractRuleOptions(requiredValue);
    if (requiredOptions) {
      violations.push(
        ...this.compareRuleOptions(ruleName, requiredOptions, effectiveRule, configFile)
      );
    }

    return violations;
  }

  /**
   * Compare required rules against effective rules
   */
  private compareRules(
    projectRoot: string,
    requiredRules: Record<string, ESLintRuleValue>,
    effectiveRules: Record<string, unknown[]>
  ): Violation[] {
    const configFile = this.findConfig(projectRoot) ?? undefined;

    return Object.entries(requiredRules).flatMap(([ruleName, requiredValue]) =>
      this.compareSingleRule(ruleName, requiredValue, effectiveRules[ruleName], configFile)
    );
  }

  /**
   * Create an audit violation
   */
  private createAuditViolation(
    message: string,
    severity: "error" | "warning",
    file?: string
  ): Violation {
    return {
      rule: `${this.rule}.${this.toolId}`,
      tool: "audit",
      message,
      severity,
      file,
    };
  }

  /**
   * Find a sample source file to check ESLint config against.
   * Requires 'files' to be configured in standards.toml.
   */
  private findSampleFile(projectRoot: string): string | null {
    const filePatterns = this.config.files;
    if (!filePatterns || filePatterns.length === 0) {
      return null;
    }

    // Use glob to find a file matching the configured patterns
    const matches = globSync(filePatterns, {
      cwd: projectRoot,
      nodir: true,
      ignore: this.config.ignore ?? [],
    });

    return matches.length > 0 ? matches[0] : null;
  }

  /**
   * Check if a value is an ESLint rule with options object
   */
  private isRuleWithOptions(value: unknown): value is ESLintRuleWithOptions {
    return typeof value === "object" && value !== null && "severity" in value;
  }

  /**
   * Normalize rule severity to number (0, 1, 2)
   */
  private normalizeSeverity(value: unknown): number {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      switch (value) {
        case "off":
          return 0;
        case "warn":
          return 1;
        case "error":
          return 2;
        default:
          return parseInt(value, 10) || 0;
      }
    }
    if (Array.isArray(value)) {
      return this.normalizeSeverity(value[0]);
    }
    if (this.isRuleWithOptions(value)) {
      return this.normalizeSeverity(value.severity);
    }
    return 0;
  }

  /**
   * Convert severity number to string
   */
  private severityToString(severity: number): string {
    switch (severity) {
      case 0:
        return "off";
      case 1:
        return "warn";
      case 2:
        return "error";
      default:
        return String(severity);
    }
  }

  private buildArgs(): string[] {
    const args: string[] = [];

    // Files to lint (default to ".")
    if (this.config.files && this.config.files.length > 0) {
      args.push(...this.config.files);
    } else {
      args.push(".");
    }

    // Output format
    args.push("--format", "json");

    // Ignore patterns
    if (this.config.ignore) {
      for (const pattern of this.config.ignore) {
        args.push("--ignore-pattern", pattern);
      }
    }

    // Max warnings
    if (this.config["max-warnings"] !== undefined) {
      args.push("--max-warnings", String(this.config["max-warnings"]));
    }

    return args;
  }

  private parseOutput(stdout: string, projectRoot: string): Violation[] | null {
    try {
      const results = JSON.parse(stdout) as ESLintFileResult[];
      const violations: Violation[] = [];

      for (const fileResult of results) {
        for (const msg of fileResult.messages) {
          violations.push({
            rule: `${this.rule}.${this.toolId}`,
            tool: this.toolId,
            file: path.relative(projectRoot, fileResult.filePath),
            line: msg.line,
            column: msg.column,
            message: msg.message,
            code: msg.ruleId ?? undefined,
            severity: msg.severity === 2 ? "error" : "warning",
          });
        }
      }

      return violations;
    } catch {
      return null;
    }
  }

  private createErrorViolation(message: string): Violation {
    return {
      rule: `${this.rule}.${this.toolId}`,
      tool: this.toolId,
      message,
      severity: "error",
    };
  }
}
