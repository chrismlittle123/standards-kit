/**
 * Centralized constants for the drift scanner.
 * Consolidates all hardcoded values for easier maintenance and configuration.
 */

/**
 * Timeout values in milliseconds
 */
export const TIMEOUTS = {
  /** Default scan command timeout (60 seconds) */
  scanCommand: 60 * 1000,
  /** Git clone operation timeout (60 seconds) */
  gitClone: 60 * 1000,
} as const;

/**
 * Display limits for terminal output
 */
export const DISPLAY_LIMITS = {
  /** Maximum diff lines to show before truncating */
  diffLines: 20,
  /** Maximum command length to show in warnings */
  commandPreview: 50,
} as const;

/**
 * GitHub API configuration
 */
export const GITHUB_API = {
  /** Base URL for GitHub API */
  baseUrl: "https://api.github.com",
  /** API version header value */
  version: "2022-11-28",
  /** Number of items per page for pagination */
  perPage: 100,
} as const;

/**
 * Concurrency limits
 */
export const CONCURRENCY = {
  /** Maximum repos to scan in parallel */
  maxRepoScans: 5,
} as const;

/**
 * Default values
 */
export const DEFAULTS = {
  /** Default config repository name for org scanning */
  configRepo: "drift-config",
  /** Default scan timeout in seconds (before conversion to ms) */
  scanTimeoutSeconds: 60,
  /** Default commit window in hours for smart scanning */
  commitWindowHours: 24,
} as const;

/**
 * File patterns for configuration and metadata
 */
export const FILE_PATTERNS = {
  /** Config file names in order of precedence */
  config: ["drift.config.yaml", "drift.config.yml", "drift.yaml"] as const,
  /** Metadata file names in order of precedence */
  metadata: ["repo-metadata.yaml", "repo-metadata.yml"] as const,
  /** @standards-kit/conform config file name */
  checkToml: "standards.toml" as const,
} as const;

/**
 * GitHub issue configuration for drift detection
 */
export const GITHUB_ISSUES = {
  /** Maximum issue body length (GitHub limit is ~65535, leaving buffer) */
  maxBodyLength: 60000,
  /** Default label for drift detection issues */
  driftLabel: "drift:code",
  /** Issue title for configuration drift */
  driftTitle: "[drift:code] Configuration changes detected",
  /** Issue title for projects missing standards.toml */
  missingProjectsTitle: "[drift:code] New project detected without standards",
  /** Default label for missing projects issues */
  missingProjectsLabel: "drift:code",
  /** Issue title for tier-ruleset mismatch */
  tierMismatchTitle: "[drift:code] Tier-ruleset mismatch detected",
  /** Default label for tier mismatch issues */
  tierMismatchLabel: "drift:code",
  /** Issue title for dependency file changes */
  dependencyChangesTitle: "[drift:code] Dependency file changes detected",
  /** Default label for dependency changes issues */
  dependencyChangesLabel: "drift:code",
  /** Issue title for process violations */
  processViolationsTitle: "[drift:process] Process violations detected",
  /** Default label for process violations issues */
  processViolationsLabel: "drift:process",
  /** Issue title for infrastructure drift */
  infraDriftTitle: "[drift:infra] Infrastructure drift detected",
  /** Default label for infrastructure drift issues */
  infraDriftLabel: "drift:infra",
} as const;

/**
 * Workflow file patterns that are always tracked for drift detection.
 * These are critical CI/CD files that should be monitored regardless of
 * conform dependencies output.
 */
export const WORKFLOW_PATTERNS = {
  /** GitHub Actions workflow file patterns */
  patterns: [".github/workflows/*.yml", ".github/workflows/*.yaml"] as const,
} as const;
