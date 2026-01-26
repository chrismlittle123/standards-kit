import * as fs from "node:fs";
import * as path from "node:path";

import * as yaml from "js-yaml";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";

/** Coverage configuration from standards.toml */
interface CoverageConfig {
  enabled?: boolean;
  min_threshold?: number;
  enforce_in?: "ci" | "config" | "both";
  ci_workflow?: string;
  ci_job?: string;
}

/** Coverage config file detection result */
interface CoverageConfigResult {
  found: boolean;
  file?: string;
  threshold?: number;
  error?: string;
}

/** Helper to safely read and parse JSON */
function parseJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Helper to read file content */
function readFileContent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Extract threshold from vitest/jest style config */
function extractThresholdFromContent(content: string): number | undefined {
  const match = /(?:lines|statements|branches|functions)\s*:\s*(\d+)/.exec(content);
  return match ? parseInt(match[1], 10) : undefined;
}

/** Parse nyc config file content (JSON or YAML) */
function parseNycConfigContent(
  content: string,
  configFile: string
): { config: Record<string, unknown> } | { error: string } {
  try {
    const config =
      configFile.endsWith(".yaml") || configFile.endsWith(".yml")
        ? (yaml.load(content) as Record<string, unknown>)
        : (JSON.parse(content) as Record<string, unknown>);
    return { config };
  } catch {
    return { error: "Failed to parse config file" };
  }
}

/** Extract threshold from nyc config object */
function extractNycThreshold(config: Record<string, unknown>): number | undefined {
  return (
    (config.lines as number | undefined) ??
    (config.statements as number | undefined) ??
    (config.branches as number | undefined) ??
    (config.functions as number | undefined)
  );
}

/**
 * Coverage enforcement runner.
 * Checks that coverage thresholds are configured in CI workflows and/or config files.
 */
export class CoverageRunner extends BaseProcessToolRunner {
  readonly name = "Coverage";
  readonly rule = "process.coverage";
  readonly toolId = "coverage";

  private config: CoverageConfig = {
    enabled: false,
    enforce_in: "config",
  };

  /**
   * Set configuration from standards.toml
   */
  setConfig(config: CoverageConfig): void {
    this.config = { ...this.config, ...config };
  }

  /** Check for vitest coverage config */
  private checkVitestConfig(projectRoot: string): CoverageConfigResult {
    const configFiles = [
      "vitest.config.ts",
      "vitest.config.js",
      "vitest.config.mts",
      "vitest.config.mjs",
    ];

    for (const configFile of configFiles) {
      const configPath = path.join(projectRoot, configFile);
      const content = readFileContent(configPath);
      if (!content) {
        continue;
      }

      const hasThreshold =
        /coverage\s*:\s*\{[^}]*thresholds?\s*:/s.test(content) ||
        /thresholds?\s*:\s*\{[^}]*(?:lines|statements|branches|functions)\s*:/s.test(content);

      if (hasThreshold) {
        return { found: true, file: configFile, threshold: extractThresholdFromContent(content) };
      }
      return { found: false, file: configFile, error: "No coverage thresholds configured" };
    }
    return { found: false };
  }

  /** Check jest config file */
  private checkJestConfigFile(projectRoot: string): CoverageConfigResult {
    const configFiles = ["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs"];

    for (const configFile of configFiles) {
      const configPath = path.join(projectRoot, configFile);
      const content = readFileContent(configPath);
      if (!content) {
        continue;
      }

      if (/coverageThreshold\s*:/s.test(content)) {
        return { found: true, file: configFile, threshold: extractThresholdFromContent(content) };
      }
      return { found: false, file: configFile, error: "No coverageThreshold configured" };
    }
    return { found: false };
  }

