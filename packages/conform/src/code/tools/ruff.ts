import * as fs from "node:fs";
import * as path from "node:path";

import { execa } from "execa";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseToolRunner } from "./base.js";

/** Check if a file is a symlink */
function isSymlink(filePath: string): boolean {
  try {
    const stats = fs.lstatSync(filePath);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Ruff JSON output message format */
interface RuffMessage {
  code: string;
  message: string;
  filename: string;
  location: {
    row: number;
    column: number;
  };
}

/** Ruff configuration options from standards.toml */
interface RuffConfig {
  enabled?: boolean;
  format?: boolean;
  "line-length"?: number;
  lint?: {
    select?: string[];
    ignore?: string[];
  };
}

/**
 * Ruff (Python linter) tool runner
 */
export class RuffRunner extends BaseToolRunner {
  readonly name = "Ruff";
  readonly rule = "code.linting";
  readonly toolId = "ruff";
  readonly configFiles = ["ruff.toml", ".ruff.toml"];

  private ruffConfig: RuffConfig = {};

  /**
   * Set the Ruff configuration from standards.toml
   */
  setConfig(config: RuffConfig): void {
    this.ruffConfig = config;
  }

  /**
   * Build CLI arguments from config
   */
  private buildCliArgs(): string[] {
    const args = ["check", ".", "--output-format", "json"];

    if (this.ruffConfig["line-length"]) {
      args.push("--line-length", String(this.ruffConfig["line-length"]));
    }

    if (this.ruffConfig.lint?.select?.length) {
      args.push("--select", this.ruffConfig.lint.select.join(","));
    }

    if (this.ruffConfig.lint?.ignore?.length) {
      args.push("--ignore", this.ruffConfig.lint.ignore.join(","));
    }

    return args;
  }

  /**
   * Override hasConfig to also check for [tool.ruff] in pyproject.toml
   */
  protected override hasConfig(projectRoot: string): boolean {
    // Check dedicated config files
    if (super.hasConfig(projectRoot)) {
      return true;
    }

    // Check pyproject.toml for [tool.ruff] section
    return this.hasPyprojectConfig(projectRoot);
  }

  private hasPyprojectConfig(projectRoot: string): boolean {
    const pyprojectPath = path.join(projectRoot, "pyproject.toml");
    if (!fs.existsSync(pyprojectPath)) {
      return false;
    }

    try {
      const content = fs.readFileSync(pyprojectPath, "utf-8");
      return content.includes("[tool.ruff]");
    } catch {
      return false;
    }
  }

  private async hasPythonFiles(projectRoot: string): Promise<boolean> {
    try {
      const result = await execa("find", [".", "-name", "*.py", "-type", "f"], {
        cwd: projectRoot,
        reject: false,
      });
      return Boolean(result.stdout.trim());
    } catch {
      return false;
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

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    // Skip if no Python files
    if (!(await this.hasPythonFiles(projectRoot))) {
      return this.skip("No Python files found", Date.now() - startTime);
    }

    try {
      const result = await execa("ruff", this.buildCliArgs(), {
        cwd: projectRoot,
        reject: false,
        timeout: 5 * 60 * 1000,
      });

      // Check if ruff binary was not found
      if (this.isBinaryNotFound(result)) {
        return this.skipNotInstalled(Date.now() - startTime);
      }

      const violations = this.parseOutput(result.stdout, projectRoot);

      // Handle parse failure with non-zero exit
      if (violations === null && result.exitCode !== 0 && result.stderr) {
        return this.fail(
          [this.createErrorViolation(`Ruff error: ${result.stderr}`)],
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
        [this.createErrorViolation(`Ruff error: ${message}`)],
        Date.now() - startTime
      );
    }
  }

  private skip(reason: string, duration: number): CheckResult {
    return {
      name: this.name,
      rule: this.rule,
      passed: true,
      violations: [],
      skipped: true,
      skipReason: reason,
      duration,
    };
  }

  private parseOutput(stdout: string, projectRoot: string): Violation[] | null {
    if (!stdout.trim()) {
      return [];
    }

    try {
      const results = JSON.parse(stdout) as RuffMessage[];
      return results
        .filter((msg) => {
          // Skip parse errors (E999) for symlinks - they may point to non-Python files
          if (msg.code === "E999") {
            const fullPath = path.isAbsolute(msg.filename)
              ? msg.filename
              : path.join(projectRoot, msg.filename);
            if (isSymlink(fullPath)) {
              return false;
            }
          }
          return true;
        })
        .map((msg) => ({
          rule: `${this.rule}.${this.toolId}`,
          tool: this.toolId,
          file: path.relative(projectRoot, msg.filename),
          line: msg.location.row,
          column: msg.location.column,
          message: msg.message,
          code: msg.code,
          severity: "error" as const,
        }));
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
   * Override audit to include pyproject.toml check
   */
  override async audit(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    if (this.hasConfig(projectRoot)) {
      return {
        name: `${this.name} Config`,
        rule: this.rule,
        passed: true,
        violations: [],
        skipped: false,
        duration: Date.now() - startTime,
      };
    }

    const allConfigs = [...this.configFiles, "pyproject.toml [tool.ruff]"];
    return {
      name: `${this.name} Config`,
      rule: this.rule,
      passed: false,
      violations: [
        {
          rule: `${this.rule}.${this.toolId}`,
          tool: "audit",
          message: `Ruff config not found. Expected one of: ${allConfigs.join(", ")}`,
          severity: "error",
        },
      ],
      skipped: false,
      duration: Date.now() - startTime,
    };
  }
}
