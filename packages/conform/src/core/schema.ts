 
import { minimatch } from "minimatch";
import { z } from "zod";

/**
 * Count unclosed brackets and braces in a pattern, respecting escapes.
 */
function countUnclosedDelimiters(pattern: string): { brackets: number; braces: number } {
  let brackets = 0;
  let braces = 0;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "\\" && i + 1 < pattern.length) {
      i++; // Skip escaped character
      continue;
    }
    switch (pattern[i]) {
      case "[":
        brackets++;
        break;
      case "]":
        if (brackets > 0) {
          brackets--;
        }
        break;
      case "{":
        braces++;
        break;
      case "}":
        if (braces > 0) {
          braces--;
        }
        break;
    }
  }
  return { brackets, braces };
}

/**
 * Validate that a string is a valid glob pattern.
 * Checks for balanced brackets/braces since minimatch is too lenient.
 */
function isValidGlobPattern(pattern: string): { valid: boolean; error?: string } {
  if (pattern.length === 0) {
    return { valid: false, error: "empty pattern" };
  }

  const unclosed = countUnclosedDelimiters(pattern);
  if (unclosed.brackets > 0) {
    return { valid: false, error: "unclosed bracket '['" };
  }
  if (unclosed.braces > 0) {
    return { valid: false, error: "unclosed brace '{'" };
  }

  try {
    const result = minimatch.makeRe(pattern);
    return result === false ? { valid: false, error: "invalid pattern syntax" } : { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid glob pattern";
    return { valid: false, error: message };
  }
}

/**
 * Zod schema for a valid glob pattern string
 */
const globPatternSchema = z.string().superRefine((pattern, ctx) => {
  const result = isValidGlobPattern(pattern);
  if (!result.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid glob pattern: "${pattern}" - ${result.error}`,
    });
  }
});

/**
 * Zod schema for standards.toml configuration
 */

// =============================================================================
// ESLint Configuration
// =============================================================================

/** ESLint rule severity */
const eslintRuleSeverity = z.enum(["off", "warn", "error"]);

/**
 * ESLint rule with options in TOML-friendly object format.
 * Example: { severity = "error", max = 10 }
 * The 'severity' key is required, all other keys are rule-specific options.
 */
const eslintRuleWithOptions = z
  .object({
    severity: eslintRuleSeverity,
  })
  .catchall(z.unknown()); // Allow any additional options (max, skipBlankLines, etc.)

/**
 * ESLint rule value - can be:
 * - severity string: "error"
 * - object with severity and options: { severity: "error", max: 10 }
 */
const eslintRuleValue = z.union([eslintRuleSeverity, eslintRuleWithOptions]);

/** ESLint rules configuration */
const eslintRulesSchema = z.record(z.string(), eslintRuleValue).optional();

/** ESLint configuration */
const eslintConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(true),
    files: z.array(z.string()).optional(), // Glob patterns for files to lint
    ignore: z.array(z.string()).optional(), // Glob patterns to ignore
    "max-warnings": z.number().int().nonnegative().optional(), // Max warnings before failure
    rules: eslintRulesSchema, // Required rules for audit (verifies eslint.config.js)
    dependencies: z.array(z.string()).optional(), // Custom dependency files for drift tracking
  })
  .strict()
  .optional();

// =============================================================================
// Ruff Configuration
// =============================================================================

/** Ruff lint configuration */
const ruffLintSchema = z
  .object({
    select: z.array(z.string()).optional(),
    ignore: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

/** Ruff configuration */
const ruffConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(true),
    "line-length": z.number().int().positive().optional(),
    lint: ruffLintSchema,
    dependencies: z.array(z.string()).optional(), // Custom dependency files for drift tracking
  })
  .strict()
  .optional();

// =============================================================================
// TypeScript Configuration
// =============================================================================

/** TypeScript compiler options that can be required via audit */
const tscCompilerOptionsSchema = z
  .object({
    strict: z.boolean().optional(),
    noImplicitAny: z.boolean().optional(),
    strictNullChecks: z.boolean().optional(),
    noUnusedLocals: z.boolean().optional(),
    noUnusedParameters: z.boolean().optional(),
    noImplicitReturns: z.boolean().optional(),
    noFallthroughCasesInSwitch: z.boolean().optional(),
    esModuleInterop: z.boolean().optional(),
    skipLibCheck: z.boolean().optional(),
    forceConsistentCasingInFileNames: z.boolean().optional(),
  })
  .strict()
  .optional();

/** TypeScript compiler configuration */
const tscConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    require: tscCompilerOptionsSchema, // Required compiler options for audit
    dependencies: z.array(z.string()).optional(), // Custom dependency files for drift tracking
  })
  .strict()
  .optional();

// =============================================================================
// ty Configuration (Python Type Checking)
// =============================================================================

/** ty Python type checker configuration */
const tyConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    dependencies: z.array(z.string()).optional(), // Custom dependency files for drift tracking
  })
  .strict()
  .optional();

// =============================================================================
// Knip Configuration (Unused Code Detection)
// =============================================================================

/** Knip configuration */
const knipConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    dependencies: z.array(z.string()).optional(), // Custom dependency files for drift tracking
  })
  .strict()
  .optional();

// =============================================================================
// Vulture Configuration (Python Dead Code Detection)
// =============================================================================

/** Vulture configuration */
const vultureConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    dependencies: z.array(z.string()).optional(), // Custom dependency files for drift tracking
  })
  .strict()
  .optional();

// =============================================================================
// Coverage Run Configuration
// =============================================================================

/** Coverage run test runner type */
const coverageRunnerSchema = z.enum(["vitest", "jest", "pytest", "auto"]);

/** Coverage run configuration - runs tests and verifies coverage threshold */
const coverageRunConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    min_threshold: z.number().int().min(0).max(100).optional().default(80), // Minimum coverage percentage
    runner: coverageRunnerSchema.optional().default("auto"), // Test runner to use
    command: z.string().optional(), // Custom command to run tests with coverage
    dependencies: z.array(z.string()).optional(), // Custom dependency files for drift tracking
  })
  .strict()
  .optional();

// =============================================================================
// Security Configuration
// =============================================================================

/** Secrets (Gitleaks) configuration */
const secretsConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    scan_mode: z
      .enum(["branch", "files", "staged", "full"])
      .optional()
      .default("branch"), // branch: scan current branch commits, files: scan filesystem, staged: staged files only, full: entire git history
    base_branch: z.string().optional().default("main"), // Branch to compare against for "branch" mode
    dependencies: z.array(z.string()).optional(), // Custom dependency files for drift tracking
  })
  .strict()
  .optional();

/** pnpm audit configuration */
const pnpmauditConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    exclude_dev: z.boolean().optional().default(true),
    dependencies: z.array(z.string()).optional(), // Custom dependency files for drift tracking
  })
  .strict()
  .optional();

/** pip-audit configuration */
const pipauditConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    dependencies: z.array(z.string()).optional(), // Custom dependency files for drift tracking
  })
  .strict()
  .optional();

/** Code security configuration */
const codeSecuritySchema = z
  .object({
    secrets: secretsConfigSchema,
    pnpmaudit: pnpmauditConfigSchema,
    pipaudit: pipauditConfigSchema,
  })
  .strict()
  .optional();

// =============================================================================
// Naming Conventions Configuration
// =============================================================================

/** Supported case types for naming conventions */
const caseTypeSchema = z.enum(["kebab-case", "snake_case", "camelCase", "PascalCase"]);

/** Helper to validate no duplicate values in array */
const uniqueArraySchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.array(schema).refine((arr) => new Set(arr).size === arr.length, {
    message: "Duplicate values not allowed",
  });

/** Helper to validate no duplicate values in array with minimum length */
const uniqueArraySchemaMin1 = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .array(schema)
    .min(1, "At least one value is required")
    .refine((arr) => new Set(arr).size === arr.length, {
      message: "Duplicate values not allowed",
    });

/** Single naming rule */
const namingRuleSchema = z
  .object({
    extensions: uniqueArraySchemaMin1(z.string()), // e.g., ["ts", "tsx"] - no duplicates allowed, at least one required
    file_case: caseTypeSchema,
    folder_case: caseTypeSchema,
    exclude: z.array(z.string()).optional(), // Glob patterns to exclude, e.g., ["tests/**"]
    allow_dynamic_routes: z.boolean().optional(), // Allow Next.js/Remix dynamic route folders: [id], [...slug], (group)
  })
  .strict();

/** Naming conventions configuration */
const namingConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    rules: z.array(namingRuleSchema).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.rules || data.rules.length <= 1) {
      return;
    }

    const extensionToRuleIndex = new Map<string, number>();
    for (let i = 0; i < data.rules.length; i++) {
      for (const ext of data.rules[i].extensions) {
        const existing = extensionToRuleIndex.get(ext);
        if (existing !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Extension "${ext}" appears in multiple naming rules (rules ${existing + 1} and ${i + 1}). Each extension can only appear in one rule.`,
            path: ["rules", i, "extensions"],
          });
        } else {
          extensionToRuleIndex.set(ext, i);
        }
      }
    }
  })
  .optional();

