import * as fs from "node:fs";
import * as path from "node:path";

import { execa } from "execa";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseToolRunner } from "./base.js";

/** pnpm audit advisory entry */
interface PnpmAdvisory {
  module_name: string;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  title: string;
  url: string;
  findings: { version: string; paths: string[] }[];
}

/** pnpm audit JSON output format */
interface PnpmAuditOutput {
  advisories?: Record<string, PnpmAdvisory>;
  metadata: {
    vulnerabilities: {
      info: number;
      low: number;
      moderate: number;
      high: number;
      critical: number;
    };
  };
}

/** pnpm audit configuration */
export interface PnpmAuditConfig {
  enabled?: boolean;
  exclude_dev?: boolean;
}

/**
 * pnpm dependency audit tool runner for detecting vulnerabilities.
 * Only checks production dependencies by default (exclude_dev: true).
 */
export class PnpmAuditRunner extends BaseToolRunner {
  readonly name = "pnpmaudit";
  readonly rule = "code.security";
  readonly toolId = "pnpmaudit";
  readonly configFiles = ["pnpm-lock.yaml"];

  private config: PnpmAuditConfig = {
    enabled: false,
    exclude_dev: true,
  };

  /**
   * Set configuration for the runner
   */
  setConfig(config: PnpmAuditConfig): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if pnpm-lock.yaml exists
   */
  private hasLockFile(projectRoot: string): boolean {
    return fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"));
  }

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    if (!this.hasLockFile(projectRoot)) {
      return this.fail([this.createErrorViolation("No pnpm-lock.yaml found")], elapsed());
    }

    try {
      const args = ["audit", "--json"];

      // Add --prod flag to exclude dev dependencies
      if (this.config.exclude_dev !== false) {
        args.push("--prod");
      }

      const result = await execa("pnpm", args, {
        cwd: projectRoot,
        reject: false,
        timeout: 5 * 60 * 1000,
      });

      return this.processAuditResult(result, elapsed);
    } catch (error) {
      return this.handleRunError(error, elapsed);
    }
  }

  private processAuditResult(
    result: Awaited<ReturnType<typeof execa>>,
    elapsed: () => number
  ): CheckResult {
    const output = String(result.stdout ?? result.stderr ?? "");
    const violations = this.parseOutput(output);

    if (violations === null) {
      if (result.exitCode !== 0) {
        return this.fail(
          [this.createErrorViolation(`pnpm audit error: ${result.stderr ?? "Unknown error"}`)],
          elapsed()
        );
      }
      return this.pass(elapsed());
    }

    return this.fromViolations(violations, elapsed());
  }

  private handleRunError(error: unknown, elapsed: () => number): CheckResult {
    if (this.isNotInstalledError(error)) {
      return this.skipNotInstalled(elapsed());
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return this.fail([this.createErrorViolation(`pnpm audit error: ${message}`)], elapsed());
  }

  private parseOutput(output: string): Violation[] | null {
    try {
      const result = JSON.parse(output) as PnpmAuditOutput;
      const violations: Violation[] = [];

      if (!result.advisories) {
        return violations;
      }

      for (const [, advisory] of Object.entries(result.advisories)) {
        const severity = this.mapSeverity(advisory.severity);

        violations.push({
          rule: `${this.rule}.${this.toolId}`,
          tool: this.toolId,
          file: "pnpm-lock.yaml",
          message: `${advisory.module_name}: ${advisory.title}`,
          code: advisory.severity,
          severity,
        });
      }

      return violations;
    } catch {
      return null;
    }
  }

  private mapSeverity(auditSeverity: string): "error" | "warning" {
    switch (auditSeverity) {
      case "critical":
      case "high":
        return "error";
      case "moderate":
      case "low":
      case "info":
      default:
        return "warning";
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
   * Audit - check if pnpm-lock.yaml exists
   */
  async audit(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    if (!this.hasLockFile(projectRoot)) {
      return this.fail(
        [
          {
            rule: `${this.rule}.${this.toolId}`,
            tool: "audit",
            message: "No pnpm-lock.yaml found",
            severity: "error",
          },
        ],
        Date.now() - startTime
      );
    }

    return this.pass(Date.now() - startTime);
  }
}
