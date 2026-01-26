import chalk from "chalk";

import { loadConfigAsync } from "../../core/index.js";
import { ExitCode } from "../../core/index.js";
import { scanRepository } from "./scanner.js";
import { type ScanOptions, type ScanResult } from "./types.js";

// Re-export public API types
export {
  type RemoteRepoInfo,
  type ScanOptions,
  type ScanResult,
  type ValidateProcessOptions,
  type ValidateProcessResult,
} from "./types.js";

// Re-export scanner
export { scanRepository, validateProcess } from "./scanner.js";

/** Format scan result as text */
function formatScanText(result: ScanResult): string {
  const lines: string[] = [];

  lines.push(`Repository: ${result.repoInfo.owner}/${result.repoInfo.repo}`);
  lines.push("");

  for (const check of result.checks) {
    if (check.skipped) {
      lines.push(chalk.yellow(`⊘ ${check.name} (skipped: ${check.skipReason})`));
    } else if (check.passed) {
      lines.push(chalk.green(`✓ ${check.name}`));
    } else {
      lines.push(chalk.red(`✗ ${check.name}`));
      for (const violation of check.violations) {
        lines.push(chalk.red(`  • ${violation.message}`));
      }
    }
  }

  lines.push("");
  lines.push(
    `Summary: ${result.summary.passedChecks} passed, ` +
      `${result.summary.failedChecks} failed, ` +
      `${result.summary.skippedChecks} skipped`
  );

  return lines.join("\n");
}

/** Format scan result as JSON */
function formatScanJson(result: ScanResult): string {
  return JSON.stringify(result, null, 2);
}

/** Run the scan command */
export async function runScan(options: ScanOptions): Promise<void> {
  try {
    const { config } = await loadConfigAsync(options.config);
    const result = await scanRepository(options.repo, config);

    const output = options.format === "json" ? formatScanJson(result) : formatScanText(result);

    process.stdout.write(`${output}\n`);
    process.exit(result.passed ? ExitCode.SUCCESS : ExitCode.VIOLATIONS_FOUND);
  } catch (error) {
    if (options.format === "json") {
      const errorObj = {
        error: true,
        message: error instanceof Error ? error.message : String(error),
        code: (error as { code?: string }).code ?? "UNKNOWN",
      };
      process.stdout.write(`${JSON.stringify(errorObj, null, 2)}\n`);
    } else {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    }
    process.exit(ExitCode.RUNTIME_ERROR);
  }
}
