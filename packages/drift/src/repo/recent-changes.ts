/**
 * Time-window based change detection utilities.
 *
 * Detects commits and file changes within a configurable time window (e.g., 24 hours).
 */

import { isGitRepo } from "./changes.js";
import { execGit } from "../utils/git.js";

/**
 * Options for time-window based change detection
 */
export interface TimeWindowOptions {
  /** Hours to look back (default: 24) */
  hours?: number;
  /** Branch to check (default: main, falls back to master) */
  branch?: string;
}

/**
 * A commit within the time window
 */
export interface RecentCommit {
  /** Commit SHA */
  sha: string;
  /** Author email */
  author: string;
  /** Commit date */
  date: Date;
  /** Commit message (first line) */
  message: string;
}

/**
 * Result of detecting recent changes in a time window
 */
export interface RecentChanges {
  /** All files changed in the time window */
  files: string[];
  /** Commit SHAs in the time window (newest first) */
  commits: string[];
  /** Unique author emails */
  authors: string[];
  /** Whether any commits exist in the time window */
  hasCommits: boolean;
}

/**
 * Get the default branch name (main or master)
 */
function getDefaultBranch(repoPath: string): string | null {
  // Try main first
  const mainExists = execGit(repoPath, "rev-parse --verify main");
  if (mainExists) {
    return "main";
  }

  // Fall back to master
  const masterExists = execGit(repoPath, "rev-parse --verify master");
  if (masterExists) {
    return "master";
  }

  return null;
}

/**
 * Get commits within a time window on a branch.
 *
 * @param repoPath - Path to the repository
 * @param options - Time window options
 * @returns Array of commits (newest first)
 */
export function getRecentCommits(
  repoPath: string,
  options: TimeWindowOptions = {}
): RecentCommit[] {
  const { hours = 24, branch } = options;

  if (!isGitRepo(repoPath)) {
    return [];
  }

  const targetBranch = branch ?? getDefaultBranch(repoPath);
  if (!targetBranch) {
    return [];
  }

  // Use git log with --since to get commits in time window
  // Format: sha|author|date|message (using | as delimiter since it's unlikely in commit messages)
  const output = execGit(
    repoPath,
    `log ${targetBranch} --since="${hours} hours ago" --format="%H|%ae|%aI|%s"`
  );

  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, author, dateStr, ...messageParts] = line.split("|");
      return {
        sha,
        author,
        date: new Date(dateStr),
        message: messageParts.join("|"), // Rejoin in case message had |
      };
    });
}

/**
 * Get all files changed across a set of commits.
 *
 * @param repoPath - Path to the repository
 * @param commits - Array of commits to analyze
 * @returns RecentChanges with files, commits, and authors
 */
export function getChangedFilesInCommits(
  repoPath: string,
  commits: RecentCommit[]
): RecentChanges {
  if (commits.length === 0) {
    return { files: [], commits: [], authors: [], hasCommits: false };
  }

  // Get the oldest and newest commit to define the range
  const oldestSha = commits[commits.length - 1].sha;
  const newestSha = commits[0].sha;

  // Check if the oldest commit has a parent
  const hasParent = execGit(repoPath, `rev-parse --verify ${oldestSha}^`);

  let output: string;
  if (hasParent) {
    // Normal case: diff from parent of oldest to newest
    output = execGit(repoPath, `diff --name-only ${oldestSha}^..${newestSha}`);
  } else {
    // First commit case: use diff-tree to list all files in the commits
    // Get files from each commit and deduplicate
    // Use --root flag to handle root commits properly
    const allFiles = new Set<string>();
    for (const commit of commits) {
      const files = execGit(
        repoPath,
        `diff-tree --root --no-commit-id --name-only -r ${commit.sha}`
      );
      if (files) {
        files
          .split("\n")
          .filter(Boolean)
          .forEach((f) => allFiles.add(f));
      }
    }
    output = [...allFiles].join("\n");
  }

  const files = output ? output.split("\n").filter(Boolean) : [];
  const commitShas = commits.map((c) => c.sha);
  const authors = [...new Set(commits.map((c) => c.author))];

  return {
    files,
    commits: commitShas,
    authors,
    hasCommits: true,
  };
}

/**
 * Detect all changes within a time window.
 * Convenience function that combines getRecentCommits and getChangedFilesInCommits.
 *
 * @param repoPath - Path to the repository
 * @param options - Time window options
 * @returns RecentChanges with all files changed in the time window
 */
export function detectRecentChanges(
  repoPath: string,
  options: TimeWindowOptions = {}
): RecentChanges {
  if (!isGitRepo(repoPath)) {
    return { files: [], commits: [], authors: [], hasCommits: false };
  }

  const commits = getRecentCommits(repoPath, options);
  return getChangedFilesInCommits(repoPath, commits);
}