// =============================================================================
// Quality Configuration (Disable Comments Detection)
// =============================================================================

/** Disable comments configuration */
const disableCommentsConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    patterns: z.array(z.string()).optional(), // Override default patterns
    extensions: uniqueArraySchema(z.string()).optional(), // File extensions to scan - no duplicates allowed
    exclude: z.array(z.string()).optional(), // Glob patterns to exclude
  })
  .strict()
  .optional();

/** Code quality configuration */
const codeQualitySchema = z
  .object({
    "disable-comments": disableCommentsConfigSchema,
  })
  .strict()
  .optional();

// =============================================================================
// Code Domain Configuration
// =============================================================================

/** Code linting configuration */
const codeLintingSchema = z
  .object({
    eslint: eslintConfigSchema,
    ruff: ruffConfigSchema,
  })
  .strict()
  .optional();

/** Code type checking configuration */
const codeTypesSchema = z
  .object({
    tsc: tscConfigSchema,
    ty: tyConfigSchema,
  })
  .strict()
  .optional();

/** Code unused detection configuration */
const codeUnusedSchema = z
  .object({
    knip: knipConfigSchema,
    vulture: vultureConfigSchema,
  })
  .strict()
  .optional();

/** Code domain configuration */
const codeSchema = z
  .object({
    linting: codeLintingSchema,
    types: codeTypesSchema,
    unused: codeUnusedSchema,
    coverage_run: coverageRunConfigSchema,
    security: codeSecuritySchema,
    naming: namingConfigSchema,
    quality: codeQualitySchema,
  })
  .strict()
  .optional();

