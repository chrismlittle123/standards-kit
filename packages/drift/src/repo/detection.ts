/** Repository detection utilities for drift-toolkit. */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, relative } from "path";
import { parse as parseYaml } from "yaml";
import { FILE_PATTERNS } from "../constants.js";
import {
  validateAllCheckToml,
  type CheckTomlValidation,
} from "./check-toml.js";

export type RepoTier = "production" | "internal" | "prototype";
export type RepoStatus = "active" | "pre-release" | "deprecated";

export interface RepoMetadata {
  tier: RepoTier;
  status: RepoStatus;
  team?: string;
  raw: Record<string, unknown>;
}

// Re-export CheckTomlValidation type
export type { CheckTomlValidation } from "./check-toml.js";

export interface ScannabilityResult {
  scannable: boolean;
  hasMetadata: boolean;
  hasCheckToml: boolean;
  checkTomlPaths: string[];
  checkTomlValidations?: CheckTomlValidation[];
  metadata?: RepoMetadata;
  error?: string;
}

const DEFAULTS = {
  tier: "internal" as RepoTier,
  status: "active" as RepoStatus,
};

function isValidTier(value: unknown): value is RepoTier {
  return (
    typeof value === "string" &&
    ["production", "internal", "prototype"].includes(value)
  );
}

function isValidStatus(value: unknown): value is RepoStatus {
  return (
    typeof value === "string" &&
    ["active", "pre-release", "deprecated"].includes(value)
  );
}

function extractTier(
  parsed: Record<string, unknown>,
  warnings: string[]
): RepoTier {
  if (parsed.tier === undefined) {
    return DEFAULTS.tier;
  }
  if (isValidTier(parsed.tier)) {
    return parsed.tier;
  }
  warnings.push(
    `Invalid tier "${parsed.tier}", using default "${DEFAULTS.tier}"`
  );
  return DEFAULTS.tier;
}

function extractStatus(
  parsed: Record<string, unknown>,
  warnings: string[]
): RepoStatus {
  if (parsed.status === undefined) {
    return DEFAULTS.status;
  }
  if (isValidStatus(parsed.status)) {
    return parsed.status;
  }
  warnings.push(
    `Invalid status "${parsed.status}", using default "${DEFAULTS.status}"`
  );
  return DEFAULTS.status;
}

function createDefaultResult(warning: string): {
  metadata: RepoMetadata;
  warnings: string[];
} {
  return {
    metadata: {
      tier: DEFAULTS.tier,
      status: DEFAULTS.status,
      team: undefined,
      raw: {},
    },
    warnings: [warning],
  };
}

export function findMetadataPath(repoPath: string): string | null {
  for (const filename of FILE_PATTERNS.metadata) {
    const metadataPath = join(repoPath, filename);
    if (existsSync(metadataPath)) {
      return metadataPath;
    }
  }
  return null;
}

export function parseRepoMetadata(content: string): {
  metadata: RepoMetadata;
  warnings: string[];
} {
  if (content.trim() === "") {
    return createDefaultResult("File is empty, using default values");
  }

  try {
    const parsed = parseYaml(content) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") {
      const got = parsed === null ? "null" : typeof parsed;
      return createDefaultResult(
        `Invalid metadata format (expected object, got ${got}), using default values`
      );
    }
    const warnings: string[] = [];
    const tier = extractTier(parsed, warnings);
    const status = extractStatus(parsed, warnings);
    const team = typeof parsed.team === "string" ? parsed.team : undefined;
    return { metadata: { tier, status, team, raw: parsed }, warnings };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return createDefaultResult(
      `Failed to parse YAML: ${msg}, using default values`
    );
  }
}

/**
 * Load and parse repository metadata from repo-metadata.yaml.
 * Always returns an object with metadata and warnings fields.
 * - If file doesn't exist: { metadata: null, warnings: [] }
 * - If file is empty/invalid: { metadata: defaults, warnings: [...] }
 * - If file is valid: { metadata: parsed, warnings: [] }
 */
