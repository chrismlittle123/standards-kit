import * as fs from "node:fs";
import * as path from "node:path";

import { execa } from "execa";

import { CheckResultBuilder, type CheckResult, type Violation } from "../../core/index.js";
import { BaseToolRunner } from "./base.js";

/** Coverage run configuration from standards.toml */
interface CoverageRunConfig {
  enabled?: boolean;
  min_threshold?: number;
  runner?: "vitest" | "jest" | "pytest" | "auto";
  command?: string;
}

/** Parsed coverage data */
interface CoverageData {
  lines?: number;
  statements?: number;
  branches?: number;
  functions?: number;
}

/** File coverage data from coverage-final.json */
interface FileCoverageData {
  s?: Record<string, number>;
  f?: Record<string, number>;
  b?: Record<string, number[]>;
}

/** Check if a config file exists */
function configExists(projectRoot: string, configFile: string): boolean {
  return fs.existsSync(path.join(projectRoot, configFile));
}

/** Check if any config from a list exists */
function findConfig(projectRoot: string, configs: string[]): boolean {
  return configs.some((config) => configExists(projectRoot, config));
}

/** Check for jest config in package.json */
function hasJestInPackageJson(projectRoot: string): boolean {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
    return Boolean(pkg.jest);
  } catch {
    return false;
  }
}

/** Safely extract pct from a coverage entry */
function getPct(entry: { pct?: number } | undefined): number | undefined {
  return entry?.pct;
}

/** Parse coverage-summary.json format */
function parseSummaryFormat(data: Record<string, unknown>): CoverageData | null {
  if (!data.total || typeof data.total !== "object") {
    return null;
  }
  const total = data.total as Record<string, { pct?: number } | undefined>;
  return {
    lines: getPct(total.lines),
    statements: getPct(total.statements),
    branches: getPct(total.branches),
    functions: getPct(total.functions),
  };
}

/** Parse pytest-cov format */
function parsePytestFormat(data: Record<string, unknown>): CoverageData | null {
  if (!data.totals || typeof data.totals !== "object") {
    return null;
  }
  const totals = data.totals as { percent_covered?: number };
  if (totals.percent_covered === undefined) {
    return null;
  }
  return { lines: totals.percent_covered };
}

/** Count covered items in a record */
function countCovered(items: Record<string, number>): { total: number; covered: number } {
  let total = 0;
  let covered = 0;
  for (const count of Object.values(items)) {
    total++;
    if (count > 0) {
      covered++;
    }
  }
  return { total, covered };
}

/** Count covered branches */
function countCoveredBranches(branches: Record<string, number[]>): {
  total: number;
  covered: number;
} {
  let total = 0;
  let covered = 0;
  for (const counts of Object.values(branches)) {
    for (const count of counts) {
      total++;
      if (count > 0) {
        covered++;
      }
    }
  }
  return { total, covered };
}

/** Compute percentage from totals */
function computePercentage(total: number, covered: number): number {
  return total > 0 ? (covered / total) * 100 : 100;
}

/** Default coverage counts */
const zeroCounts = { total: 0, covered: 0 };

/** Process a single file's coverage data */
function processFileCoverage(fileData: FileCoverageData): {
  statements: { total: number; covered: number };
  functions: { total: number; covered: number };
  branches: { total: number; covered: number };
} {
  return {
    statements: fileData.s ? countCovered(fileData.s) : zeroCounts,
    functions: fileData.f ? countCovered(fileData.f) : zeroCounts,
    branches: fileData.b ? countCoveredBranches(fileData.b) : zeroCounts,
  };
}

/** Accumulate coverage totals from multiple files */
interface CoverageTotals {
  statements: { total: number; covered: number };
  functions: { total: number; covered: number };
  branches: { total: number; covered: number };
}

/** Create empty coverage totals */
function createEmptyTotals(): CoverageTotals {
  return {
    statements: { total: 0, covered: 0 },
    functions: { total: 0, covered: 0 },
    branches: { total: 0, covered: 0 },
  };
}

/** Add file coverage to totals */
function addFileCoverage(
  totals: CoverageTotals,
  fileCov: ReturnType<typeof processFileCoverage>
): void {
  totals.statements.total += fileCov.statements.total;
  totals.statements.covered += fileCov.statements.covered;
  totals.functions.total += fileCov.functions.total;
  totals.functions.covered += fileCov.functions.covered;
  totals.branches.total += fileCov.branches.total;
  totals.branches.covered += fileCov.branches.covered;
}

