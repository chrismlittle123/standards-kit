import * as fs from "node:fs";

import { execa } from "execa";

import { TIMEOUTS } from "../../constants.js";
import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseToolRunner } from "./base.js";

/** Knip JSON output format for a dependency issue */
interface KnipDependencyIssue {
  name: string;
  line?: number;
  col?: number;
  pos?: number;
}

/** Knip JSON output format for an export issue */
interface KnipExportIssue {
  name: string;
  line?: number;
  col?: number;
  pos?: number;
  type?: string;
}

/** Knip JSON output format for issues per file */
interface KnipFileIssue {
  file: string;
  dependencies?: KnipDependencyIssue[];
  devDependencies?: KnipDependencyIssue[];
  optionalPeerDependencies?: KnipDependencyIssue[];
  unlisted?: KnipDependencyIssue[];
  binaries?: KnipDependencyIssue[];
  unresolved?: KnipDependencyIssue[];
  exports?: KnipExportIssue[];
  types?: KnipExportIssue[];
  enumMembers?: Record<string, KnipExportIssue[]>;
  duplicates?: KnipExportIssue[];
}

/** Knip JSON output format */
interface KnipOutput {
  files: string[];
  issues: KnipFileIssue[];
}

/**
 * Knip tool runner for detecting unused code
 */
export class KnipRunner extends BaseToolRunner {
  readonly name = "Knip";
  readonly rule = "code.unused";
  readonly toolId = "knip";
  readonly configFiles = [
    "knip.json",
    "knip.jsonc",
    "knip.js",
    "knip.ts",
    "knip.config.js",
    "knip.config.ts",
  ];

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    // Knip works without a config file (uses defaults), so we don't skip if no config
    // It just needs package.json to exist
    try {
      const result = await execa("npx", ["knip", "--reporter", "json"], {
        cwd: projectRoot,
        reject: false,
        timeout: TIMEOUTS.codeTool,
      });

      // Knip outputs JSON to stdout
      const output = result.stdout || result.stderr;
      const violations = this.parseOutput(output, projectRoot);

      if (violations === null && result.exitCode !== 0) {
        return this.fail(
          [this.createErrorViolation(`Knip error: ${result.stderr}`)],
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
        [this.createErrorViolation(`Knip error: ${message}`)],
        Date.now() - startTime
      );
    }
  }

  private parseOutput(output: string, _projectRoot: string): Violation[] | null {
    try {
      const result = JSON.parse(output) as KnipOutput;
      const violations: Violation[] = [];

      // Unused files
      for (const file of result.files) {
        violations.push({
          rule: `${this.rule}.${this.toolId}`,
          tool: this.toolId,
          file,
          message: "Unused file",
          code: "unused-file",
          severity: "warning",
        });
      }

      // Issues per file
      for (const issue of result.issues) {
        violations.push(...this.parseFileIssues(issue));
      }

      return violations;
    } catch {
      return null;
    }
  }

  private parseFileIssues(issue: KnipFileIssue): Violation[] {
    const file = issue.file;
    return [
      ...this.mapToViolations(file, issue.dependencies, {
        prefix: "Unused dependency",
        code: "unused-dependency",
        severity: "warning",
      }),
      ...this.mapToViolations(file, issue.devDependencies, {
        prefix: "Unused devDependency",
        code: "unused-devDependency",
        severity: "warning",
      }),
      ...this.mapToViolations(file, issue.unlisted, {
        prefix: "Unlisted dependency",
        code: "unlisted-dependency",
        severity: "error",
      }),
      ...this.mapToViolations(file, issue.unresolved, {
        prefix: "Unresolved import",
        code: "unresolved-import",
        severity: "error",
      }),
      ...this.mapToViolations(file, issue.exports, {
        prefix: "Unused export",
        code: "unused-export",
        severity: "warning",
      }),
      ...this.mapToViolations(file, issue.types, {
        prefix: "Unused type",
        code: "unused-type",
        severity: "warning",
      }),
      ...this.mapToViolations(file, issue.duplicates, {
        prefix: "Duplicate export",
        code: "duplicate-export",
        severity: "warning",
      }),
    ];
  }

  private mapToViolations(
    file: string,
    items: { name: string; line?: number; col?: number }[] | undefined,
    opts: { prefix: string; code: string; severity: "error" | "warning" }
  ): Violation[] {
    return (items ?? []).map((item) => ({
      rule: `${this.rule}.${this.toolId}`,
      tool: this.toolId,
      file,
      line: item.line,
      column: item.col,
      message: `${opts.prefix}: ${item.name}`,
      code: opts.code,
      severity: opts.severity,
    }));
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
   * Audit - Knip doesn't require a config file, so just check if it can run
   */
  async audit(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    // Check if package.json exists (required for Knip)
    const hasPackageJson = fs.existsSync(`${projectRoot}/package.json`);

    if (!hasPackageJson) {
      return this.fail(
        [
          {
            rule: `${this.rule}.${this.toolId}`,
            tool: "audit",
            message: "package.json not found (required for Knip)",
            severity: "error",
          },
        ],
        Date.now() - startTime
      );
    }

    return this.pass(Date.now() - startTime);
  }
}
