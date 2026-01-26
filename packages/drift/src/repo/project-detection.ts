/**
 * Project detection using @standards-kit/conform's `conform projects detect` command.
 * Detects projects (including monorepo packages) that are missing standards.toml.
 */

import { execSync } from "child_process";
import type { MissingProject } from "../types.js";

/** Timeout for cm command execution (30 seconds) */
const CM_TIMEOUT = 30 * 1000;

/**
 * Expected JSON output format from `conform projects detect --format json`
 */
export interface CmProjectsOutput {
  projects: Array<{
    path: string;
    type: string;
    status: "has-config" | "missing-config";
  }>;
  workspaceRoots: string[];
  summary: {
    total: number;
    withConfig: number;
    missingConfig: number;
  };
}

/**
 * Detect projects in a repository that are missing standards.toml configuration.
 * Uses the `conform projects detect` command from @standards-kit/conform.
 *
 * @param repoPath - Path to the repository root
 * @returns Array of missing projects, or empty array if none found or cm not available
 */
export function detectMissingProjects(repoPath: string): MissingProject[] {
  try {
    const result = execSync(
      "conform projects detect --format json --missing-config",
      {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: CM_TIMEOUT,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    const parsed = JSON.parse(result) as CmProjectsOutput;

    return parsed.projects.map((p) => ({
      path: p.path,
      type: p.type,
    }));
  } catch {
    // Graceful fallback if cm not available or command fails
    return [];
  }
}

/**
 * Detect all projects in a repository, returning their configuration status.
 * Useful for reporting on the overall state of a monorepo.
 *
 * @param repoPath - Path to the repository root
 * @returns Full conform projects output or null if unavailable
 */
export function detectAllProjects(repoPath: string): CmProjectsOutput | null {
  try {
    const result = execSync("conform projects detect --format json", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: CM_TIMEOUT,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return JSON.parse(result) as CmProjectsOutput;
  } catch {
    return null;
  }
}
