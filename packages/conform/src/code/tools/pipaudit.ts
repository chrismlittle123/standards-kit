import * as fs from "node:fs";

import { execa } from "execa";

import { TIMEOUTS } from "../../constants.js";
import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseToolRunner } from "./base.js";

/** pip-audit vulnerability entry */
interface PipAuditVulnerability {
  id: string;
  fix_versions: string[];
  aliases: string[];
  description: string;
}

/** pip-audit package entry */
interface PipAuditPackage {
  name: string;
  version: string;
  vulns: PipAuditVulnerability[];
}

/** pip-audit JSON output format */
type PipAuditOutput = PipAuditPackage[];

/**
 * pip-audit tool runner for detecting Python dependency vulnerabilities
 */
export class PipAuditRunner extends BaseToolRunner {
  readonly name = "pipaudit";
  readonly rule = "code.security";
  readonly toolId = "pipaudit";
  readonly configFiles = ["requirements.txt", "pyproject.toml", "setup.py"];

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;
    this.projectRoot = projectRoot;

    if (!this.hasConfig(projectRoot)) {
      return this.failNoConfig(elapsed());
    }

    try {
      const result = await this.runPipAudit(projectRoot);
      return this.processResult(result, elapsed);
    } catch (error) {
      if (this.isNotInstalledError(error)) {
        return this.skipNotInstalled(elapsed());
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      return this.fail([this.createErrorViolation(`pip-audit error: ${message}`)], elapsed());
    }
  }

  private processResult(
    result: Awaited<ReturnType<typeof execa>>,
    elapsed: () => number
  ): CheckResult {
    const output = String(result.stdout ?? result.stderr ?? "");
    const violations = this.parseOutput(output);

    if (violations === null) {
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        return this.fail(
          [this.createErrorViolation(`pip-audit error: ${result.stderr ?? "Unknown error"}`)],
          elapsed()
        );
      }
      return this.pass(elapsed());
    }

    return this.fromViolations(violations, elapsed());
  }

  private async runPipAudit(projectRoot: string): Promise<Awaited<ReturnType<typeof execa>>> {
    // Build args - use -r requirements.txt if it exists to audit project deps, not environment
    const args = ["pip-audit", "--format", "json"];
    if (fs.existsSync(`${projectRoot}/requirements.txt`)) {
      args.push("-r", "requirements.txt");
    }

    // Try uvx first
    try {
      return await execa("uvx", args, {
        cwd: projectRoot,
        reject: false,
        timeout: TIMEOUTS.codeTool,
      });
    } catch {
      // Fall back to pip-audit directly (remove "pip-audit" from args for direct call)
      return await execa("pip-audit", args.slice(1), {
        cwd: projectRoot,
        reject: false,
        timeout: TIMEOUTS.codeTool,
      });
    }
  }

  private parseOutput(output: string): Violation[] | null {
    try {
      const result = JSON.parse(output) as PipAuditOutput;
      const violations: Violation[] = [];

      for (const pkg of result) {
        for (const vuln of pkg.vulns) {
          const severity = this.mapSeverity(vuln);
          const fixInfo = this.getFixInfo(vuln);
          const vulnId = vuln.aliases.length > 0 ? vuln.aliases[0] : vuln.id;

          violations.push({
            rule: `${this.rule}.${this.toolId}`,
            tool: this.toolId,
            file: this.findDependencyFile(pkg.name),
            message: `${pkg.name}@${pkg.version}: ${vulnId}${fixInfo}`,
            code: vuln.id,
            severity,
          });
        }
      }

      return violations;
    } catch {
      return null;
    }
  }

  private mapSeverity(vuln: PipAuditVulnerability): "error" | "warning" {
    // If a fix is available, it's an error (should be fixed)
    // If no fix available, it's a warning (awareness only)
    return vuln.fix_versions.length > 0 ? "error" : "warning";
  }

  private getFixInfo(vuln: PipAuditVulnerability): string {
    if (vuln.fix_versions.length === 0) {
      return " (no fix available)";
    }
    return ` (fix: ${vuln.fix_versions[0]})`;
  }

  private projectRoot = "";

  private findDependencyFile(_pkgName: string): string | undefined {
    // Check which dependency files actually exist and return the first one found
    // We can't determine which exact file contains the package without parsing,
    // so return the first existing file or undefined if none found
    const possibleFiles = ["requirements.txt", "pyproject.toml", "setup.py"];
    for (const file of possibleFiles) {
      if (this.projectRoot && fs.existsSync(`${this.projectRoot}/${file}`)) {
        return file;
      }
    }
    return undefined;
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
   * Audit - check if Python dependency files exist
   */
  async audit(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    // Check for any Python project file
    const hasPythonDeps =
      fs.existsSync(`${projectRoot}/requirements.txt`) ||
      fs.existsSync(`${projectRoot}/pyproject.toml`) ||
      fs.existsSync(`${projectRoot}/setup.py`);

    if (!hasPythonDeps) {
      return this.fail(
        [
          {
            rule: `${this.rule}.${this.toolId}`,
            tool: "audit",
            message:
              "No Python dependency file found (requirements.txt, pyproject.toml, or setup.py)",
            severity: "error",
          },
        ],
        Date.now() - startTime
      );
    }

    return this.pass(Date.now() - startTime);
  }
}
