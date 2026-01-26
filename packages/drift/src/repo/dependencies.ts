/**
 * Integration with @standards-kit/conform's `conform dependencies` command.
 *
 * Gets the list of configuration files that should be tracked for drift detection.
 */

import { execSync } from "child_process";
import { z } from "zod";
import { WORKFLOW_PATTERNS } from "../constants.js";

/**
 * Map of check names to their configuration files.
 */
export type DependencyMap = Record<string, string[]>;

/**
 * Schema for validating conform dependencies JSON output.
 */
const CmDependenciesSchema = z.object({
  project: z.string(),
  checkTomlPath: z.string(),
  dependencies: z.record(z.string(), z.array(z.string())),
  alwaysTracked: z.array(z.string()),
  allFiles: z.array(z.string()),
});

/**
 * Raw output from conform dependencies command.
 */
export type CmDependenciesOutput = z.infer<typeof CmDependenciesSchema>;

/**
 * Options for getting dependencies.
 */
export interface GetDependenciesOptions {
  /** Filter to specific check (e.g., "eslint") */
  check?: string;
  /** Monorepo project path */
  project?: string;
}

/**
 * Result from getDependencies.
 */
export interface GetDependenciesResult {
  /** Flat list of all tracked files */
  files: string[];
  /** Files grouped by check name */
  byCheck: DependencyMap;
  /** Files always tracked (workflows, standards.toml, etc.) */
  alwaysTracked: string[];
  /** Error message if cm failed */
  error?: string;
}

/**
 * Cache for dependency results.
 * Key format: `${repoPath}:${check}:${project}`
 */
const dependencyCache = new Map<string, GetDependenciesResult>();

/**
 * Build cache key from path and options.
 */
function buildCacheKey(
  repoPath: string,
  options?: GetDependenciesOptions
): string {
  return `${repoPath}:${options?.check ?? ""}:${options?.project ?? ""}`;
}

/**
 * Check if the cm command is installed and available.
 */
export function isCmInstalled(): boolean {
  try {
    execSync("cm --version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse and validate conform dependencies JSON output.
 */
export function parseCmOutput(jsonString: string): CmDependenciesOutput | null {
  try {
    const parsed = JSON.parse(jsonString);
    const result = CmDependenciesSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the conform dependencies command with options.
 */
function buildCommand(options?: GetDependenciesOptions): string {
  const args = ["cm", "dependencies", "--format", "json"];

  if (options?.check) {
    args.push("--check", options.check);
  }

  if (options?.project) {
    args.push("--project", options.project);
  }

  return args.join(" ");
}

/**
 * Ensure workflow patterns are included in the alwaysTracked array.
 * This guarantees workflow files are tracked even if cm doesn't include them.
 */
function ensureWorkflowPatterns(alwaysTracked: string[]): string[] {
  const patterns = new Set(alwaysTracked);
  for (const pattern of WORKFLOW_PATTERNS.patterns) {
    patterns.add(pattern);
  }
  return [...patterns];
}

/**
 * Create an empty result with an error message.
 * Still includes workflow patterns as fallback for tracking.
 */
function createErrorResult(error: string): GetDependenciesResult {
  return {
    files: [],
    byCheck: {},
    alwaysTracked: ensureWorkflowPatterns([]),
    error,
  };
}

/**
 * Transform cm output to GetDependenciesResult.
 * Ensures workflow patterns are always included in alwaysTracked.
 */
function transformOutput(output: CmDependenciesOutput): GetDependenciesResult {
  return {
    files: output.allFiles,
    byCheck: output.dependencies,
    alwaysTracked: ensureWorkflowPatterns(output.alwaysTracked),
  };
}

/**
 * Extract a user-friendly error message from an error.
 */
function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "cm command failed";
  }
  if (error.message.includes("ENOENT")) {
    return "cm not installed";
  }
  if (error.message.includes("standards.toml")) {
    return "no standards.toml found";
  }
  return error.message.slice(0, 100);
}

/**
 * Execute the conform dependencies command and return the result.
 */
function executeCmDependencies(
  repoPath: string,
  options?: GetDependenciesOptions
): GetDependenciesResult {
  const command = buildCommand(options);

  try {
    const output = execSync(command, {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });

    const parsed = parseCmOutput(output);
    if (!parsed) {
      return createErrorResult("invalid cm output");
    }

    return transformOutput(parsed);
  } catch (error) {
    return createErrorResult(extractErrorMessage(error));
  }
}

/**
 * Get the list of configuration files tracked by cm.
 *
 * @param repoPath - Path to the repository
 * @param options - Optional filtering options
 * @returns Result with tracked files or error
 */
export function getDependencies(
  repoPath: string,
  options?: GetDependenciesOptions
): GetDependenciesResult {
  const cacheKey = buildCacheKey(repoPath, options);
  const cached = dependencyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!isCmInstalled()) {
    const result = createErrorResult("cm not installed");
    dependencyCache.set(cacheKey, result);
    return result;
  }

  const result = executeCmDependencies(repoPath, options);
  dependencyCache.set(cacheKey, result);
  return result;
}

/**
 * Clear the dependency cache.
 * Useful for testing or when scanning multiple repos.
 */
export function clearDependencyCache(): void {
  dependencyCache.clear();
}
