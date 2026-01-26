import { execa } from "execa";

import { type Config } from "../../core/index.js";
import { type CheckResult, ExitCode, type Violation } from "../../core/index.js";
import {
  checkRemoteFiles,
  isGhAvailable,
  parseRepoString,
  RemoteFetcherError,
  standardFileChecks,
  verifyRepoAccess,
} from "./remote-fetcher.js";
import {
  type FileCheckConfig,
  type RemoteRepoInfo,
  type ScanResult,
  type ValidateProcessOptions,
  type ValidateProcessResult,
} from "./types.js";
import { type RulesetResponse, validateRulesets } from "./validators.js";

/** Fetch rulesets from GitHub API */
async function fetchRulesets(repoInfo: RemoteRepoInfo): Promise<RulesetResponse[]> {
  const result = await execa("gh", ["api", `repos/${repoInfo.owner}/${repoInfo.repo}/rulesets`]);
  return JSON.parse(result.stdout) as RulesetResponse[];
}

/** Create a skipped check result */
function createSkippedResult(
  name: string,
  rule: string,
  reason: string,
  duration: number
): CheckResult {
  return { name, rule, passed: true, violations: [], skipped: true, skipReason: reason, duration };
}

/** Create an error check result */
function createErrorResult(
  name: string,
  rule: string,
  message: string,
  duration: number
): CheckResult {
  return {
    name,
    rule,
    passed: false,
    violations: [{ rule, tool: "scan", message, severity: "error" }],
    skipped: false,
    duration,
  };
}

/** Handle API errors for ruleset fetching */
function handleRulesetError(
  error: unknown,
  repoConfig: NonNullable<Config["process"]>["repo"],
  elapsed: () => number
): CheckResult {
  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes("403") || msg.includes("Must have admin rights")) {
    return createSkippedResult(
      "Repository Settings",
      "process.repo",
      "Cannot check rulesets: insufficient permissions (requires admin access)",
      elapsed()
    );
  }

  if (msg.includes("404")) {
    const violations: Violation[] = [];
    if (repoConfig?.require_branch_protection) {
      violations.push({
        rule: "process.repo.branch_protection",
        tool: "scan",
        message: "No branch protection rulesets configured",
        severity: "error",
      });
    }
    return {
      name: "Repository Settings",
      rule: "process.repo",
      passed: violations.length === 0,
      violations,
      skipped: false,
      duration: elapsed(),
    };
  }

  return createErrorResult(
    "Repository Settings",
    "process.repo",
    `Failed to check rulesets: ${msg}`,
    elapsed()
  );
}

/** Check repository rulesets and branch protection */
async function checkRulesets(repoInfo: RemoteRepoInfo, config: Config): Promise<CheckResult> {
  const startTime = Date.now();
  const elapsed = (): number => Date.now() - startTime;
  const repoConfig = config.process?.repo;

  if (!repoConfig?.enabled) {
    return createSkippedResult(
      "Repository Settings",
      "process.repo",
      "Repository settings check not enabled in config",
      elapsed()
    );
  }

  try {
    const rulesets = await fetchRulesets(repoInfo);
    const violations = validateRulesets(rulesets, repoConfig);

    return {
      name: "Repository Settings",
      rule: "process.repo",
      passed: violations.length === 0,
      violations,
      skipped: false,
      duration: elapsed(),
    };
  } catch (error) {
    return handleRulesetError(error, repoConfig, elapsed);
  }
}

/** Build file checks configuration from config */
function buildFileChecks(config: Config): FileCheckConfig[] {
  const fileChecks: FileCheckConfig[] = [];

  if (config.process?.repo?.require_codeowners) {
    fileChecks.push({
      path: "CODEOWNERS",
      alternativePaths: [".github/CODEOWNERS", "docs/CODEOWNERS"],
      required: true,
      description: "CODEOWNERS file for code review assignment",
    });
  }

  fileChecks.push(
    ...standardFileChecks.filter((check) => !fileChecks.some((fc) => fc.path === check.path))
  );

  return fileChecks;
}

/** Convert file check results to violations */
function fileResultsToViolations(
  results: { path: string; exists: boolean; checkedPaths: string[] }[],
  fileChecks: FileCheckConfig[]
): Violation[] {
  const violations: Violation[] = [];

  for (const result of results) {
    const checkConfig = fileChecks.find((fc) => fc.path === result.path);
    if (!result.exists && checkConfig?.required) {
      violations.push({
        rule: `process.scan.files.${result.path.replace(/[./]/g, "_")}`,
        tool: "scan",
        message: `Required file not found: ${result.path} (checked: ${result.checkedPaths.join(", ")})`,
        severity: "error",
      });
    }
  }

  return violations;
}

/** Check remote files for existence */
async function checkFiles(repoInfo: RemoteRepoInfo, config: Config): Promise<CheckResult> {
  const startTime = Date.now();
  const elapsed = (): number => Date.now() - startTime;
  const fileChecks = buildFileChecks(config);

  if (fileChecks.length === 0) {
    return createSkippedResult(
      "Repository Files",
      "process.scan.files",
      "No file checks configured",
      elapsed()
    );
  }

  try {
    const results = await checkRemoteFiles(repoInfo, fileChecks);
    const violations = fileResultsToViolations(results, fileChecks);

    return {
      name: "Repository Files",
      rule: "process.scan.files",
      passed: violations.length === 0,
      violations,
      skipped: false,
      duration: elapsed(),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return createErrorResult(
      "Repository Files",
      "process.scan.files",
      `Failed to check files: ${msg}`,
      elapsed()
    );
  }
}

/** Aggregate check results into scan result */
function aggregateResults(repoInfo: RemoteRepoInfo, checks: CheckResult[]): ScanResult {
  const violations = checks.flatMap((c) => c.violations);
  const passedChecks = checks.filter((c) => c.passed && !c.skipped).length;
  const failedChecks = checks.filter((c) => !c.passed && !c.skipped).length;
  const skippedChecks = checks.filter((c) => c.skipped).length;

  return {
    repoInfo,
    checks,
    violations,
    passed: failedChecks === 0,
    summary: { totalChecks: checks.length, passedChecks, failedChecks, skippedChecks },
  };
}

/** Run all remote scans for a repository */
export async function scanRepository(repo: string, config: Config): Promise<ScanResult> {
  const repoInfo = parseRepoString(repo);

  if (!(await isGhAvailable())) {
    throw new RemoteFetcherError(
      "GitHub CLI (gh) not available. Install it from https://cli.github.com/",
      "NO_GH"
    );
  }

  await verifyRepoAccess(repoInfo);

  const [rulesetsResult, filesResult] = await Promise.all([
    checkRulesets(repoInfo, config),
    checkFiles(repoInfo, config),
  ]);

  return aggregateResults(repoInfo, [rulesetsResult, filesResult]);
}

/** Programmatic API for validating remote process checks */
export async function validateProcess(
  options: ValidateProcessOptions
): Promise<ValidateProcessResult> {
  const { loadConfigAsync } = await import("../../core/index.js");
  const { config } = await loadConfigAsync(options.config);
  const result = await scanRepository(options.repo, config);

  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.resolve(__dirname, "..", "..", "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { version: string };

  return {
    version: packageJson.version,
    repoInfo: result.repoInfo,
    domain: "process",
    checks: result.checks,
    summary: {
      totalChecks: result.summary.totalChecks,
      passedChecks: result.summary.passedChecks,
      failedChecks: result.summary.failedChecks,
      totalViolations: result.violations.length,
      exitCode: result.passed ? ExitCode.SUCCESS : ExitCode.VIOLATIONS_FOUND,
    },
  };
}
