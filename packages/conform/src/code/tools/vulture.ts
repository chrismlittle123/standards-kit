import * as fs from "node:fs";
import * as path from "node:path";

import { execa } from "execa";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseToolRunner } from "./base.js";

/**
 * Vulture tool runner for detecting dead Python code
 */
export class VultureRunner extends BaseToolRunner {
  readonly name = "Vulture";
  readonly rule = "code.unused";
  readonly toolId = "vulture";
  readonly configFiles: string[] = []; // Vulture doesn't use config files

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
    const execaResult = result as typeof result & { code?: string; message?: string };
    return (
      execaResult.code === "ENOENT" ||
      (execaResult.failed && String(execaResult.message ?? "").includes("ENOENT"))
    );
  }

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    if (!(await this.hasPythonFiles(projectRoot))) {
      return this.skip("No Python files found", Date.now() - startTime);
    }

    try {
      // Exclude common virtual environment and build directories
      const excludePatterns = ".venv,venv,.git,node_modules,__pycache__,dist,build,.tox,.nox,.eggs";
      const result = await execa("vulture", [".", "--exclude", excludePatterns], {
        cwd: projectRoot,
        reject: false,
        timeout: 5 * 60 * 1000,
      });

      if (this.isBinaryNotFound(result)) {
        return this.skipNotInstalled(Date.now() - startTime);
      }

      // Vulture exit codes: 0=clean, 1=invalid input, 2=invalid args, 3=dead code
      if (result.exitCode === 1 || result.exitCode === 2) {
        return this.fail(
          [this.createErrorViolation(`Vulture error: ${result.stderr || result.stdout}`)],
          Date.now() - startTime
        );
      }

      return this.fromViolations(
        this.parseOutput(result.stdout, projectRoot),
        Date.now() - startTime
      );
    } catch (error) {
      return this.handleRunError(error, startTime);
    }
  }

  private handleRunError(error: unknown, startTime: number): CheckResult {
    if (this.isNotInstalledError(error)) {
      return this.skipNotInstalled(Date.now() - startTime);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return this.fail(
      [this.createErrorViolation(`Vulture error: ${message}`)],
      Date.now() - startTime
    );
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

  private parseOutput(stdout: string, projectRoot: string): Violation[] {
    if (!stdout.trim()) {
      return [];
    }

    const violations: Violation[] = [];
    const lines = stdout.trim().split("\n");

    for (const line of lines) {
      const violation = this.parseLine(line, projectRoot);
      if (violation) {
        violations.push(violation);
      }
    }

    return violations;
  }

  /**
   * Parse a single Vulture output line
   * Format: "path/to/file.py:10: unused function 'my_func' (60% confidence)"
   */
  private parseLine(line: string, projectRoot: string): Violation | null {
    // Match: file.py:line: message (confidence% confidence)
    const regex = /^(.+?):(\d+):\s*(.+?)\s*\((\d+)%\s*confidence\)$/;
    const match = regex.exec(line);
    if (!match) {
      return null;
    }

    const [, filePath, lineNum, message, confidence] = match;
    const relPath = path.relative(projectRoot, path.resolve(projectRoot, filePath));

    // Determine code from message
    const code = this.getCodeFromMessage(message);

    return {
      rule: `${this.rule}.${this.toolId}`,
      tool: this.toolId,
      file: relPath,
      line: parseInt(lineNum, 10),
      message: `${message} (${confidence}% confidence)`,
      code,
      severity: "warning",
    };
  }

  private static readonly CODE_PATTERNS: [string, string][] = [
    ["unused function", "unused-function"],
    ["unused class", "unused-class"],
    ["unused method", "unused-method"],
    ["unused variable", "unused-variable"],
    ["unused import", "unused-import"],
    ["unused attribute", "unused-attribute"],
    ["unused property", "unused-property"],
    ["unreachable code", "unreachable-code"],
  ];

  /**
   * Extract a code identifier from the vulture message
   */
  private getCodeFromMessage(message: string): string {
    for (const [pattern, code] of VultureRunner.CODE_PATTERNS) {
      if (message.includes(pattern)) {
        return code;
      }
    }
    return "unused-code";
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
   * Audit - Vulture doesn't require a config file, so just check if Python files exist
   */
  async audit(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    // Check if any Python files exist
    if (!(await this.hasPythonFiles(projectRoot))) {
      return this.skip("No Python files found", Date.now() - startTime);
    }

    // Check if pyproject.toml or setup.py exists (typical Python project)
    const hasPyproject = fs.existsSync(path.join(projectRoot, "pyproject.toml"));
    const hasSetupPy = fs.existsSync(path.join(projectRoot, "setup.py"));
    const hasRequirements = fs.existsSync(path.join(projectRoot, "requirements.txt"));

    if (!hasPyproject && !hasSetupPy && !hasRequirements) {
      return this.fail(
        [
          {
            rule: `${this.rule}.${this.toolId}`,
            tool: "audit",
            message: "No Python project file found (pyproject.toml, setup.py, or requirements.txt)",
            severity: "warning",
          },
        ],
        Date.now() - startTime
      );
    }

    return this.pass(Date.now() - startTime);
  }
}
