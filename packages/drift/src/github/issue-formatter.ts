/**
 * Formats drift detection results into GitHub issue body.
 */

import { DISPLAY_LIMITS, GITHUB_ISSUES } from "../constants.js";
import type {
  MissingProjectsDetection,
  TierMismatchDetection,
  DependencyChangesDetection,
  DependencyFileChange,
} from "../types.js";

/** Truncate diff if it exceeds max lines. */
function truncateDiff(
  diff: string,
  maxLines = DISPLAY_LIMITS.diffLines
): string {
  const lines = diff.split("\n");
  if (lines.length <= maxLines) {
    return diff;
  }
  return lines.slice(0, maxLines).join("\n") + "\n... (truncated)";
}

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

/** Format a single file change as markdown. */
function formatFileChange(
  change: Pick<DependencyFileChange, "file" | "status" | "diff">,
  checkType?: string | null
): string {
  const statusLabel =
    change.status === "deleted"
      ? " (deleted)"
      : change.status === "added"
        ? " (new)"
        : "";
  const checkLabel = checkType ? ` [${checkType}]` : "";
  let section = `#### ${change.file}${statusLabel}${checkLabel}\n\n`;
  if (change.diff) {
    section += "```diff\n" + truncateDiff(change.diff) + "\n```\n";
  } else if (change.status === "deleted") {
    section += "_File was deleted_\n";
  }
  return section;
}

/**
 * Build the complete issue body for missing projects detection.
 */
export function formatMissingProjectsIssueBody(
  detection: MissingProjectsDetection
): string {
  const parts: string[] = [];

  // Header
  parts.push("## New Project Detected Without Standards\n");
  parts.push(`Repository: \`${detection.repository}\``);
  parts.push(`Scan time: ${detection.scanTime}\n`);

  // Projects table
  parts.push("### Projects Missing standards.toml\n");
  parts.push("| Path | Type |");
  parts.push("|------|------|");

  for (const project of detection.projects) {
    parts.push(`| ${project.path} | ${project.type} |`);
  }

  parts.push("");

  // Action required
  parts.push("### Action Required\n");
  parts.push(
    "These projects should have a standards.toml file to enforce code standards.\n"
  );
  parts.push("1. Run `cm init` in each project directory");
  parts.push("2. Configure appropriate rulesets for the project tier");
  parts.push("3. Close this issue once standards are applied\n");

  // Footer
  parts.push("---\n_Created by drift-toolkit_");

  let body = parts.join("\n");

  // Ensure we don't exceed GitHub's limit
  if (body.length > GITHUB_ISSUES.maxBodyLength) {
    body =
      body.slice(0, GITHUB_ISSUES.maxBodyLength - 100) +
      "\n\n... (content truncated due to length)\n\n---\n_Created by drift-toolkit_";
  }

  return body;
}

/**
 * Build the issue title for missing projects detection.
 */
export function getMissingProjectsIssueTitle(): string {
  return GITHUB_ISSUES.missingProjectsTitle;
}

/**
 * Get the label for missing projects issues.
 */
export function getMissingProjectsIssueLabel(): string {
  return GITHUB_ISSUES.missingProjectsLabel;
}

/** Build the complete issue body for tier-ruleset mismatch detection. */
export function formatTierMismatchIssueBody(
  detection: TierMismatchDetection
): string {
  const rulesets =
    detection.rulesets.map((r) => `\`${r}\``).join(", ") || "_none_";
  const parts = [
    "## Tier-Ruleset Mismatch Detected\n",
    `Repository: \`${detection.repository}\``,
    `Scan time: ${detection.scanTime}\n`,
    "### Mismatch Details\n",
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Tier** | ${detection.tier} |`,
    `| **Expected Pattern** | \`${detection.expectedPattern}\` |`,
    `| **Current Rulesets** | ${rulesets} |`,
    "",
    "### Issue\n",
    `${detection.error}\n`,
    "### Action Required\n",
    "The repository tier does not match the rulesets being used. This can cause:\n",
    "- Production repositories running with non-production standards",
    "- Missing security or quality checks appropriate for the tier\n",
    "**To fix:**\n",
    `1. Update \`standards.toml\` to use a ruleset matching \`${detection.expectedPattern}\``,
    "2. Or update `repo-metadata.yaml` tier if the current rulesets are correct",
    "3. Close this issue once the mismatch is resolved\n",
    "---\n_Created by drift-toolkit_",
  ];
  return truncateBody(parts.join("\n"));
}

/**
 * Build the issue title for tier mismatch detection.
 */
export function getTierMismatchIssueTitle(): string {
  return GITHUB_ISSUES.tierMismatchTitle;
}

/**
 * Get the label for tier mismatch issues.
 */
export function getTierMismatchIssueLabel(): string {
  return GITHUB_ISSUES.tierMismatchLabel;
}

/** Format grouped changes by check type */
function formatGroupedChanges(
  byCheck: Record<string, DependencyFileChange[]>
): string[] {
  const parts: string[] = [];
  const checkTypes = Object.keys(byCheck).sort();
  if (checkTypes.length === 0) {
    return parts;
  }
  parts.push("### Changes by Check Type\n");
  for (const checkType of checkTypes) {
    parts.push(`#### ${checkType}\n`);
    for (const change of byCheck[checkType]) {
      parts.push(formatFileChange(change, change.checkType));
    }
  }
  return parts;
}

/** Format ungrouped changes (workflows, standards.toml, etc.) */
function formatUngroupedChanges(changes: DependencyFileChange[]): string[] {
  const ungrouped = changes.filter((c) => !c.checkType);
  if (ungrouped.length === 0) {
    return [];
  }
  const parts = ["### Other Changed Files\n"];
  for (const change of ungrouped) {
    parts.push(formatFileChange(change));
  }
  return parts;
}

/** Build the complete issue body for dependency changes detection. */
export function formatDependencyChangesIssueBody(
  detection: DependencyChangesDetection
): string {
  const commitLink = `[${detection.commit.slice(0, 7)}](${detection.commitUrl})`;
  const parts = [
    "## Dependency File Changes Detected\n",
    `Repository: \`${detection.repository}\``,
    `Scan time: ${detection.scanTime}`,
    `Commit: ${commitLink}\n`,
    ...formatGroupedChanges(detection.byCheck),
    ...formatUngroupedChanges(detection.changes),
    "### Action Required\n",
    "Review these dependency file changes and close this issue once investigated.",
    "These files affect how code standards are enforced in this repository.\n",
    "---\n_Created by drift-toolkit_",
  ];
  return truncateBody(parts.join("\n"));
}

/**
 * Build the issue title for dependency changes detection.
 */
export function getDependencyChangesIssueTitle(): string {
  return GITHUB_ISSUES.dependencyChangesTitle;
}

/**
 * Get the label for dependency changes issues.
 */
export function getDependencyChangesIssueLabel(): string {
  return GITHUB_ISSUES.dependencyChangesLabel;
}
