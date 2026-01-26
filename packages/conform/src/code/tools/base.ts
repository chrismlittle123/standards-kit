import * as fs from "node:fs";
import * as path from "node:path";

import { CheckResultBuilder, type CheckResult, type IToolRunner, type Violation } from "../../core/index.js";

/**
 * Abstract base class for tool runners.
 * Provides common functionality for checking configs and handling errors.
 */
export abstract class BaseToolRunner implements IToolRunner {
  abstract readonly name: string;
  abstract readonly rule: string;
  abstract readonly toolId: string;
  abstract readonly configFiles: string[];

  /**
   * Check if any of the config files exist
   */
  protected hasConfig(projectRoot: string): boolean {
    return this.configFiles.some((config) => fs.existsSync(path.join(projectRoot, config)));
  }

  /**
   * Find which config file exists (if any)
   */
  protected findConfig(projectRoot: string): string | null {
    for (const config of this.configFiles) {
      if (fs.existsSync(path.join(projectRoot, config))) {
        return config;
      }
    }
    return null;
  }

  /**
   * Check if an error indicates the tool is not installed
   */
  protected isNotInstalledError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const message = error.message.toLowerCase();
    return message.includes("enoent") || message.includes("not found");
  }

  /**
   * Create a fail result for when config is missing
   */
  protected failNoConfig(duration: number): CheckResult {
    const expected = this.configFiles.join(" or ");
    return CheckResultBuilder.fail(
      this.name,
      this.rule,
      [
        {
          rule: `${this.rule}.${this.toolId}`,
          tool: this.toolId,
          message: `Config not found. Expected one of: ${expected}`,
          severity: "error",
        },
      ],
      duration
    );
  }

  /**
   * Create a skip result for when tool is not installed
   */
  protected skipNotInstalled(duration: number): CheckResult {
    return CheckResultBuilder.skip(this.name, this.rule, `${this.name} not installed`, duration);
  }

  /**
   * Create a pass result
   */
  protected pass(duration: number): CheckResult {
    return CheckResultBuilder.pass(this.name, this.rule, duration);
  }

  /**
   * Create a fail result from violations
   */
  protected fail(violations: Violation[], duration: number): CheckResult {
    return CheckResultBuilder.fail(this.name, this.rule, violations, duration);
  }

  /**
   * Create a result from violations (pass if empty, fail otherwise)
   */
  protected fromViolations(violations: Violation[], duration: number): CheckResult {
    return CheckResultBuilder.fromViolations(this.name, this.rule, violations, duration);
  }

  /**
   * Run the tool - must be implemented by subclasses
   */
  abstract run(projectRoot: string): Promise<CheckResult>;

  /**
   * Default audit implementation - checks if config exists
   */
  async audit(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    if (this.hasConfig(projectRoot)) {
      return CheckResultBuilder.pass(`${this.name} Config`, this.rule, Date.now() - startTime);
    }

    return CheckResultBuilder.fail(
      `${this.name} Config`,
      this.rule,
      [
        {
          rule: `${this.rule}.${this.toolId}`,
          tool: "audit",
          message: `${this.name} config not found. Expected one of: ${this.configFiles.join(", ")}`,
          severity: "error",
        },
      ],
      Date.now() - startTime
    );
  }
}
