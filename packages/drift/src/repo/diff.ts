/**
 * Git diff generation utilities.
 *
 * Generates diffs for changed files to include in GitHub issues.
 */

import { execGit } from "../utils/git.js";
import { isGitRepo } from "./changes.js";

/**
 * Result of generating a file diff
 */
export interface FileDiff {
  /** The diff content (may be truncated) */
  diff: string;
  /** Whether the diff was truncated due to size */
  truncated: boolean;
  /** Number of lines in the full diff */
  totalLines: number;
  /** URL to view the full diff (if provided) */
  fullDiffUrl?: string;
}

/**
 * Options for generating a file diff
 */
export interface FileDiffOptions {
  /** Base commit to compare from (default: HEAD~1) */
  fromCommit?: string;
  /** Target commit to compare to (default: HEAD) */
  toCommit?: string;
  /** Maximum number of lines to include (default: 100) */
  maxLines?: number;
  /** GitHub repository URL for generating full diff links */
  repoUrl?: string;
}

const DEFAULT_MAX_LINES = 100;

/** Resolve a commit reference to its SHA */
function resolveCommit(repoPath: string, commitRef: string): string {
  return execGit(repoPath, `rev-parse ${commitRef}`) || commitRef;
}

/** Check if a file exists at a specific commit */
function fileExistsAtCommit(
  repoPath: string,
  filePath: string,
  commit: string
): boolean {
  return execGit(repoPath, `ls-tree ${commit} -- "${filePath}"`) !== "";
}

/** Get content of a file at a specific commit */
function getFileContent(
  repoPath: string,
  filePath: string,
  commit: string
): string | null {
  return execGit(repoPath, `show ${commit}:"${filePath}"`) || null;
}

/** Build URL to view the full diff on GitHub */
function buildFullDiffUrl(
  repoUrl?: string,
  commit?: string,
  filePath?: string
): string | undefined {
  if (!repoUrl || !commit) {
    return undefined;
  }
  const baseUrl = repoUrl.replace(/\/$/, "");
  if (filePath) {
    const hash = encodeURIComponent(filePath).replace(/%/g, "").toLowerCase();
    return `${baseUrl}/commit/${commit}#diff-${hash}`;
  }
  return `${baseUrl}/commit/${commit}`;
}

/** Process lines for new/deleted file diff */
function processContentLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/** Format diff for a new file (all lines added) */
function formatNewFileDiff(
  content: string,
  maxLines: number,
  repoUrl?: string,
  commit?: string
): FileDiff {
  const lines = processContentLines(content);
  const totalLines = lines.length;
  const truncated = totalLines > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;
  const diff = displayLines.map((line) => "+" + line).join("\n");

  return {
    diff: truncated ? diff + "\n+..." : diff,
    truncated,
    totalLines,
    fullDiffUrl: buildFullDiffUrl(repoUrl, commit),
  };
}

/** Format diff for a deleted file (all lines removed) */
function formatDeletedFileDiff(
  content: string,
  maxLines: number,
  repoUrl?: string,
  commit?: string
): FileDiff {
  const lines = processContentLines(content);
  const totalLines = lines.length;
  const truncated = totalLines > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;
  const diff = displayLines.map((line) => "-" + line).join("\n");

  return {
    diff: truncated ? diff + "\n-..." : diff,
    truncated,
    totalLines,
    fullDiffUrl: buildFullDiffUrl(repoUrl, commit),
  };
}

/** Extract diff lines from raw git diff output */
function extractDiffLines(rawDiff: string): string[] {
  const lines = rawDiff.split("\n");
  const diffLines: string[] = [];
  let inHunk = false;

  for (const line of lines) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (inHunk) {
      diffLines.push(line);
    }
  }
  return diffLines;
}

interface FormatDiffParams {
  rawDiff: string;
  maxLines: number;
  repoUrl?: string;
  commit?: string;
  filePath?: string;
}

/** Format a raw git diff output */
function formatDiff(params: FormatDiffParams): FileDiff {
  const { rawDiff, maxLines, repoUrl, commit, filePath } = params;
  const diffLines = extractDiffLines(rawDiff);
  const totalLines = diffLines.length;
  const truncated = totalLines > maxLines;
  const displayLines = truncated ? diffLines.slice(0, maxLines) : diffLines;
  let diff = displayLines.join("\n");
  if (truncated) {
    diff += "\n...";
  }

  return {
    diff,
    truncated,
    totalLines,
    fullDiffUrl: buildFullDiffUrl(repoUrl, commit, filePath),
  };
}

interface HandleNoDiffParams {
  repoPath: string;
  filePath: string;
  fromCommit: string;
  toCommit: string;
  maxLines: number;
  repoUrl?: string;
  resolvedToCommit?: string;
}

/** Handle case when git diff returns no output */
function handleNoDiff(params: HandleNoDiffParams): FileDiff {
  const {
    repoPath,
    filePath,
    fromCommit,
    toCommit,
    maxLines,
    repoUrl,
    resolvedToCommit,
  } = params;

  const existsAtFrom = fileExistsAtCommit(repoPath, filePath, fromCommit);
  const existsAtTo = fileExistsAtCommit(repoPath, filePath, toCommit);

  if (!existsAtFrom && existsAtTo) {
    const content = getFileContent(repoPath, filePath, toCommit);
    if (content !== null) {
      return formatNewFileDiff(content, maxLines, repoUrl, resolvedToCommit);
    }
  }

  if (existsAtFrom && !existsAtTo) {
    const content = getFileContent(repoPath, filePath, fromCommit);
    if (content !== null) {
      const resolvedFrom = resolveCommit(repoPath, fromCommit);
      return formatDeletedFileDiff(content, maxLines, repoUrl, resolvedFrom);
    }
  }

  return { diff: "", truncated: false, totalLines: 0 };
}

/**
 * Generate a git diff for a specific file between two commits.
 */
export function generateFileDiff(
  repoPath: string,
  filePath: string,
  options: FileDiffOptions = {}
): FileDiff {
  const {
    fromCommit = "HEAD~1",
    toCommit = "HEAD",
    maxLines = DEFAULT_MAX_LINES,
    repoUrl,
  } = options;

  if (!isGitRepo(repoPath)) {
    return { diff: "", truncated: false, totalLines: 0 };
  }

  const resolvedToCommit = resolveCommit(repoPath, toCommit);
  const rawDiff = execGit(
    repoPath,
    `diff ${fromCommit} ${toCommit} -- "${filePath}"`
  );

  if (rawDiff) {
    return formatDiff({
      rawDiff,
      maxLines,
      repoUrl,
      commit: resolvedToCommit,
      filePath,
    });
  }

  return handleNoDiff({
    repoPath,
    filePath,
    fromCommit,
    toCommit,
    maxLines,
    repoUrl,
    resolvedToCommit,
  });
}

/**
 * Format a diff for display in GitHub markdown.
 */
export function formatDiffForMarkdown(diff: string): string {
  if (!diff) {
    return "";
  }
  return "```diff\n" + diff + "\n```";
}

/**
 * Generate diffs for multiple files.
 */
export function generateMultipleDiffs(
  repoPath: string,
  filePaths: string[],
  options: FileDiffOptions = {}
): Map<string, FileDiff> {
  const diffs = new Map<string, FileDiff>();
  for (const filePath of filePaths) {
    diffs.set(filePath, generateFileDiff(repoPath, filePath, options));
  }
  return diffs;
}
