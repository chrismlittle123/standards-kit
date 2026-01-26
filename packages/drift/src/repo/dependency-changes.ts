/**
 * Dependency file change detection.
 *
 * Detects changes to all configuration files tracked by conform dependencies,
 * not just standards.toml files.
 */

import { minimatch } from "minimatch";
import {
  getChangedFiles,
  isGitRepo,
  type FileChangeStatus,
} from "./changes.js";
import { getDependencies, type GetDependenciesResult } from "./dependencies.js";

/**
 * Status of a dependency file change
 */
export type DependencyChangeStatus = "added" | "modified" | "deleted";

/**
 * A single dependency file that has changed
 */
export interface DependencyChange {
  /** File path relative to repo root */
  file: string;
  /** Type of change */
  status: DependencyChangeStatus;
  /** Which check this file belongs to (e.g., "eslint", "tsc") */
  checkType: string | null;
  /** Whether this is an always-tracked file (standards.toml, workflows) */
  alwaysTracked: boolean;
}

/**
 * Result of detecting dependency changes
 */
export interface DependencyChanges {
  /** All dependency files that changed */
  changes: DependencyChange[];
  /** Changes grouped by check type */
  byCheck: Record<string, DependencyChange[]>;
  /** Always-tracked files that changed */
  alwaysTrackedChanges: DependencyChange[];
  /** Total number of tracked files */
  totalTrackedFiles: number;
  /** Whether any dependency files changed */
  hasChanges: boolean;
  /** Error if conform dependencies failed */
  error?: string;
}

/**
 * Options for dependency change detection
 */
export interface DependencyChangeOptions {
  /** Base commit to compare against (default: HEAD~1) */
  baseCommit?: string;
  /** Target commit to compare (default: HEAD) */
  targetCommit?: string;
  /** Pre-fetched dependencies (skips cm call if provided) */
  dependencies?: GetDependenciesResult;
}

/**
 * Convert git status code to DependencyChangeStatus
 */
function gitStatusToChangeStatus(gitStatus: string): DependencyChangeStatus {
  switch (gitStatus) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "added"; // Rename treated as added
    default:
      return "modified";
  }
}

/**
 * Check if a file path matches any of the given patterns.
 * Supports both exact matches and glob patterns.
 */
function matchesPattern(file: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Exact match
    if (file === pattern) {
      return true;
    }
    // Glob match
    if (
      pattern.includes("*") ||
      pattern.includes("?") ||
      pattern.includes("[")
    ) {
      if (minimatch(file, pattern, { matchBase: true })) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Find which check type a file belongs to
 */
function findCheckType(
  file: string,
  byCheck: Record<string, string[]>
): string | null {
  for (const [checkType, patterns] of Object.entries(byCheck)) {
    if (matchesPattern(file, patterns)) {
      return checkType;
    }
  }
  return null;
}

/**
 * Create an empty result
 */
function createEmptyResult(error?: string): DependencyChanges {
  return {
    changes: [],
    byCheck: {},
    alwaysTrackedChanges: [],
    totalTrackedFiles: 0,
    hasChanges: false,
    error,
  };
}

/**
 * Get all patterns from dependencies (files + byCheck patterns)
 */
function getAllPatterns(deps: GetDependenciesResult): string[] {
  const patterns = new Set(deps.files);
  // Also include patterns from byCheck that might not be in files
  for (const checkPatterns of Object.values(deps.byCheck)) {
    for (const pattern of checkPatterns) {
      patterns.add(pattern);
    }
  }
  return [...patterns];
}

/**
 * Filter changed files to only those tracked as dependencies
 */
function filterDependencyChanges(
  changedFiles: FileChangeStatus[],
  deps: GetDependenciesResult
): DependencyChange[] {
  const changes: DependencyChange[] = [];
  const allPatterns = getAllPatterns(deps);

  for (const { status, file } of changedFiles) {
    // Check if file is tracked (in files list or byCheck patterns)
    const isTracked = matchesPattern(file, allPatterns);
    const isAlwaysTracked = matchesPattern(file, deps.alwaysTracked);

    if (!isTracked && !isAlwaysTracked) {
      continue;
    }

    const checkType = findCheckType(file, deps.byCheck);

    changes.push({
      file,
      status: gitStatusToChangeStatus(status),
      checkType,
      alwaysTracked: isAlwaysTracked,
    });
  }

  return changes;
}

/**
 * Group changes by check type
 */
function groupByCheck(
  changes: DependencyChange[]
): Record<string, DependencyChange[]> {
  const grouped: Record<string, DependencyChange[]> = {};

  for (const change of changes) {
    if (change.checkType) {
      if (!grouped[change.checkType]) {
        grouped[change.checkType] = [];
      }
      grouped[change.checkType].push(change);
    }
  }

  return grouped;
}

/**
 * Detect changes to dependency files between commits.
 *
 * Uses conform dependencies to get the list of tracked files, then checks
 * which of those files have changed between the specified commits.
 *
 * @param repoPath - Path to the repository
 * @param options - Detection options
 * @returns DependencyChanges with all changed dependency files
 */
export function detectDependencyChanges(
  repoPath: string,
  options: DependencyChangeOptions = {}
): DependencyChanges {
  const { baseCommit = "HEAD~1", targetCommit = "HEAD" } = options;

  // Check if this is a git repo
  if (!isGitRepo(repoPath)) {
    return createEmptyResult("not a git repository");
  }

  // Get dependencies (use provided or fetch from cm)
  const deps = options.dependencies ?? getDependencies(repoPath);

  if (deps.error) {
    return createEmptyResult(deps.error);
  }

  // Get all changed files between commits
  const changedFiles = getChangedFiles(repoPath, baseCommit, targetCommit);

  // Filter to only dependency files
  const changes = filterDependencyChanges(changedFiles, deps);

  // Group by check type
  const byCheck = groupByCheck(changes);

  // Filter always-tracked changes
  const alwaysTrackedChanges = changes.filter((c) => c.alwaysTracked);

  return {
    changes,
    byCheck,
    alwaysTrackedChanges,
    totalTrackedFiles: deps.files.length,
    hasChanges: changes.length > 0,
  };
}

/**
 * Get the list of all dependency files that are being tracked.
 *
 * Convenience function that returns just the file list from conform dependencies.
 *
 * @param repoPath - Path to the repository
 * @returns Array of tracked file patterns
 */
export function getTrackedDependencyFiles(repoPath: string): string[] {
  const deps = getDependencies(repoPath);
  if (deps.error) {
    return [];
  }
  return deps.files;
}