export function getRepoMetadata(repoPath: string): {
  metadata: RepoMetadata | null;
  warnings: string[];
} {
  const metadataPath = findMetadataPath(repoPath);
  if (!metadataPath) {
    return { metadata: null, warnings: [] };
  }

  try {
    const content = readFileSync(metadataPath, "utf-8");
    return parseRepoMetadata(content);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return {
      metadata: null,
      warnings: [`Failed to read metadata file: ${msg}`],
    };
  }
}

/** Directories to skip during recursive search */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
]);

/** Callback for logging skipped directories during search. */
export type SkippedDirLogger = (dirPath: string, reason: string) => void;

/** Options for findCheckTomlFiles */
export interface FindCheckTomlOptions {
  maxDepth?: number;
  verbose?: boolean;
  onSkippedDir?: SkippedDirLogger;
}

interface SearchContext {
  repoPath: string;
  maxDepth: number;
  results: string[];
  onError: SkippedDirLogger;
}

function searchForCheckToml(
  ctx: SearchContext,
  dirPath: string,
  depth: number
): void {
  if (depth > ctx.maxDepth) {
    return;
  }
  const checkPath = join(dirPath, FILE_PATTERNS.checkToml);
  if (existsSync(checkPath)) {
    ctx.results.push(
      relative(ctx.repoPath, checkPath) || FILE_PATTERNS.checkToml
    );
  }
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        searchForCheckToml(ctx, join(dirPath, entry.name), depth + 1);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    ctx.onError(relative(ctx.repoPath, dirPath) || ".", msg);
  }
}

// Re-export validateCheckToml for backward compatibility
export { validateCheckToml } from "./check-toml.js";

/** Find all standards.toml files in a repository. */
export function findCheckTomlFiles(
  repoPath: string,
  options: FindCheckTomlOptions | number = {}
): string[] {
  const opts = typeof options === "number" ? { maxDepth: options } : options;
  const verbose = opts.verbose ?? false;
  const ctx: SearchContext = {
    repoPath,
    maxDepth: opts.maxDepth ?? 3,
    results: [],
    onError:
      opts.onSkippedDir ??
      ((dir, reason) => {
        if (verbose) {
          console.warn(`Warning: Skipped directory "${dir}": ${reason}`);
        }
      }),
  };
  searchForCheckToml(ctx, repoPath, 0);
  return ctx.results;
}

/**
 * Check if a repository has at least one standards.toml file.
 */
export function hasCheckToml(repoPath: string): boolean {
  // Quick check at root level first
  const rootCheckToml = join(repoPath, FILE_PATTERNS.checkToml);
  if (existsSync(rootCheckToml)) {
    return true;
  }

  // Search for standards.toml in subdirectories (monorepo case)
  return findCheckTomlFiles(repoPath).length > 0;
}

/**
 * Check if a repository has a repo-metadata.yaml file.
 */
export function hasMetadata(repoPath: string): boolean {
  return findMetadataPath(repoPath) !== null;
}

/** Determine if a repository is scannable (has metadata and valid standards.toml). */
export function isScannableRepo(repoPath: string): ScannabilityResult {
  try {
    const metadataResult = getRepoMetadata(repoPath);
    const hasMetadataFile = metadataResult.metadata !== null;
    const checkTomlPaths = findCheckTomlFiles(repoPath);
    const hasCheckTomlFile = checkTomlPaths.length > 0;
    const validation = validateAllCheckToml(repoPath, checkTomlPaths);
    const scannable =
      hasMetadataFile && hasCheckTomlFile && validation.allValid;
    return {
      scannable,
      hasMetadata: hasMetadataFile,
      hasCheckToml: hasCheckTomlFile,
      checkTomlPaths,
      checkTomlValidations: validation.validations,
      metadata: metadataResult.metadata ?? undefined,
      error: validation.firstError,
    };
  } catch (error) {
    return {
      scannable: false,
      hasMetadata: false,
      hasCheckToml: false,
      checkTomlPaths: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
