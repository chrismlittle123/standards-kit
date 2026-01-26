import * as fs from "node:fs";
import * as path from "node:path";

import { execa } from "execa";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseToolRunner } from "./base.js";

/** Gitleaks finding entry from JSON output */
interface GitleaksFinding {
  Description: string;
  StartLine: number;
  EndLine: number;
  StartColumn: number;
  EndColumn: number;
  Match: string;
  Secret: string;
  File: string;
  Commit: string;
  Entropy: number;
  Author: string;
  Email: string;
  Date: string;
  Message: string;
  Tags: string[];
  RuleID: string;
  Fingerprint: string;
}

/** Scan mode options */
type ScanMode = "branch" | "files" | "staged" | "full";

/** Gitleaks configuration */
interface GitleaksConfig {
  enabled?: boolean;
  scan_mode?: ScanMode;
  base_branch?: string;
}

/**
 * Gitleaks tool runner for detecting hardcoded secrets
 */
export class GitleaksRunner extends BaseToolRunner {
  readonly name = "gitleaks";
  readonly rule = "code.security";
  readonly toolId = "secrets";
  readonly configFiles = [".gitleaks.toml", "gitleaks.toml"];

  private config: GitleaksConfig = {
    scan_mode: "branch",
    base_branch: "main",
  };

  setConfig(config: GitleaksConfig): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Find gitleaks config file if it exists
   * Returns just the filename (relative to projectRoot) since gitleaks runs with cwd=projectRoot
   */
  private findGitleaksConfig(projectRoot: string): string | null {
    for (const configFile of this.configFiles) {
      const configPath = path.join(projectRoot, configFile);
      if (fs.existsSync(configPath)) {
        return configFile; // Return just the filename, not the full path
      }
    }
    return null;
  }

  /**
   * Build gitleaks arguments based on scan mode
   */
  private buildArgs(projectRoot: string): string[] {
    const scanMode = this.config.scan_mode ?? "branch";
    const baseBranch = this.config.base_branch ?? "main";

    const args = ["detect", "--report-format", "json", "--report-path", "/dev/stdout"];

    switch (scanMode) {
      case "branch":
        // Scan only commits on current branch since diverging from base branch
        args.push("--log-opts", `${baseBranch}..HEAD`);
        break;
      case "files":
        // Scan filesystem only (no git history)
        args.push("--source", ".", "--no-git");
        break;
      case "staged":
        // Scan only staged files
        args.push("--staged");
        break;
      case "full":
        // Scan entire git history (no special flags needed)
        break;
    }

    // Use custom config if it exists - use absolute path for reliability
    const configPath = this.findGitleaksConfig(projectRoot);
    if (configPath) {
      const absoluteConfigPath = path.join(projectRoot, configPath);
      args.push("--config", absoluteConfigPath);
    }

    return args;
  }

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    try {
      const args = this.buildArgs(projectRoot);

      const result = await execa("gitleaks", args, {
        cwd: projectRoot,
        reject: false,
        timeout: 5 * 60 * 1000,
      });

      return this.processResult(result, elapsed);
    } catch (error) {
      return this.handleRunError(error, elapsed);
    }
  }

  private isBinaryNotFound(result: Awaited<ReturnType<typeof execa>>): boolean {
    const execaResult = result as Awaited<ReturnType<typeof execa>> & {
      code?: string;
      message?: string;
    };
    return (
      execaResult.code === "ENOENT" ||
      (execaResult.failed && String(execaResult.message ?? "").includes("ENOENT"))
    );
  }

  private processResult(
    result: Awaited<ReturnType<typeof execa>>,
    elapsed: () => number
  ): CheckResult {
    if (this.isBinaryNotFound(result)) {
      return this.skipNotInstalled(elapsed());
    }

    // Exit code 0 = no leaks found, exit code 1 = leaks found
    if (result.exitCode === 0) {
      return this.pass(elapsed());
    }

    if (result.exitCode === 1) {
      return this.processLeaksFound(result, elapsed);
    }

    // Other exit codes are errors
    const errorMsg = result.stderr ?? result.stdout ?? "Unknown error";
    return this.fail([this.createErrorViolation(`gitleaks error: ${errorMsg}`)], elapsed());
  }

  private processLeaksFound(
    result: Awaited<ReturnType<typeof execa>>,
    elapsed: () => number
  ): CheckResult {
    const output = String(result.stdout ?? "");
    const violations = this.parseOutput(output);

    if (violations === null) {
      return this.fail([this.createErrorViolation(`Failed to parse gitleaks output`)], elapsed());
    }

    return this.fromViolations(violations, elapsed());
  }

  private handleRunError(error: unknown, elapsed: () => number): CheckResult {
    if (this.isNotInstalledError(error)) {
      return this.skipNotInstalled(elapsed());
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return this.fail([this.createErrorViolation(`gitleaks error: ${message}`)], elapsed());
  }

  private parseOutput(output: string): Violation[] | null {
    if (!output.trim()) {
      return [];
    }

    try {
      const findings = JSON.parse(output) as GitleaksFinding[];
      const violations: Violation[] = [];

      for (const finding of findings) {
        violations.push({
          rule: `${this.rule}.${this.toolId}`,
          tool: this.toolId,
          file: finding.File,
          line: finding.StartLine,
          column: finding.StartColumn,
          message: `${finding.RuleID}: ${finding.Description}`,
          code: finding.RuleID,
          severity: "error",
        });
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

  /**
   * Audit - gitleaks doesn't require config, just check if installed
   */
  async audit(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    try {
      await execa("gitleaks", ["version"], {
        cwd: projectRoot,
        reject: true,
        timeout: 10 * 1000,
      });

      return this.pass(Date.now() - startTime);
    } catch (error) {
      if (this.isNotInstalledError(error)) {
        return this.skipNotInstalled(Date.now() - startTime);
      }

      const message = error instanceof Error ? error.message : "Unknown error";
      return this.fail(
        [this.createErrorViolation(`gitleaks audit error: ${message}`)],
        Date.now() - startTime
      );
    }
  }
}