  /** Check jest config in package.json */
  private checkJestPackageJson(projectRoot: string): CoverageConfigResult {
    const pkg = parseJsonFile(path.join(projectRoot, "package.json"));
    if (!pkg) {
      return { found: false };
    }

    const jestConfig = pkg.jest as Record<string, unknown> | undefined;
    if (!jestConfig?.coverageThreshold) {
      return { found: false };
    }

    const globalThreshold = (jestConfig.coverageThreshold as Record<string, unknown>).global as
      | { lines?: number; statements?: number; branches?: number; functions?: number }
      | undefined;
    if (!globalThreshold) {
      return { found: false };
    }

    const threshold =
      globalThreshold.lines ??
      globalThreshold.statements ??
      globalThreshold.branches ??
      globalThreshold.functions;
    return { found: true, file: "package.json (jest)", threshold };
  }

  /** Check for jest coverage config */
  private checkJestConfig(projectRoot: string): CoverageConfigResult {
    const fileResult = this.checkJestConfigFile(projectRoot);
    if (fileResult.found || fileResult.file) {
      return fileResult;
    }
    return this.checkJestPackageJson(projectRoot);
  }

  /** Check a single nyc config file and return result */
  private checkSingleNycConfig(configFile: string, content: string): CoverageConfigResult {
    const parseResult = parseNycConfigContent(content, configFile);
    if ("error" in parseResult) {
      return { found: false, file: configFile, error: parseResult.error };
    }

    if (!parseResult.config["check-coverage"]) {
      return { found: false, file: configFile, error: "check-coverage not enabled" };
    }

    return { found: true, file: configFile, threshold: extractNycThreshold(parseResult.config) };
  }

  /** Check nyc config file */
  private checkNycConfigFile(projectRoot: string): CoverageConfigResult {
    const nycrcFiles = [".nycrc", ".nycrc.json", ".nycrc.yaml", ".nycrc.yml"];

    for (const configFile of nycrcFiles) {
      const configPath = path.join(projectRoot, configFile);
      if (!fs.existsSync(configPath)) {
        continue;
      }

      const content = readFileContent(configPath);
      if (!content) {
        return { found: false, file: configFile, error: "Failed to read config file" };
      }

      return this.checkSingleNycConfig(configFile, content);
    }
    return { found: false };
  }

  /** Check nyc config in package.json */
  private checkNycPackageJson(projectRoot: string): CoverageConfigResult {
    const pkg = parseJsonFile(path.join(projectRoot, "package.json"));
    if (!pkg) {
      return { found: false };
    }

    const nycConfig = pkg.nyc as Record<string, unknown> | undefined;
    if (!nycConfig?.["check-coverage"]) {
      return { found: false };
    }

    const threshold =
      (nycConfig.lines as number | undefined) ??
      (nycConfig.statements as number | undefined) ??
      (nycConfig.branches as number | undefined) ??
      (nycConfig.functions as number | undefined);
    return { found: true, file: "package.json (nyc)", threshold };
  }

  /** Check for nyc coverage config */
  private checkNycConfig(projectRoot: string): CoverageConfigResult {
    const fileResult = this.checkNycConfigFile(projectRoot);
    if (fileResult.found || fileResult.file) {
      return fileResult;
    }
    return this.checkNycPackageJson(projectRoot);
  }

  /** Check for coverage config in any supported tool */
  private checkConfigCoverage(projectRoot: string): CoverageConfigResult {
    const vitestResult = this.checkVitestConfig(projectRoot);
    if (vitestResult.found) {
      return vitestResult;
    }

    const jestResult = this.checkJestConfig(projectRoot);
    if (jestResult.found) {
      return jestResult;
    }

    const nycResult = this.checkNycConfig(projectRoot);
    if (nycResult.found) {
      return nycResult;
    }

    return {
      found: false,
      error: "No coverage threshold config found (checked vitest, jest, nyc)",
    };
  }

  /** Check if a step has coverage enforcement */
  private stepHasCoverage(run: string): boolean {
    if (
      !run.includes("--coverage") &&
      !run.includes("test:coverage") &&
      !run.includes("coverage:check")
    ) {
      return false;
    }
    return (
      run.includes("threshold") ||
      run.includes("check-coverage") ||
      run.includes("--coverage.") ||
      run.includes("test:coverage") ||
      run.includes("coverage:check")
    );
  }