/** Convert totals to coverage data */
function totalsToPercentages(totals: CoverageTotals): CoverageData {
  return {
    statements: computePercentage(totals.statements.total, totals.statements.covered),
    functions: computePercentage(totals.functions.total, totals.functions.covered),
    branches: computePercentage(totals.branches.total, totals.branches.covered),
  };
}

/** Check if data looks like coverage-final format */
function isCoverageFinalFormat(data: Record<string, unknown>): boolean {
  const files = Object.keys(data).filter((key) => key !== "total");
  if (files.length === 0) {
    return false;
  }
  const firstFile = data[files[0]];
  if (!firstFile || typeof firstFile !== "object") {
    return false;
  }
  const fileData = firstFile as FileCoverageData;
  return Boolean(fileData.s ?? fileData.f ?? fileData.b);
}

/**
 * Coverage verification runner.
 * Runs tests with coverage and verifies the result meets a minimum threshold.
 */
export class CoverageRunRunner extends BaseToolRunner {
  readonly name = "Coverage Run";
  readonly rule = "code.coverage";
  readonly toolId = "coverage-run";
  readonly configFiles: string[] = [];

  private config: CoverageRunConfig = {
    enabled: false,
    min_threshold: 80,
    runner: "auto",
  };

  setConfig(config: CoverageRunConfig): void {
    this.config = { ...this.config, ...config };
  }

  private detectRunner(projectRoot: string): "vitest" | "jest" | "pytest" | null {
    const vitestConfigs = [
      "vitest.config.ts",
      "vitest.config.js",
      "vitest.config.mts",
      "vitest.config.mjs",
    ];
    if (findConfig(projectRoot, vitestConfigs)) {
      return "vitest";
    }

    const jestConfigs = ["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs"];
    if (findConfig(projectRoot, jestConfigs) || hasJestInPackageJson(projectRoot)) {
      return "jest";
    }

    const pytestConfigs = ["pytest.ini", "pyproject.toml", "setup.cfg", "conftest.py"];
    if (findConfig(projectRoot, pytestConfigs)) {
      return "pytest";
    }

    return null;
  }

  private getRunnerCommand(runner: "vitest" | "jest" | "pytest"): { cmd: string; args: string[] } {
    const commands: Record<"vitest" | "jest" | "pytest", { cmd: string; args: string[] }> = {
      vitest: { cmd: "npx", args: ["vitest", "run", "--coverage", "--coverage.reporter=json"] },
      jest: { cmd: "npx", args: ["jest", "--coverage", "--coverageReporters=json"] },
      pytest: { cmd: "pytest", args: ["--cov", "--cov-report=json"] },
    };
    return commands[runner];
  }

  private getTestCommand(projectRoot: string): { cmd: string; args: string[] } | null {
    if (this.config.command) {
      const parts = this.config.command.split(" ");
      return { cmd: parts[0], args: parts.slice(1) };
    }

    const runner =
      this.config.runner === "auto" ? this.detectRunner(projectRoot) : this.config.runner;
    if (!runner) {
      return null;
    }

    return this.getRunnerCommand(runner);
  }

  private parseCoverageReport(projectRoot: string): CoverageData | null {
    const possiblePaths = [
      "coverage/coverage-final.json",
      "coverage/coverage-summary.json",
      ".coverage.json",
      "coverage.json",
    ];

    for (const relativePath of possiblePaths) {
      const fullPath = path.join(projectRoot, relativePath);
      if (!fs.existsSync(fullPath)) {
        continue;
      }

      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const data = JSON.parse(content) as Record<string, unknown>;
        const result = this.extractCoverageData(data);
        if (result) {
          return result;
        }
      } catch {
        // Try next path
      }
    }

