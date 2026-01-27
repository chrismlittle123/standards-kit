import * as fs from "node:fs";
import * as path from "node:path";

import { execa } from "execa";

import { TIMEOUTS } from "../../constants.js";
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

/** Parsed ty diagnostic */
interface TyDiagnostic {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * ty Python type checker tool runner
 * ty is Astral's extremely fast Python type checker
 */
export class TyRunner extends BaseToolRunner {
  readonly name = "ty";
  readonly rule = "code.types";
  readonly toolId = "ty";
  readonly configFiles = ["ty.toml"];

  /**
   * Override hasConfig to also check for [tool.ty] in pyproject.toml
   */
  protected override hasConfig(projectRoot: string): boolean {
    // Check for dedicated ty.toml config file
    if (super.hasConfig(projectRoot)) {
      return true;
    }

    // Check pyproject.toml for [tool.ty] section
    return this.hasPyprojectConfig(projectRoot);
  }

  private hasPyprojectConfig(projectRoot: string): boolean {
    const pyprojectPath = path.join(projectRoot, "pyproject.toml");
    if (!fs.existsSync(pyprojectPath)) {
      return false;
    }

    try {
      const content = fs.readFileSync(pyprojectPath, "utf-8");
      return content.includes("[tool.ty]");
    } catch {
      return false;
    }
  }

  /**
   * Override audit to check for ty.toml or [tool.ty] in pyproject.toml
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

    return {
      name: `${this.name} Config`,
      rule: this.rule,
      passed: false,
      violations: [
        {
          rule: `${this.rule}.${this.toolId}`,
          tool: "audit",
          message: "ty config not found. Expected ty.toml or [tool.ty] in pyproject.toml",
          severity: "error",
        },
      ],
      skipped: false,
      duration: Date.now() - startTime,
    };
  }

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    try {
      const result = await execa("uvx", ["ty", "check", "--output-format", "concise", "."], {
        cwd: projectRoot,
        reject: false,
        timeout: TIMEOUTS.codeTool,
      });

      return this.handleExitCode(result, projectRoot, elapsed);
    } catch (error) {
      if (this.isNotInstalledError(error)) {
        return this.skipNotInstalled(elapsed());
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      return this.fail([this.createErrorViolation(`ty error: ${message}`)], elapsed());
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

  private handleExitCode(
    result: Awaited<ReturnType<typeof execa>>,
    projectRoot: string,
    elapsed: () => number
  ): CheckResult {
    // Check if uvx/ty binary was not found
    if (this.isBinaryNotFound(result)) {
      return this.skipNotInstalled(elapsed());
    }

    if (result.exitCode === 0) {
      return this.pass(elapsed());
    }

    if (result.exitCode === 1) {
      return this.handleTypeErrors(result, projectRoot, elapsed);
    }

    if (result.exitCode === 2) {
      // Use trimmed string values so empty strings are falsy with ||
      const stderr = String(result.stderr ?? "").trim();
      const stdout = String(result.stdout ?? "").trim();
      const errorMessage = stderr || stdout || "Configuration error";
      return this.fail(
        [this.createErrorViolation(`ty configuration error: ${errorMessage.slice(0, 500)}`)],
        elapsed()
      );
    }

    const violations = this.handleUnexpectedFailure(result, projectRoot);
    return this.fromViolations(violations, elapsed());
  }

  private handleTypeErrors(
    result: Awaited<ReturnType<typeof execa>>,
    projectRoot: string,
    elapsed: () => number
  ): CheckResult {
    const violations = this.parseOutput(String(result.stdout ?? ""), projectRoot);
    if (violations.length === 0) {
      const errorOutput = String(result.stdout ?? result.stderr ?? "Type check failed");
      return this.fail(
        [this.createErrorViolation(`ty error: ${errorOutput.slice(0, 500)}`)],
        elapsed()
      );
    }
    return this.fail(violations, elapsed());
  }

  private handleUnexpectedFailure(
    result: Awaited<ReturnType<typeof execa>>,
    projectRoot: string
  ): Violation[] {
    const stdout = String(result.stdout ?? "");
    const violations = this.parseOutput(stdout, projectRoot);
    if (violations.length === 0) {
      const errorOutput = stdout || String(result.stderr ?? "");
      if (errorOutput) {
        return [this.createErrorViolation(`ty error: ${errorOutput.slice(0, 500)}`)];
      }
    }
    return violations;
  }

  /**
   * Parse ty concise output into violations
   * Format: file:line:column: severity[rule-code] message
   * Example: test.py:4:15: error[invalid-assignment] Object of type `int` is not assignable to `str`
   */
  private parseOutput(stdout: string, projectRoot: string): Violation[] {
    const diagnostics = this.parseDiagnostics(stdout, projectRoot);
    return diagnostics.map((diag) => ({
      rule: `${this.rule}.${this.toolId}`,
      tool: this.toolId,
      file: diag.file,
      line: diag.line,
      column: diag.column,
      message: diag.message,
      code: diag.code,
      severity: diag.severity,
    }));
  }

  private parseDiagnostics(output: string, projectRoot: string): TyDiagnostic[] {
    const diagnostics: TyDiagnostic[] = [];
    const lines = output.split("\n");
    // Format: file:line:column: severity[rule-code] message
    const diagnosticRegex = /^(.+?):(\d+):(\d+):\s*(error|warning)\[([^\]]+)\]\s*(.+)$/;

    for (const line of lines) {
      const match = diagnosticRegex.exec(line);
      if (match) {
        const [, filePath, lineNum, colNum, severity, code, message] = match;

        // Skip syntax/parse errors for symlinks - they may point to non-Python files
        if (code.includes("syntax") || code.includes("parse")) {
          const fullPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
          if (isSymlink(fullPath)) {
            continue;
          }
        }

        // Only apply path.relative if the path is absolute
        const normalizedPath = path.isAbsolute(filePath)
          ? path.relative(projectRoot, filePath)
          : filePath;
        diagnostics.push({
          file: normalizedPath,
          line: parseInt(lineNum, 10),
          column: parseInt(colNum, 10),
          code,
          message: message.trim(),
          severity: severity as "error" | "warning",
        });
      }
    }

    return diagnostics;
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
