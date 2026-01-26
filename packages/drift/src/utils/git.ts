/**
 * Shared Git command execution utilities.
 * Uses execFileSync to avoid shell interpretation for security.
 */

import { execFileSync } from "child_process";

/**
 * Execute a git command and return the output.
 * Uses execFileSync to avoid shell injection vulnerabilities.
 *
 * @param repoPath - The repository path to run the command in
 * @param args - Git command arguments (without 'git' prefix)
 * @returns The trimmed stdout, or empty string on error
 */
export function execGit(repoPath: string, args: string): string {
  try {
    // Parse the args string into an array
    // This handles simple cases; complex shell features won't work
    const argArray = parseGitArgs(args);

    return execFileSync("git", argArray, {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Parse a git arguments string into an array.
 * Handles quoted strings and basic shell-like argument splitting.
 *
 * @param args - Arguments string (e.g., 'log --format="%H|%ae"')
 * @returns Array of arguments
 */
function parseGitArgs(args: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  let i = 0;

  while (i < args.length) {
    const char = args[i];

    if (inQuote) {
      // Inside a quoted string
      if (char === inQuote) {
        // End of quoted string
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      // Start of quoted string
      inQuote = char;
    } else if (char === " " || char === "\t") {
      // Whitespace - end current argument
      if (current) {
        result.push(current);
        current = "";
      }
    } else {
      current += char;
    }
    i++;
  }

  // Don't forget the last argument
  if (current) {
    result.push(current);
  }

  return result;
}