    return null;
  }

  private extractCoverageData(data: Record<string, unknown>): CoverageData | null {
    // Try summary format first
    const summaryResult = parseSummaryFormat(data);
    if (summaryResult) {
      return summaryResult;
    }

    // Try pytest format
    const pytestResult = parsePytestFormat(data);
    if (pytestResult) {
      return pytestResult;
    }

    // Try coverage-final.json format
    return this.computeCoverageFromFinal(data);
  }

  private computeCoverageFromFinal(data: Record<string, unknown>): CoverageData | null {
    if (!isCoverageFinalFormat(data)) {
      return null;
    }

    const totals = createEmptyTotals();
    for (const [filePath, fd] of Object.entries(data)) {
      if (filePath !== "total" && fd && typeof fd === "object") {
        addFileCoverage(totals, processFileCoverage(fd as FileCoverageData));
      }
    }

    return totalsToPercentages(totals);
  }

  private getOverallCoverage(data: CoverageData): number {
    if (data.lines !== undefined) {
      return data.lines;
    }
    if (data.statements !== undefined) {
      return data.statements;
    }

    const values = [data.branches, data.functions].filter((v): v is number => v !== undefined);
    if (values.length > 0) {
      return values.reduce((a, b) => a + b, 0) / values.length;
    }

    return 0;
  }

  private async executeTests(
    testCommand: { cmd: string; args: string[] },
    projectRoot: string
  ): Promise<{ exitCode: number | undefined; stderr: string; stdout: string }> {
    const result = await execa(testCommand.cmd, testCommand.args, {
      cwd: projectRoot,
      reject: false,
      timeout: 10 * 60 * 1000,
      env: { ...process.env, CI: "true" },
    });
    return { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout };
  }

  private checkCoverageThreshold(projectRoot: string): CheckResult | null {
    const coverageData = this.parseCoverageReport(projectRoot);
    if (!coverageData) {
      return this.fail(
        [
          this.createViolation(
            "Could not find or parse coverage report. Ensure coverage reporter outputs JSON."
          ),
        ],
        0
      );
    }

    const coverage = this.getOverallCoverage(coverageData);
    const threshold = this.config.min_threshold ?? 80;

    if (coverage < threshold) {
      return this.fail(
        [
          this.createViolation(
            `Coverage ${coverage.toFixed(1)}% is below minimum threshold ${threshold}%`
          ),
        ],
        0
      );
    }

    return null;
  }

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    const testCommand = this.getTestCommand(projectRoot);
    if (!testCommand) {
      return this.fail(
        [this.createViolation("Could not detect test runner. Set runner or command in config.")],
        elapsed()
      );
    }

    try {
      const result = await this.executeTests(testCommand, projectRoot);
      const exitError = this.validateExitCode(result, elapsed);
      if (exitError) {
        return exitError;
      }

      const thresholdResult = this.checkCoverageThreshold(projectRoot);
      if (thresholdResult) {
        return { ...thresholdResult, duration: elapsed() };
      }

      return this.pass(elapsed());
    } catch (error) {
      return this.handleRunError(error, elapsed);
    }
  }

  /** Validate test command exit code and return error result if invalid */
  private validateExitCode(
    result: { exitCode?: number; stdout: string; stderr: string },
    elapsed: () => number
  ): CheckResult | null {
    if (result.exitCode === undefined) {
      const errorMsg = result.stderr || result.stdout || "Command not found or failed to execute";
      return this.fail(
        [this.createViolation(`Test command failed to execute: ${errorMsg}`)],
        elapsed()
      );
    }

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      const errorMsg = result.stderr || result.stdout;
      return this.fail(
        [
          this.createViolation(
            `Test command failed with exit code ${result.exitCode}: ${errorMsg}`
          ),
        ],
        elapsed()
      );
    }

    return null;
  }

  private handleRunError(error: unknown, elapsed: () => number): CheckResult {
    if (this.isNotInstalledError(error)) {
      return this.skipNotInstalled(elapsed());
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return this.fail([this.createViolation(`Coverage run error: ${message}`)], elapsed());
  }

  override async audit(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    const testCommand = this.getTestCommand(projectRoot);
    if (!testCommand) {
      return CheckResultBuilder.fail(
        `${this.name} Config`,
        this.rule,
        [
          {
            rule: `${this.rule}.${this.toolId}`,
            tool: "audit",
            message: "Could not detect test runner. Configure runner or command in standards.toml.",
            severity: "error",
          },
        ],
        Date.now() - startTime
      );
    }

    return CheckResultBuilder.pass(`${this.name} Config`, this.rule, Date.now() - startTime);
  }

  private createViolation(message: string): Violation {
    return { rule: `${this.rule}.${this.toolId}`, tool: this.toolId, message, severity: "error" };
  }
}