  /** Check a single job for coverage enforcement */
  private checkJobForCoverage(
    job: Record<string, unknown>,
    jobName: string,
    workflowFile: string
  ): CoverageConfigResult | null {
    const steps = job.steps as { run?: string }[] | undefined;
    if (!steps) {
      return null;
    }

    for (const step of steps) {
      if (step.run && this.stepHasCoverage(step.run)) {
        return { found: true, file: `${workflowFile} (job: ${jobName})` };
      }
    }
    return null;
  }

  /** Check workflow jobs for coverage */
  private checkWorkflowJobs(
    jobs: Record<string, Record<string, unknown>>,
    targetJob: string | undefined,
    workflowFile: string
  ): CoverageConfigResult {
    if (targetJob && targetJob in jobs) {
      const result = this.checkJobForCoverage(jobs[targetJob], targetJob, workflowFile);
      if (result) {
        return result;
      }
    } else if (!targetJob) {
      for (const [jobName, job] of Object.entries(jobs)) {
        const result = this.checkJobForCoverage(job, jobName, workflowFile);
        if (result) {
          return result;
        }
      }
    }

    return { found: false, file: workflowFile, error: "No coverage enforcement found in workflow" };
  }

  /** Check for coverage enforcement in CI workflow */
  private checkCiCoverage(projectRoot: string): CoverageConfigResult {
    const workflowFile = this.config.ci_workflow ?? "ci.yml";
    const workflowPath = path.join(projectRoot, ".github", "workflows", workflowFile);

    const content = readFileContent(workflowPath);
    if (!content) {
      return { found: false, error: `Workflow file not found: ${workflowFile}` };
    }

    let workflow: Record<string, unknown>;
    try {
      workflow = yaml.load(content) as Record<string, unknown>;
    } catch {
      return { found: false, file: workflowFile, error: "Failed to parse workflow file" };
    }

    const jobs = workflow.jobs as Record<string, Record<string, unknown>> | undefined;
    if (!jobs) {
      return { found: false, file: workflowFile, error: "No jobs found in workflow" };
    }

    return this.checkWorkflowJobs(jobs, this.config.ci_job, workflowFile);
  }

  /** Validate config coverage and add violations if needed */
  private validateConfigCoverage(projectRoot: string, violations: Violation[]): void {
    const configResult = this.checkConfigCoverage(projectRoot);

    // If min_threshold is set in standards.toml, that's a valid coverage config
    // (no need for tool-specific config like vitest.config.ts or jest.config.js)
    const hasCheckTomlThreshold = this.config.min_threshold !== undefined;

    if (!configResult.found && !hasCheckTomlThreshold) {
      violations.push({
        rule: `${this.rule}.config`,
        tool: this.toolId,
        message: configResult.error ?? "No coverage threshold configuration found",
        severity: "error",
      });
      return;
    }

    // If tool config exists, validate its threshold meets the minimum
    if (
      configResult.found &&
      this.config.min_threshold !== undefined &&
      configResult.threshold !== undefined
    ) {
      if (configResult.threshold < this.config.min_threshold) {
        violations.push({
          rule: `${this.rule}.threshold`,
          tool: this.toolId,
          message: `Coverage threshold ${configResult.threshold}% is below minimum ${this.config.min_threshold}% (in ${configResult.file})`,
          severity: "error",
        });
      }
    }
  }

  /** Validate CI coverage and add violations if needed */
  private validateCiCoverage(projectRoot: string, violations: Violation[]): void {
    const ciResult = this.checkCiCoverage(projectRoot);

    if (!ciResult.found) {
      violations.push({
        rule: `${this.rule}.ci`,
        tool: this.toolId,
        message: ciResult.error ?? "No coverage enforcement found in CI workflow",
        severity: "error",
      });
    }
  }

  /** Run coverage validation */
  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    const violations: Violation[] = [];
    const enforceIn = this.config.enforce_in ?? "config";

    if (enforceIn === "config" || enforceIn === "both") {
      this.validateConfigCoverage(projectRoot, violations);
    }

    if (enforceIn === "ci" || enforceIn === "both") {
      this.validateCiCoverage(projectRoot, violations);
    }

    return violations.length > 0
      ? this.fromViolations(violations, elapsed())
      : this.pass(elapsed());
  }
}