// =============================================================================
// Process Domain Configuration
// =============================================================================

/** Hook commands configuration - maps hook name to required commands */
const hookCommandsSchema = z.record(z.string(), z.array(z.string())).optional();

/** Git hooks (husky) configuration */
const hooksConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    require_husky: z.boolean().optional().default(true), // Require .husky/ directory
    require_hooks: z.array(z.string()).optional(), // e.g., ["pre-commit", "pre-push"]
    commands: hookCommandsSchema, // e.g., { "pre-commit": ["lint-staged"] }
    protected_branches: z.array(z.string()).optional(), // e.g., ["main", "master"] - verify pre-push prevents direct pushes
    templates: z.record(z.string(), z.string()).optional(), // Maps hook name → expected file content, e.g., { "pre-commit" = "pnpm lint-staged" }
  })
  .strict()
  .optional();

/**
 * CI commands configuration value - can be:
 * - Array of strings: commands required anywhere in workflow
 * - Record mapping job names to arrays: commands required in specific jobs
 */
const ciCommandsValueSchema = z.union([
  z.array(z.string()), // Workflow-level: ["cmd1", "cmd2"]
  z.record(z.string(), z.array(z.string())), // Job-level: { jobName: ["cmd1"] }
]);

/** CI commands schema - maps workflow file to required commands */
const ciCommandsSchema = z.record(z.string(), ciCommandsValueSchema).optional();

/** CI/CD workflows configuration */
const ciConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    require_workflows: z.array(z.string()).optional(), // e.g., ["ci.yml", "release.yml"]
    jobs: z.record(z.string(), z.array(z.string())).optional(), // e.g., { "ci.yml": ["test", "lint"] }
    actions: z.record(z.string(), z.array(z.string())).optional(), // e.g., { "ci.yml": ["actions/checkout"] }
    commands: ciCommandsSchema, // e.g., { "ci.yml": ["conform code check"] } or { "ci.yml": { "test": ["npm test"] } }
  })
  .strict()
  .optional();

/** Branch naming configuration */
const branchesConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    pattern: z.string().optional(), // Regex pattern for branch names
    exclude: z.array(z.string()).optional(), // Branches to skip (e.g., ["main", "master"])
    require_issue: z.boolean().optional().default(false), // Require issue number in branch name
    issue_pattern: z.string().optional(), // Regex to extract issue number (default: captures number after type/)
  })
  .strict()
  .optional();

/** Commit message format configuration */
const commitsConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    pattern: z.string().optional(), // Regex pattern for commit messages (e.g., conventional commits)
    types: z.array(z.string()).optional(), // Allowed commit types (e.g., ["feat", "fix", "chore"])
    require_scope: z.boolean().optional().default(false), // Require scope like feat(api): ...
    max_subject_length: z.number().int().positive().optional(), // Max length of subject line
  })
  .strict()
  .optional();

