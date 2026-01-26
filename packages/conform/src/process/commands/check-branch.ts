import { getProjectRoot, loadConfigAsync } from "../../core/index.js";
import { type Config } from "../../core/index.js";
import { type CheckResult } from "../../core/index.js";
import { BranchesRunner } from "../tools/branches.js";

interface CheckBranchOptions {
  config?: string;
  quiet?: boolean;
}

type BranchesConfig = NonNullable<NonNullable<Config["process"]>["branches"]>;

/** Output a success message if not in quiet mode */
function logSuccess(quiet: boolean | undefined): void {
  if (!quiet) {
    console.warn("✓ Branch name is valid");
  }
}

/** Output a skip message if not in quiet mode */
function logSkip(message: string, quiet: boolean | undefined): void {
  if (!quiet) {
    console.warn(`○ ${message}`);
  }
}

/** Output a disabled message if not in quiet mode */
function logDisabled(quiet: boolean | undefined): void {
  if (!quiet) {
    console.warn("Branch naming check is not enabled in standards.toml");
  }
}

/** Extract branch types from pattern (e.g., "(feature|fix|hotfix)" -> ["feature", "fix", "hotfix"]) */
function extractBranchTypes(pattern: string | undefined): string[] {
  if (!pattern) {
    return ["feature", "fix", "hotfix"]; // Default types
  }

  // Try to extract types from pattern like "^(feature|fix|hotfix|docs)/"
  const typeMatch = /\(([^)]+)\)/.exec(pattern);
  if (typeMatch) {
    const types = typeMatch[1].split("|").filter((t) => !t.includes("\\") && t.length < 20);
    if (types.length > 0) {
      return types.slice(0, 3); // Take first 3 types
    }
  }

  return ["feature", "fix", "hotfix"]; // Default types
}

/** Generate dynamic examples based on config */
function generateExamples(branchesConfig: BranchesConfig): string[] {
  const types = extractBranchTypes(branchesConfig.pattern);

  if (branchesConfig.require_issue) {
    // Issue-based examples
    return types.map((type, i) => `${type}/${100 + i}/add-feature`);
  }

  // Pattern-based examples - try to infer format from pattern
  const pattern = branchesConfig.pattern ?? "";

  // Check if pattern expects a version-like segment
  if (pattern.includes("v") || pattern.includes("\\d+\\.")) {
    return types.map((type) => `${type}/v1.0.0/add-login`);
  }

  // Default format: type/description
  return types.map((type) => `${type}/add-feature`);
}

/** Show help with dynamic examples */
function showExamples(branchesConfig: BranchesConfig): void {
  console.error("");
  const examples = generateExamples(branchesConfig);
  const label = branchesConfig.require_issue ? "Examples (with issue number):" : "Examples:";
  console.error(label);
  for (const example of examples) {
    console.error(`  ${example}`);
  }
}

/** Output failure details */
function logFailure(
  violations: { message: string; rule?: string }[],
  branchesConfig: BranchesConfig,
  quiet: boolean | undefined
): void {
  for (const violation of violations) {
    console.error(`✗ ${violation.message}`);
  }

  if (quiet) {
    return;
  }

  const hasPatternViolation = violations.some((v) => v.rule?.includes("pattern"));
  const hasIssueViolation = violations.some((v) => v.rule?.includes("require_issue"));

  if (hasPatternViolation && branchesConfig.pattern) {
    console.error("");
    console.error(`Expected pattern: ${branchesConfig.pattern}`);
  }

  // Show dynamic examples based on config
  if (hasIssueViolation || hasPatternViolation) {
    showExamples(branchesConfig);
  }
}

/** Run the branches validation and return the result */
async function runBranchValidation(
  projectRoot: string,
  branchesConfig: BranchesConfig
): Promise<CheckResult> {
  const runner = new BranchesRunner();
  runner.setConfig(branchesConfig);
  return runner.run(projectRoot);
}

/** Handle the result of the branch validation */
function handleResult(
  result: CheckResult,
  branchesConfig: BranchesConfig,
  quiet: boolean | undefined
): number {
  if (result.skipped) {
    logSkip(result.skipReason ?? "Check skipped", quiet);
    return 0;
  }

  if (result.passed) {
    logSuccess(quiet);
    return 0;
  }

  logFailure(result.violations, branchesConfig, quiet);
  return 1;
}

/**
 * Hook-friendly command to validate branch naming.
 * Designed for use in pre-push hooks.
 *
 * @param options - Command options
 * @returns Exit code (0 = success, 1 = violation)
 */
export async function checkBranchCommand(options: CheckBranchOptions): Promise<number> {
  const { config, configPath } = await loadConfigAsync(options.config);
  const projectRoot = getProjectRoot(configPath);
  const branchesConfig = config.process?.branches;

  if (!branchesConfig?.enabled) {
    logDisabled(options.quiet);
    return 0;
  }

  const result = await runBranchValidation(projectRoot, branchesConfig);
  return handleResult(result, branchesConfig, options.quiet);
}
