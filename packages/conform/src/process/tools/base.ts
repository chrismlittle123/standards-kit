import * as fs from "node:fs";
import * as path from "node:path";

import { CheckResultBuilder, type CheckResult, type IToolRunner, type Violation } from "../../core/index.js";

/**
 * Abstract base class for process tool runners.
 * Provides common functionality for checking files and directories.
 */
export abstract class BaseProcessToolRunner implements IToolRunner {
  abstract readonly name: string;
  abstract readonly rule: string;
  abstract readonly toolId: string;
  /** Process tools don't have config files in the same way code tools do */
  readonly configFiles: string[] = [];

  /**
   * Check if a directory exists
   */
  protected directoryExists(projectRoot: string, dirPath: string): boolean {
    const fullPath = path.join(projectRoot, dirPath);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  }

  /**
   * Check if a file exists
   */
  protected fileExists(projectRoot: string, filePath: string): boolean {
    const fullPath = path.join(projectRoot, filePath);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
  }

  /**
   * Read file contents
   */
  protected readFile(projectRoot: string, filePath: string): string | null {
    const fullPath = path.join(projectRoot, filePath);
    try {
      return fs.readFileSync(fullPath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Check if a file contains a specific string/pattern
   */
  protected fileContains(projectRoot: string, filePath: string, pattern: string): boolean {
    const content = this.readFile(projectRoot, filePath);
    if (content === null) {
      return false;
    }
    return content.includes(pattern);
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
   * Create a skip result
   */
  protected skip(reason: string, duration: number): CheckResult {
    return CheckResultBuilder.skip(this.name, this.rule, reason, duration);
  }

  /**
   * Run the tool - must be implemented by subclasses
   */
  abstract run(projectRoot: string): Promise<CheckResult>;

  /**
   * Audit the tool - by default same as run for process tools
   */
  async audit(projectRoot: string): Promise<CheckResult> {
    return this.run(projectRoot);
  }
}