/** Changeset bump type */
const changesetBumpTypeSchema = z.enum(["patch", "minor", "major"]);

/** Changeset validation configuration */
const changesetsConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    require_for_paths: z.array(z.string()).optional(), // Glob patterns that require changesets (e.g., ["src/**"])
    exclude_paths: z.array(z.string()).optional(), // Paths that don't require changesets (e.g., ["**/*.test.ts"])
    validate_format: z.boolean().optional().default(true), // Validate changeset file format (frontmatter, description)
    allowed_bump_types: z.array(changesetBumpTypeSchema).optional(), // Restrict allowed bump types (e.g., ["patch", "minor"])
    require_description: z.boolean().optional().default(true), // Require non-empty description
    min_description_length: z.number().int().positive().optional(), // Minimum description length
  })
  .strict()
  .optional();

/** PR configuration */
const prConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    max_files: z.number().int().positive().optional(), // Max files changed in PR
    max_lines: z.number().int().positive().optional(), // Max lines changed (additions + deletions)
    require_issue: z.boolean().optional().default(false), // Require issue reference in PR description
    issue_keywords: z.array(z.string()).optional(), // Keywords that link to issues (e.g., ["Closes", "Fixes", "Resolves"])
    exclude: z.array(globPatternSchema).optional(), // Glob patterns to exclude from size calculation (e.g., ["*.lock", "**/*.snap"])
  })
  .strict()
  .optional();

/** Ticket reference validation configuration */
const ticketsConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    pattern: z.string().optional(), // Regex pattern for ticket IDs (e.g., "^(ABC|XYZ)-[0-9]+")
    require_in_commits: z.boolean().optional().default(true), // Require ticket in commit messages
    require_in_branch: z.boolean().optional().default(false), // Require ticket in branch name
  })
  .strict()
  .optional();

/** Coverage enforcement mode */
const coverageEnforceInSchema = z.enum(["ci", "config", "both"]);

/** Coverage enforcement configuration */
const coverageConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    min_threshold: z.number().int().min(0).max(100).optional(), // Minimum coverage percentage
    enforce_in: coverageEnforceInSchema.optional().default("config"), // Where to verify coverage
    ci_workflow: z.string().optional(), // Workflow file to check (e.g., "ci.yml")
    ci_job: z.string().optional(), // Job name to check (e.g., "test")
  })
  .strict()
  .optional();

/** Bypass actor type for GitHub Rulesets */
const bypassActorTypeSchema = z.enum([
  "Integration", // GitHub App
  "OrganizationAdmin", // Org admin role
  "RepositoryRole", // Repository role (1=read, 2=triage, 3=write, 4=maintain, 5=admin)
  "Team", // GitHub team
  "DeployKey", // Deploy key
]);

/** Bypass mode - when the actor can bypass */
const bypassModeSchema = z.enum([
  "always", // Can always bypass
  "pull_request", // Can bypass only via pull request
]);

/** Single bypass actor configuration */
const bypassActorSchema = z
  .object({
    actor_type: bypassActorTypeSchema,
    actor_id: z.number().int().positive().optional(), // Actor ID (required except for DeployKey)
    bypass_mode: bypassModeSchema.optional().default("always"),
  })
  .strict();

/** Ruleset configuration (uses GitHub Rulesets API) */
const rulesetConfigSchema = z
  .object({
    name: z.string().optional().default("Branch Protection"), // Ruleset name in GitHub
    branch: z.string().optional().default("main"), // Branch to check (default: main)
    enforcement: z.enum(["active", "evaluate", "disabled"]).optional().default("active"), // Ruleset enforcement
    required_reviews: z.number().int().min(0).optional(), // Minimum required reviews
    dismiss_stale_reviews: z.boolean().optional(), // Dismiss stale reviews on new commits
    require_code_owner_reviews: z.boolean().optional(), // Require CODEOWNER review
    require_status_checks: z.array(z.string()).optional(), // Required status checks
    require_branches_up_to_date: z.boolean().optional(), // Require branch to be up to date
    require_signed_commits: z.boolean().optional(), // Require signed commits
    enforce_admins: z.boolean().optional(), // Enforce rules for admins (no bypass actors when true)
    bypass_actors: z.array(bypassActorSchema).optional(), // Actors that can bypass rules
  })
  .strict()
  .optional();

