/**
 * Formats process violation results into GitHub issue body.
 */

import { GITHUB_ISSUES } from "../constants.js";
import type {
  ProcessViolationsDetection,
  ProcessViolation,
  ProcessCheckSummary,
} from "../types.js";

/** Truncate issue body if it exceeds GitHub's max length. */
function truncateBody(body: string): string {
  if (body.length <= GITHUB_ISSUES.maxBodyLength) {
    return body;
  }
  return (
    body.slice(0, GITHUB_ISSUES.maxBodyLength - 100) +
    "\n\n... (truncated)\n\n---\n_Created by @standards-kit/drift_"
  );
}

/** Format the header section of the issue. */
function formatHeader(repository: string, scanTime: string): string[] {
  return [
    "## Process Violations Detected\n",
    `Repository: \`${repository}\``,
    `Scan time: ${scanTime}\n`,
  ];
}

/** Format the summary table section. */
function formatSummaryTable(summary: ProcessCheckSummary[]): string[] {
  const parts = [
    "### Summary\n",
    "| Category | Passed | Failed |",
    "|----------|--------|--------|",
  ];
  for (const cat of summary) {
    parts.push(`| ${cat.category} | ${cat.passed} | ${cat.failed} |`);
  }
  parts.push("");
  return parts;
}

/** Format category name for display (e.g., "branches" -> "Branch Protection") */
function formatCategoryName(category: string): string {
  const names: Record<string, string> = {
    branches: "Branch Protection",
    required_files: "Required Files",
    forbidden_files: "Forbidden Files",
    commits: "Commit Standards",
    pull_requests: "Pull Request Requirements",
    ci: "CI/CD Configuration",
    repo: "Repository Settings",
    codeowners: "CODEOWNERS",
    hooks: "Git Hooks",
    docs: "Documentation",
  };
  return (
    names[category] || category.charAt(0).toUpperCase() + category.slice(1)
  );
}

/** Format a single category's violations as a table. */
function formatCategoryViolations(
  category: string,
  violations: ProcessViolation[]
): string[] {
  const parts = [
    `#### ${formatCategoryName(category)}\n`,
    "| Check | Message | Severity |",
    "|-------|---------|----------|",
  ];
  for (const v of violations) {
    const severity = v.severity === "error" ? ":x:" : ":warning:";
    const message = v.file ? `${v.message} (${v.file})` : v.message;
    parts.push(`| ${v.check} | ${message} | ${severity} |`);
  }
  parts.push("");
  return parts;
}

/** Format the violations section grouped by category. */
function formatViolationsSection(violations: ProcessViolation[]): string[] {
  if (violations.length === 0) {
    return [];
  }

  const parts = ["### Violations\n"];
  const byCategory = new Map<string, ProcessViolation[]>();

  for (const v of violations) {
    const existing = byCategory.get(v.category) || [];
    existing.push(v);
    byCategory.set(v.category, existing);
  }

  for (const [category, catViolations] of byCategory) {
    parts.push(...formatCategoryViolations(category, catViolations));
  }

  return parts;
}

/** Format the "How to Fix" section. */
function formatHowToFix(): string[] {
  return [
    "### How to Fix\n",
    "Review each violation above and take corrective action. Common fixes include:\n",
    "1. **Branch protection**: Go to Settings > Branches > Branch protection rules",
    "2. **Required files**: Add missing files like CODEOWNERS or PR templates",
    "3. **CI checks**: Ensure required status checks are configured",
    "4. **Repository settings**: Update visibility, security settings as needed\n",
    "Close this issue once all violations are resolved.\n",
    "---\n_Created by @standards-kit/drift_",
  ];
}

/**
 * Build the complete issue body for process violations detection.
 */
export function formatProcessViolationsIssueBody(
  detection: ProcessViolationsDetection
): string {
  const parts = [
    ...formatHeader(detection.repository, detection.scanTime),
    ...formatSummaryTable(detection.summary),
    ...formatViolationsSection(detection.violations),
    ...formatHowToFix(),
  ];
  return truncateBody(parts.join("\n"));
}

/**
 * Build the issue title for process violations detection.
 */
export function getProcessViolationsIssueTitle(): string {
  return GITHUB_ISSUES.processViolationsTitle;
}

/**
 * Get the label for process violations issues.
 */
export function getProcessViolationsIssueLabel(): string {
  return GITHUB_ISSUES.processViolationsLabel;
}
