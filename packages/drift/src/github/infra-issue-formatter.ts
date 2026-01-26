/**
 * Formats infrastructure drift results into GitHub issue body.
 */

import { GITHUB_ISSUES } from "../constants.js";
import type {
  InfraDriftDetection,
  InfraResourceResult,
  InfraScanSummary,
} from "../types.js";

/** Truncate issue body if it exceeds GitHub's max length. */
function truncateBody(body: string): string {
  if (body.length <= GITHUB_ISSUES.maxBodyLength) {
    return body;
  }
  return (
    body.slice(0, GITHUB_ISSUES.maxBodyLength - 100) +
    "\n\n... (truncated)\n\n---\n_Created by drift-toolkit_"
  );
}

/** Format the header section of the issue. */
function formatHeader(repository: string, scanTime: string): string[] {
  return [
    "## Infrastructure Drift Detected\n",
    `Repository: \`${repository}\``,
    `Scan time: ${scanTime}\n`,
  ];
}

/** Format the summary table section. */
function formatSummaryTable(summary: InfraScanSummary): string[] {
  return [
    "### Summary\n",
    "| Total | Found | Missing | Errors |",
    "|-------|-------|---------|--------|",
    `| ${summary.total} | ${summary.found} | ${summary.missing} | ${summary.errors} |`,
    "",
  ];
}

/** Format missing resources as a table. */
function formatMissingResourcesTable(
  resources: InfraResourceResult[]
): string[] {
  const missing = resources.filter((r) => !r.exists && !r.error);

  if (missing.length === 0) {
    return [];
  }

  const parts = [
    "### Missing Resources\n",
    "| ARN | Service | Resource |",
    "|-----|---------|----------|",
  ];

  for (const r of missing) {
    parts.push(`| \`${r.arn}\` | ${r.service} | ${r.resourceType} |`);
  }

  parts.push("");
  return parts;
}

/** Format resources with errors as a table. */
function formatErrorResourcesTable(resources: InfraResourceResult[]): string[] {
  const errors = resources.filter((r) => r.error);

  if (errors.length === 0) {
    return [];
  }

  const parts = [
    "### Errors\n",
    "| ARN | Error |",
    "|-----|-------|",
  ];

  for (const r of errors) {
    parts.push(`| \`${r.arn}\` | ${r.error} |`);
  }

  parts.push("");
  return parts;
}

/** Format the "How to Fix" section. */
function formatHowToFix(): string[] {
  return [
    "### How to Fix\n",
    "1. **Deploy missing resources** using your IaC tool (Pulumi, Terraform, etc.)",
    "2. **Or remove from manifest** if resources are no longer needed\n",
    "Close this issue once all drift is resolved.\n",
    "---\n_Created by drift-toolkit_",
  ];
}

/**
 * Build the complete issue body for infrastructure drift detection.
 */
export function formatInfraDriftIssueBody(
  detection: InfraDriftDetection
): string {
  const parts = [
    ...formatHeader(detection.repository, detection.scanTime),
    ...formatSummaryTable(detection.summary),
    ...formatMissingResourcesTable(detection.resources),
    ...formatErrorResourcesTable(detection.resources),
    ...formatHowToFix(),
  ];
  return truncateBody(parts.join("\n"));
}

/**
 * Build the issue title for infrastructure drift detection.
 */
export function getInfraDriftIssueTitle(): string {
  return GITHUB_ISSUES.infraDriftTitle;
}

/**
 * Get the label for infrastructure drift issues.
 */
export function getInfraDriftIssueLabel(): string {
  return GITHUB_ISSUES.infraDriftLabel;
}
