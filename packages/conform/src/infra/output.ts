/**
 * Output formatters for infra scan results
 */

import chalk from "chalk";

import type { AccountScanResult, InfraScanResult, ResourceCheckResult } from "./types.js";

/**
 * Format scan result as text output
 */
function formatScanText(result: InfraScanResult): string {
  const lines: string[] = [];

  formatHeader(lines, result);

  // If we have account results, format by account
  if (result.accountResults && Object.keys(result.accountResults).length > 0) {
    formatAccountResults(lines, result.accountResults);
    formatOverallSummary(lines, result.summary);
  } else {
    // Legacy format - flat results
    formatResultsByStatus(lines, result.results);
    formatSummary(lines, result.summary);
  }

  return lines.join("\n");
}

function formatHeader(lines: string[], result: InfraScanResult): void {
  lines.push(chalk.bold("Infrastructure Scan Results"));
  lines.push(`Manifest: ${result.manifest}`);
  if (result.project) {
    lines.push(`Project: ${result.project}`);
  }
  lines.push("");
}

function formatResultsByStatus(lines: string[], results: ResourceCheckResult[]): void {
  const found = results.filter((r) => r.exists && !r.error);
  const missing = results.filter((r) => !r.exists && !r.error);
  const errors = results.filter((r) => r.error);

  formatResultSection(lines, found, {
    colorFn: chalk.green.bold,
    label: "Found",
    formatLine: formatFoundLine,
  });
  formatResultSection(lines, missing, {
    colorFn: chalk.red.bold,
    label: "Missing",
    formatLine: formatMissingLine,
  });
  formatResultSection(lines, errors, {
    colorFn: chalk.yellow.bold,
    label: "Errors",
    formatLine: formatErrorLine,
  });
}

interface SectionConfig {
  colorFn: (s: string) => string;
  label: string;
  formatLine: (r: ResourceCheckResult) => string;
}

function formatResultSection(
  lines: string[],
  results: ResourceCheckResult[],
  config: SectionConfig
): void {
  if (results.length === 0) {
    return;
  }
  lines.push(config.colorFn(`${config.label} (${results.length}):`));
  for (const r of results) {
    lines.push(config.formatLine(r));
  }
  lines.push("");
}

function formatFoundLine(r: ResourceCheckResult): string {
  const icon = chalk.green("✓");
  const resourceInfo = `${r.service}/${r.resourceType}/${r.resourceId}`;
  return `  ${icon} ${resourceInfo}`;
}

function formatMissingLine(r: ResourceCheckResult): string {
  const icon = chalk.red("✗");
  const resourceInfo = `${r.service}/${r.resourceType}/${r.resourceId}`;
  return `  ${icon} ${resourceInfo}`;
}

function formatErrorLine(r: ResourceCheckResult): string {
  const icon = chalk.yellow("!");
  const resourceInfo = `${r.service}/${r.resourceType}/${r.resourceId}`;
  const errorText = r.error ?? "Unknown error";
  return `  ${icon} ${resourceInfo} - ${chalk.yellow(errorText)}`;
}

function formatSummary(
  lines: string[],
  summary: { total: number; found: number; missing: number; errors: number }
): void {
  lines.push(chalk.bold("Summary:"));
  lines.push(`  Total:   ${summary.total}`);
  lines.push(chalk.green(`  Found:   ${summary.found}`));
  lines.push(chalk.red(`  Missing: ${summary.missing}`));
  if (summary.errors > 0) {
    lines.push(chalk.yellow(`  Errors:  ${summary.errors}`));
  }
}

/**
 * Format overall summary for multi-account manifests
 */
function formatOverallSummary(
  lines: string[],
  summary: { total: number; found: number; missing: number; errors: number }
): void {
  lines.push(chalk.bold("Overall Summary:"));
  lines.push(`  Total:   ${summary.total}`);
  lines.push(chalk.green(`  Found:   ${summary.found}`));
  lines.push(chalk.red(`  Missing: ${summary.missing}`));
  if (summary.errors > 0) {
    lines.push(chalk.yellow(`  Errors:  ${summary.errors}`));
  }
}

/**
 * Format results grouped by account
 */
function formatAccountResults(
  lines: string[],
  accountResults: Record<string, AccountScanResult>
): void {
  for (const [accountKey, account] of Object.entries(accountResults)) {
    const accountLabel = account.alias
      ? `${account.alias} (${accountKey})`
      : accountKey;

    lines.push(chalk.bold.cyan(`\nAccount: ${accountLabel}`));
    lines.push(chalk.gray("─".repeat(40)));

    // Format results for this account
    formatAccountResourceResults(lines, account.results);

    // Account-level summary
    const { summary } = account;
    const summaryParts: string[] = [];
    if (summary.found > 0) {
      summaryParts.push(chalk.green(`${summary.found} found`));
    }
    if (summary.missing > 0) {
      summaryParts.push(chalk.red(`${summary.missing} missing`));
    }
    if (summary.errors > 0) {
      summaryParts.push(chalk.yellow(`${summary.errors} errors`));
    }
    lines.push(`  ${chalk.dim("Summary:")} ${summaryParts.join(", ")}`);
  }
  lines.push("");
}

/**
 * Format resource results for a single account (inline style)
 */
function formatAccountResourceResults(lines: string[], results: ResourceCheckResult[]): void {
  for (const r of results) {
    if (r.error) {
      const icon = chalk.yellow("!");
      lines.push(`  ${icon} ${r.arn} - ${chalk.yellow(r.error)}`);
    } else if (r.exists) {
      const icon = chalk.green("✓");
      lines.push(`  ${icon} ${r.arn}`);
    } else {
      const icon = chalk.red("✗");
      lines.push(`  ${icon} ${r.arn}`);
    }
  }
}

/**
 * Format scan result as JSON output
 */
function formatScanJson(result: InfraScanResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format scan result based on output format
 */
export function formatScan(result: InfraScanResult, format: "text" | "json"): string {
  return format === "json" ? formatScanJson(result) : formatScanText(result);
}
