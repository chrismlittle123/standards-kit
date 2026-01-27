/**
 * Centralized constants for the conform package.
 * Consolidates all hardcoded values for easier maintenance and configuration.
 */

/**
 * Timeout values in milliseconds
 */
export const TIMEOUTS = {
  /** Git clone/pull operation timeout (30 seconds) */
  git: 30_000,
  /** Standard code tool execution timeout (5 minutes) */
  codeTool: 5 * 60 * 1000,
  /** Extended timeout for longer operations like coverage runs (10 minutes) */
  codeToolExtended: 10 * 60 * 1000,
  /** Quick operation timeout for version checks, etc (30 seconds) */
  quick: 30_000,
  /** Gitleaks version check timeout (10 seconds) */
  versionCheck: 10_000,
} as const;

/**
 * AWS configuration defaults
 */
export const AWS_DEFAULTS = {
  /** Default region for global AWS services (IAM, S3 global operations) */
  globalRegion: "us-east-1",
} as const;

/**
 * GitHub API configuration
 */
export const GITHUB_API = {
  /** Base URL for GitHub API (can be overridden via GITHUB_API_URL env var for GitHub Enterprise) */
  baseUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
  /** Number of items per page for pagination */
  perPage: 100,
} as const;

/**
 * Standards repository defaults
 */
export const STANDARDS_REPO = {
  /** Default owner for standards repository (can be overridden via STANDARDS_REPO_OWNER env var) */
  owner: process.env.STANDARDS_REPO_OWNER ?? "palindrom-ai",
  /** Default repository name (can be overridden via STANDARDS_REPO_NAME env var) */
  repo: process.env.STANDARDS_REPO_NAME ?? "standards",
} as const;

/**
 * Cache directory configuration
 */
export const CACHE = {
  /** Base directory name for standards cache (can be overridden via CM_STANDARDS_CACHE_DIR env var) */
  standardsCacheDir: process.env.CM_STANDARDS_CACHE_DIR ?? "cm-standards-cache",
  /** Base directory name for registry cache */
  registryCacheDir: "conform-registry-cache",
} as const;

/**
 * Concurrency limits
 */
export const CONCURRENCY = {
  /** Default concurrency for infrastructure resource checks */
  infraScan: 10,
} as const;

/**
 * Default threshold values
 */
const _DEFAULTS = {
  /** Default backup max age in hours */
  backupMaxAgeHours: 24,
  /** Default code coverage minimum threshold */
  coverageMinThreshold: 80,
} as const;