/** Tag protection ruleset configuration */
const tagProtectionConfigSchema = z
  .object({
    patterns: z.array(z.string()).optional(), // Tag patterns to protect (e.g., ["v*"])
    prevent_deletion: z.boolean().optional().default(true), // Prevent tag deletion
    prevent_update: z.boolean().optional().default(true), // Prevent tag updates (force-push)
  })
  .strict()
  .optional();

/** Repository settings configuration */
const repoConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    require_branch_protection: z.boolean().optional().default(false), // Check branch protection exists
    require_codeowners: z.boolean().optional().default(false), // Check CODEOWNERS file exists
    ruleset: rulesetConfigSchema, // GitHub Ruleset configuration
    tag_protection: tagProtectionConfigSchema, // Tag protection via GitHub rulesets
  })
  .strict()
  .optional();

/** S3 backup verification configuration */
const backupsConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    bucket: z.string().optional(), // S3 bucket name
    prefix: z.string().optional(), // S3 key prefix
    max_age_hours: z.number().int().positive().optional().default(24), // Max age of most recent backup
    region: z.string().optional(), // AWS region (defaults to AWS_REGION env)
  })
  .strict()
  .optional();

/** Single CODEOWNERS rule */
const codeownersRuleSchema = z
  .object({
    pattern: z.string(), // File pattern (e.g., "/standards.toml", "*.js", "/src/api/*")
    owners: z.array(z.string()), // Owner handles (e.g., ["@user", "@org/team"])
  })
  .strict();

/** CODEOWNERS validation configuration */
const codeownersConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    rules: z.array(codeownersRuleSchema).optional(), // Required rules in CODEOWNERS
  })
  .strict()
  .optional();

/** Doc type configuration - defines required sections and frontmatter per doc type */
const docsTypeConfigSchema = z
  .object({
    required_sections: z.array(z.string()).optional(), // e.g., ["Overview", "Parameters", "Returns", "Examples"]
    frontmatter: z.array(z.string()).optional(), // e.g., ["title", "tracks"]
  })
  .strict();

/** Documentation enforcement mode */
const docsEnforcementSchema = z.enum(["block", "warn"]);

/** Documentation governance configuration */
const docsConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    path: z.string().optional().default("docs/"), // Documentation directory
    enforcement: docsEnforcementSchema.optional().default("warn"), // "block" or "warn"
    allowlist: z.array(z.string()).optional(), // Markdown files allowed outside docs/, e.g., ["README.md", "CLAUDE.md"]
    max_files: z.number().int().positive().optional(), // Max markdown files in docs/
    max_file_lines: z.number().int().positive().optional(), // Max lines per markdown file
    max_total_kb: z.number().int().positive().optional(), // Max total size of docs/
    staleness_days: z.number().int().positive().optional().default(30), // Days before doc is considered stale
    stale_mappings: z.record(z.string(), z.string()).optional(), // Override doc-to-source mappings
    min_coverage: z.number().int().min(0).max(100).optional(), // Minimum API coverage percentage
    coverage_paths: z.array(z.string()).optional(), // Glob patterns for source files, e.g., ["src/**/*.ts"]
    exclude_patterns: z.array(z.string()).optional(), // Exclude from coverage, e.g., ["**/*.test.ts"]
    types: z.record(z.string(), docsTypeConfigSchema).optional(), // Per-type config, e.g., { api: {...}, guide: {...} }
  })
  .strict()
  .optional();

// =============================================================================
// MCP Configuration
// =============================================================================

/** MCP standards source configuration */
const mcpStandardsSchema = z
  .object({
    source: z
      .string()
      .optional()
      .describe(
        'Standards repository source: "github:owner/repo", "github:owner/repo@ref", or local path'
      ),
  })
  .strict()
  .optional();

/** MCP configuration */
const mcpSchema = z
  .object({
    standards: mcpStandardsSchema,
  })
  .strict()
  .optional();

// =============================================================================
// Infra Domain Configuration
// =============================================================================

/** Infra domain configuration for AWS resource verification */
const infraSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    manifest: z.string().optional().default("infra-manifest.json"), // Path to manifest file
  })
  .strict()
  .optional();

/** Default ignore patterns for forbidden files scan */
const DEFAULT_FORBIDDEN_FILES_IGNORE = ["**/node_modules/**", "**/.git/**"];

