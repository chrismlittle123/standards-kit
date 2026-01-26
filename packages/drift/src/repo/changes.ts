/**
 * Change tracking utilities for standards.toml files.
 *
 * Uses git to detect changes to standards.toml files since a given commit.
 */

import { existsSync } from "fs";
import { join } from "path";
import { FILE_PATTERNS } from "../constants.js";
import { execGit } from "../utils/git.js";

/**
 * Result of detecting standards.toml changes
 */
export interface CheckTomlChanges {
  /** Files that were added since the base commit */
  added: string[];
  /** Files that were modified since the base commit */
  modified: string[];
  /** Files that were deleted since the base commit */
  deleted: string[];
  /** Whether any changes were detected */
  hasChanges: boolean;
}

/**
 * Options for change detection
 */
export interface ChangeDetectionOptions {
  /** Base commit to compare against (default: HEAD~1) */
  baseCommit?: string;
  /** Target commit to compare (default: HEAD) */
  targetCommit?: string;
}

/**
 * Check if a path is inside a git repository
 */
export function isGitRepo(repoPath: string): boolean {
  const gitDir = join(repoPath, ".git");
  if (existsSync(gitDir)) {
    return true;
  }
  // Check if we're in a subdirectory of a git repo
  const result = execGit(repoPath, "rev-parse --git-dir");
  return result !== "";
}

/**
 * Get the current HEAD commit SHA
 */
export function getHeadCommit(repoPath: string): string | null {
  const result = execGit(repoPath, "rev-parse HEAD");
  return result || null;
}

/**
 * A file change with status
 */
export interface FileChangeStatus {
  /** Git status code: A (added), M (modified), D (deleted), R (renamed) */
  status: string;
  /** File path */
  file: string;
}

/**
 * Get the list of files changed between two commits
 */
export function getChangedFiles(
  repoPath: string,
  baseCommit: string,
  targetCommit: string
): FileChangeStatus[] {
  // Use git diff with name-status to get file changes
  const output = execGit(
    repoPath,
    `diff --name-status ${baseCommit} ${targetCommit}`
  );

  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...fileParts] = line.split("\t");
      const statusCode = status.charAt(0);
      // For renames (R) and copies (C), git outputs "old\tnew"
      // We want the new (destination) file name
      const file =
        (statusCode === "R" || statusCode === "C") && fileParts.length > 1
          ? fileParts[fileParts.length - 1]
          : fileParts.join("\t");
      return { status: statusCode, file };
    });
}

/**
 * Filter changed files to only standards.toml files
 */
function filterCheckTomlChanges(
  changes: { status: string; file: string }[]
): CheckTomlChanges {
  const checkTomlName = FILE_PATTERNS.checkToml;
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const { status, file } of changes) {
    // Check if the file is a standards.toml file
    if (!file.endsWith(checkTomlName)) {
      continue;
    }

    switch (status) {
      case "A": // Added
        added.push(file);
        break;
      case "M": // Modified
        modified.push(file);
        break;
      case "D": // Deleted
        deleted.push(file);
        break;
      case "R": // Renamed (treat as added)
        added.push(file);
        break;
    }
  }

  return {
    added,
    modified,
    deleted,
    hasChanges: added.length > 0 || modified.length > 0 || deleted.length > 0,
  };
}

/**
 * Detect changes to standards.toml files since a given commit.
 *
 * @param repoPath - Path to the repository
 * @param options - Change detection options
 * @returns CheckTomlChanges with added, modified, and deleted files
 */
export function detectCheckTomlChanges(
  repoPath: string,
  options: ChangeDetectionOptions = {}
): CheckTomlChanges {
  const { baseCommit = "HEAD~1", targetCommit = "HEAD" } = options;

  if (!isGitRepo(repoPath)) {
    return { added: [], modified: [], deleted: [], hasChanges: false };
  }

  const changes = getChangedFiles(repoPath, baseCommit, targetCommit);
  return filterCheckTomlChanges(changes);
}

/**
 * Get all standards.toml files that exist at a specific commit.
 *
 * @param repoPath - Path to the repository
 * @param commit - Commit SHA to check (default: HEAD)
 * @returns Array of standards.toml file paths at that commit
 */
export function getCheckTomlFilesAtCommit(
  repoPath: string,
  commit: string = "HEAD"
): string[] {
  const checkTomlName = FILE_PATTERNS.checkToml;

  // List all files at the commit that match standards.toml
  const output = execGit(repoPath, `ls-tree -r --name-only ${commit}`);

  if (!output) {
    return [];
  }

  return output.split("\n").filter((file) => file.endsWith(checkTomlName));
}

/**
 * Compare standards.toml files between two commits and detect all changes.
 * This is more comprehensive than detectCheckTomlChanges as it also
 * finds files that exist in one commit but not the other.
 *
 * @param repoPath - Path to the repository
 * @param baseCommit - Base commit to compare from
 * @param targetCommit - Target commit to compare to (default: HEAD)
 * @returns CheckTomlChanges with complete change information
 */
export function compareCheckTomlFiles(
  repoPath: string,
  baseCommit: string,
  targetCommit: string = "HEAD"
): CheckTomlChanges {
  if (!isGitRepo(repoPath)) {
    return { added: [], modified: [], deleted: [], hasChanges: false };
  }

  const baseFiles = new Set(getCheckTomlFilesAtCommit(repoPath, baseCommit));
  const targetFiles = new Set(
    getCheckTomlFilesAtCommit(repoPath, targetCommit)
  );

  // Find added (in target but not base) and deleted (in base but not target)
  const added = [...targetFiles].filter((f) => !baseFiles.has(f));
  const deleted = [...baseFiles].filter((f) => !targetFiles.has(f));

  // Find modified files (exist in both, content differs)
  const modified = [...baseFiles]
    .filter((f) => targetFiles.has(f))
    .filter((file) => {
      const diff = execGit(
        repoPath,
        `diff ${baseCommit} ${targetCommit} -- "${file}"`
      );
      return diff !== "";
    });

  const hasChanges =
    added.length > 0 || modified.length > 0 || deleted.length > 0;
  return { added, modified, deleted, hasChanges };
}