/** Forbidden files configuration - files that must NOT exist */
const forbiddenFilesConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    files: z.array(globPatternSchema).optional(), // Glob patterns for files that must not exist (validated)
    ignore: z.array(globPatternSchema).optional(), // Glob patterns to ignore (validated, overrides defaults if provided)
    message: z.string().optional(), // Custom message explaining why these files are forbidden
  })
  .strict()
  .optional();

export { DEFAULT_FORBIDDEN_FILES_IGNORE };

/** Process domain configuration */
const processSchema = z
  .object({
    hooks: hooksConfigSchema,
    ci: ciConfigSchema,
    branches: branchesConfigSchema,
    commits: commitsConfigSchema,
    changesets: changesetsConfigSchema,
    pr: prConfigSchema,
    tickets: ticketsConfigSchema,
    coverage: coverageConfigSchema,
    repo: repoConfigSchema,
    backups: backupsConfigSchema,
    codeowners: codeownersConfigSchema,
    docs: docsConfigSchema,
    forbidden_files: forbiddenFilesConfigSchema,
  })
  .strict()
  .optional();

// =============================================================================
// Metadata Configuration
// =============================================================================

/** Repository tier for standards enforcement level */
const tierSchema = z.enum(["production", "internal", "prototype"]);

/** Repository status indicating lifecycle phase */
const statusSchema = z.enum(["active", "pre-release", "deprecated"]);

/** Metadata configuration for repository tier, project, organisation, and status */
const metadataSchema = z
  .object({
    tier: tierSchema,
    project: z.string().optional(),
    organisation: z.string().optional(),
    status: statusSchema.optional().default("active"),
  })
  .strict()
  .optional();

// =============================================================================
// Extends Configuration
// =============================================================================

/** Extends configuration for inheriting from registries */
const extendsSchema = z
  .object({
    registry: z.string(), // e.g., "github:myorg/standards" or local path
    rulesets: z.array(z.string()), // e.g., ["base", "typescript"]
  })
  .strict()
  .optional();

// =============================================================================
// Monorepo Configuration
// =============================================================================

/** Monorepo project detection configuration */
const monorepoSchema = z
  .object({
    exclude: z.array(globPatternSchema).optional(), // Glob patterns to exclude from project detection
  })
  .strict()
  .optional();

// =============================================================================
// Full Configuration
// =============================================================================

/** Full standards.toml schema */
export const configSchema = z
  .object({
    metadata: metadataSchema,
    extends: extendsSchema,
    code: codeSchema,
    process: processSchema,
    infra: infraSchema,
    mcp: mcpSchema,
    monorepo: monorepoSchema,
  })
  .strict();

/** Inferred TypeScript type from schema */
export type Config = z.infer<typeof configSchema>;

/** Default configuration */
export const defaultConfig: Config = {
  code: {
    linting: {
      eslint: { enabled: false },
      ruff: { enabled: false },
    },
    types: {
      tsc: { enabled: false },
      ty: { enabled: false },
    },
    unused: {
      knip: { enabled: false },
      vulture: { enabled: false },
    },
    coverage_run: {
      enabled: false,
      min_threshold: 80,
      runner: "auto",
    },
    security: {
      secrets: { enabled: false, scan_mode: "branch", base_branch: "main" },
      pnpmaudit: { enabled: false, exclude_dev: true },
      pipaudit: { enabled: false },
    },
    naming: {
      enabled: false,
    },
    quality: {
      "disable-comments": { enabled: false },
    },
  },
  monorepo: {},
  process: {
    hooks: {
      enabled: false,
      require_husky: true,
    },
    ci: {
      enabled: false,
    },
    branches: {
      enabled: false,
      require_issue: false,
    },
    commits: {
      enabled: false,
      require_scope: false,
    },
    changesets: {
      enabled: false,
      validate_format: true,
      require_description: true,
    },
    pr: {
      enabled: false,
      require_issue: false,
    },
    tickets: {
      enabled: false,
      require_in_commits: true,
      require_in_branch: false,
    },
    coverage: {
      enabled: false,
      enforce_in: "config",
    },
    repo: {
      enabled: false,
      require_branch_protection: false,
      require_codeowners: false,
    },
    backups: {
      enabled: false,
      max_age_hours: 24,
    },
    codeowners: {
      enabled: false,
    },
    docs: {
      enabled: false,
      path: "docs/",
      enforcement: "warn",
      staleness_days: 30,
    },
    forbidden_files: {
      enabled: false,
    },
  },
  infra: {
    enabled: false,
    manifest: "infra-manifest.json",
  },
  mcp: {
    standards: {
      source: undefined,
    },
  },
};
