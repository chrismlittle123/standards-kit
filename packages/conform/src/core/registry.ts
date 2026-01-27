/* eslint-disable max-lines -- registry config merging requires many type-safe merge functions */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as toml from "@iarna/toml";
import { execa } from "execa";

import { CACHE, TIMEOUTS } from "../constants.js";
import { ConfigError } from "./loader.js";
import { type Config, configSchema } from "./schema.js";

/** Authentication method for private registries */
type AuthMethod = "token" | "ssh" | "none";

interface RegistryLocation {
  type: "github" | "local";
  owner?: string;
  repo?: string;
  ref?: string;
  path: string;
  auth?: AuthMethod;
}

/**
 * Detect authentication method based on environment variables.
 * Priority: CONFORM_REGISTRY_TOKEN > GITHUB_TOKEN > SSH key detection > none
 */
function detectAuthMethod(): AuthMethod {
  if (process.env.CONFORM_REGISTRY_TOKEN || process.env.GITHUB_TOKEN) {
    return "token";
  }
  // Check for SSH key - if SSH_AUTH_SOCK is set, SSH agent is available
  if (process.env.SSH_AUTH_SOCK) {
    return "ssh";
  }
  return "none";
}

/**
 * Get the authentication token from environment variables.
 */
function getAuthToken(): string | undefined {
  return process.env.CONFORM_REGISTRY_TOKEN ?? process.env.GITHUB_TOKEN;
}

/**
 * Build the git URL for a GitHub repository based on auth method.
 */
function buildGitHubUrl(owner: string, repo: string, auth: AuthMethod): string {
  switch (auth) {
    case "ssh":
      return `git@github.com:${owner}/${repo}.git`;
    case "token": {
      const token = getAuthToken();
      if (token) {
        return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
      }
      // Fall back to regular HTTPS if no token found
      return `https://github.com/${owner}/${repo}.git`;
    }
    case "none":
    default:
      return `https://github.com/${owner}/${repo}.git`;
  }
}

/**
 * Parse explicit auth method from URL prefix.
 * Supports: github+ssh:, github+token:, github: (auto-detect)
 */
function parseAuthFromUrl(url: string): { auth: AuthMethod | "auto"; rest: string } {
  if (url.startsWith("github+ssh:")) {
    return { auth: "ssh", rest: url.slice(11) };
  }
  if (url.startsWith("github+token:")) {
    return { auth: "token", rest: url.slice(13) };
  }
  if (url.startsWith("github:")) {
    return { auth: "auto", rest: url.slice(7) };
  }
  throw new ConfigError(`Invalid GitHub registry URL: ${url}`);
}

function parseGitHubUrl(url: string): RegistryLocation {
  const { auth: explicitAuth, rest } = parseAuthFromUrl(url);
  const [repoPath, ref] = rest.split("@");
  const [owner, repo] = repoPath.split("/");

  if (!owner || !repo) {
    throw new ConfigError(
      `Invalid GitHub registry URL: ${url}. Expected format: github:owner/repo or github+ssh:owner/repo`
    );
  }

  const auth = explicitAuth === "auto" ? detectAuthMethod() : explicitAuth;

  return {
    type: "github",
    owner,
    repo,
    ref: ref || undefined,
    path: buildGitHubUrl(owner, repo, auth),
    auth,
  };
}

export function parseRegistryUrl(url: string, configDir?: string): RegistryLocation {
  if (url.startsWith("github:") || url.startsWith("github+")) {
    return parseGitHubUrl(url);
  }

  const localPath = !path.isAbsolute(url) && configDir ? path.resolve(configDir, url) : url;
  return { type: "local", path: localPath };
}

async function updateExistingRepo(repoDir: string, ref?: string): Promise<boolean> {
  try {
    if (ref) {
      await execa("git", ["fetch", "--all"], { cwd: repoDir });
      await execa("git", ["checkout", ref], { cwd: repoDir });
    } else {
      await execa("git", ["pull", "--ff-only"], { cwd: repoDir });
    }
    return true;
  } catch {
    fs.rmSync(repoDir, { recursive: true, force: true });
    return false;
  }
}

async function cloneRepo(location: RegistryLocation, repoDir: string): Promise<void> {
  const cacheDir = path.dirname(repoDir);
  fs.mkdirSync(cacheDir, { recursive: true });

  const cloneArgs = ["clone", "--depth", "1"];
  if (location.ref) {
    cloneArgs.push("--branch", location.ref);
  }
  cloneArgs.push(location.path, repoDir);

  try {
    await execa("git", cloneArgs, { timeout: TIMEOUTS.git });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("timed out")) {
      throw new ConfigError(`Registry clone timed out after ${TIMEOUTS.git / 1000} seconds: ${location.path}`);
    }
    throw new ConfigError(`Failed to clone registry: ${message}`);
  }
}

export async function fetchRegistry(location: RegistryLocation): Promise<string> {
  if (location.type === "local") {
    if (!fs.existsSync(location.path)) {
      throw new ConfigError(`Registry not found: ${location.path}`);
    }
    return location.path;
  }

  const cacheDir = path.join(os.tmpdir(), CACHE.registryCacheDir);
  const repoDir = path.join(cacheDir, `${location.owner}-${location.repo}`);

  if (fs.existsSync(repoDir)) {
    await updateExistingRepo(repoDir, location.ref);
  }

  if (!fs.existsSync(repoDir)) {
    await cloneRepo(location, repoDir);
  }

  return repoDir;
}

export function loadRuleset(registryDir: string, rulesetName: string): Config {
  const rulesetPath = path.join(registryDir, "rulesets", `${rulesetName}.toml`);

  if (!fs.existsSync(rulesetPath)) {
    throw new ConfigError(`Ruleset not found: ${rulesetName} (expected at ${rulesetPath})`);
  }

  const content = fs.readFileSync(rulesetPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = toml.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to parse ruleset ${rulesetName}: ${message}`);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new ConfigError(`Invalid ruleset ${rulesetName}: ${errors}`);
  }

  return result.data;
}

type CodeConfig = NonNullable<Config["code"]>;

function mergeToolConfig<T extends object>(base?: T, override?: T): T | undefined {
  if (!override) {
    return base;
  }
  return { ...base, ...override };
}

function mergeLinting(
  base: CodeConfig["linting"],
  override: CodeConfig["linting"]
): CodeConfig["linting"] {
  if (!override) {
    return base;
  }
  return {
    ...base,
    eslint: mergeToolConfig(base?.eslint, override.eslint),
    ruff: mergeToolConfig(base?.ruff, override.ruff),
  };
}

function mergeTypes(base: CodeConfig["types"], override: CodeConfig["types"]): CodeConfig["types"] {
  if (!override) {
    return base;
  }
  return {
    ...base,
    tsc: mergeToolConfig(base?.tsc, override.tsc),
    ty: mergeToolConfig(base?.ty, override.ty),
  };
}

function mergeUnused(
  base: CodeConfig["unused"],
  override: CodeConfig["unused"]
): CodeConfig["unused"] {
  if (!override) {
    return base;
  }
  return {
    ...base,
    knip: mergeToolConfig(base?.knip, override.knip),
    vulture: mergeToolConfig(base?.vulture, override.vulture),
  };
}

function mergeSecurity(
  base: CodeConfig["security"],
  override: CodeConfig["security"]
): CodeConfig["security"] {
  if (!override) {
    return base;
  }
  return {
    ...base,
    secrets: mergeToolConfig(base?.secrets, override.secrets),
    pnpmaudit: mergeToolConfig(base?.pnpmaudit, override.pnpmaudit),
    pipaudit: mergeToolConfig(base?.pipaudit, override.pipaudit),
  };
}

function mergeNaming(
  base: CodeConfig["naming"],
  override: CodeConfig["naming"]
): CodeConfig["naming"] {
  if (!override) {
    return base;
  }
  // enabled has a default value from schema, so it's always defined after parsing
  return {
    enabled: override.enabled,
    rules: override.rules ?? base?.rules,
  };
}

function mergeQuality(
  base: CodeConfig["quality"],
  override: CodeConfig["quality"]
): CodeConfig["quality"] {
  if (!override) {
    return base;
  }
  return {
    ...base,
    "disable-comments": mergeToolConfig(base?.["disable-comments"], override["disable-comments"]),
  };
}

function mergeCodeSection(base: CodeConfig | undefined, override: CodeConfig): CodeConfig {
  return {
    linting: mergeLinting(base?.linting, override.linting),
    types: mergeTypes(base?.types, override.types),
    unused: mergeUnused(base?.unused, override.unused),
    coverage_run: mergeToolConfig(base?.coverage_run, override.coverage_run),
    security: mergeSecurity(base?.security, override.security),
    naming: mergeNaming(base?.naming, override.naming),
    quality: mergeQuality(base?.quality, override.quality),
  };
}

type ProcessConfig = NonNullable<Config["process"]>;

function mergeHooksConfig(
  base: ProcessConfig["hooks"],
  override: ProcessConfig["hooks"]
): ProcessConfig["hooks"] {
  if (!override) {
    return base;
  }
  // enabled and require_husky have schema defaults, so they're always defined
  return {
    enabled: override.enabled,
    require_husky: override.require_husky,
    require_hooks: override.require_hooks ?? base?.require_hooks,
    commands: override.commands ?? base?.commands,
  };
}

function mergeCiConfig(
  base: ProcessConfig["ci"],
  override: ProcessConfig["ci"]
): ProcessConfig["ci"] {
  if (!override) {
    return base;
  }
  return {
    enabled: override.enabled,
    require_workflows: override.require_workflows ?? base?.require_workflows,
    jobs: override.jobs ?? base?.jobs,
    actions: override.actions ?? base?.actions,
  };
}

function mergeBranchesConfig(
  base: ProcessConfig["branches"],
  override: ProcessConfig["branches"]
): ProcessConfig["branches"] {
  if (!override) {
    return base;
  }
  return {
    enabled: override.enabled,
    require_issue: override.require_issue,
    pattern: override.pattern ?? base?.pattern,
    exclude: override.exclude ?? base?.exclude,
    issue_pattern: override.issue_pattern ?? base?.issue_pattern,
  };
}

function mergePrConfig(
  base: ProcessConfig["pr"],
  override: ProcessConfig["pr"]
): ProcessConfig["pr"] {
  if (!override) {
    return base;
  }
  return {
    enabled: override.enabled,
    require_issue: override.require_issue,
    max_files: override.max_files ?? base?.max_files,
    max_lines: override.max_lines ?? base?.max_lines,
    issue_keywords: override.issue_keywords ?? base?.issue_keywords,
  };
}

function mergeTicketsConfig(
  base: ProcessConfig["tickets"],
  override: ProcessConfig["tickets"]
): ProcessConfig["tickets"] {
  if (!override) {
    return base;
  }
  // require_in_commits and require_in_branch have schema defaults, so they're always defined after parsing
  return {
    enabled: override.enabled,
    pattern: override.pattern ?? base?.pattern,
    require_in_commits: override.require_in_commits,
    require_in_branch: override.require_in_branch,
  };
}

function mergeCoverageConfig(
  base: ProcessConfig["coverage"],
  override: ProcessConfig["coverage"]
): ProcessConfig["coverage"] {
  if (!override) {
    return base;
  }
  // enforce_in has schema default, so it's always defined after parsing
  return {
    enabled: override.enabled,
    min_threshold: override.min_threshold ?? base?.min_threshold,
    enforce_in: override.enforce_in,
    ci_workflow: override.ci_workflow ?? base?.ci_workflow,
    ci_job: override.ci_job ?? base?.ci_job,
  };
}

function mergeCommitsConfig(
  base: ProcessConfig["commits"],
  override: ProcessConfig["commits"]
): ProcessConfig["commits"] {
  if (!override) {
    return base;
  }
  // require_scope has schema default, so it's always defined after parsing
  return {
    enabled: override.enabled,
    pattern: override.pattern ?? base?.pattern,
    types: override.types ?? base?.types,
    require_scope: override.require_scope,
    max_subject_length: override.max_subject_length ?? base?.max_subject_length,
  };
}

function mergeChangesetsConfig(
  base: ProcessConfig["changesets"],
  override: ProcessConfig["changesets"]
): ProcessConfig["changesets"] {
  if (!override) {
    return base;
  }
  // validate_format and require_description have schema defaults, so they're always defined after parsing
  return {
    enabled: override.enabled,
    require_for_paths: override.require_for_paths ?? base?.require_for_paths,
    exclude_paths: override.exclude_paths ?? base?.exclude_paths,
    validate_format: override.validate_format,
    allowed_bump_types: override.allowed_bump_types ?? base?.allowed_bump_types,
    require_description: override.require_description,
    min_description_length: override.min_description_length ?? base?.min_description_length,
  };
}

function mergeRepoConfig(
  base: ProcessConfig["repo"],
  override: ProcessConfig["repo"]
): ProcessConfig["repo"] {
  if (!override) {
    return base;
  }
  // require_branch_protection and require_codeowners have schema defaults
  return {
    enabled: override.enabled,
    require_branch_protection: override.require_branch_protection,
    require_codeowners: override.require_codeowners,
    ruleset: override.ruleset ?? base?.ruleset,
    tag_protection: override.tag_protection ?? base?.tag_protection,
  };
}

function mergeBackupsConfig(
  base: ProcessConfig["backups"],
  override: ProcessConfig["backups"]
): ProcessConfig["backups"] {
  if (!override) {
    return base;
  }
  // max_age_hours has schema default
  return {
    enabled: override.enabled,
    bucket: override.bucket ?? base?.bucket,
    prefix: override.prefix ?? base?.prefix,
    max_age_hours: override.max_age_hours,
    region: override.region ?? base?.region,
  };
}

function mergeCodeownersConfig(
  base: ProcessConfig["codeowners"],
  override: ProcessConfig["codeowners"]
): ProcessConfig["codeowners"] {
  if (!override) {
    return base;
  }
  return {
    enabled: override.enabled,
    rules: override.rules ?? base?.rules,
  };
}

// eslint-disable-next-line complexity -- docs config has many optional fields requiring individual merge
function mergeDocsConfig(
  base: ProcessConfig["docs"],
  override: ProcessConfig["docs"]
): ProcessConfig["docs"] {
  if (!override) {
    return base;
  }
  // Fields with schema defaults: enabled, path, enforcement, staleness_days
  return {
    enabled: override.enabled,
    path: override.path,
    enforcement: override.enforcement,
    allowlist: override.allowlist ?? base?.allowlist,
    max_files: override.max_files ?? base?.max_files,
    max_file_lines: override.max_file_lines ?? base?.max_file_lines,
    max_total_kb: override.max_total_kb ?? base?.max_total_kb,
    staleness_days: override.staleness_days,
    stale_mappings: override.stale_mappings ?? base?.stale_mappings,
    min_coverage: override.min_coverage ?? base?.min_coverage,
    coverage_paths: override.coverage_paths ?? base?.coverage_paths,
    exclude_patterns: override.exclude_patterns ?? base?.exclude_patterns,
    types: override.types ?? base?.types,
  };
}

// eslint-disable-next-line complexity -- merging all process config sections requires multiple calls
function mergeProcessSection(
  base: ProcessConfig | undefined,
  override: ProcessConfig
): ProcessConfig {
  return {
    hooks: mergeHooksConfig(base?.hooks, override.hooks),
    ci: mergeCiConfig(base?.ci, override.ci),
    branches: mergeBranchesConfig(base?.branches, override.branches),
    commits: mergeCommitsConfig(base?.commits, override.commits),
    changesets: mergeChangesetsConfig(base?.changesets, override.changesets),
    pr: mergePrConfig(base?.pr, override.pr),
    tickets: mergeTicketsConfig(base?.tickets, override.tickets),
    coverage: mergeCoverageConfig(base?.coverage, override.coverage),
    repo: mergeRepoConfig(base?.repo, override.repo),
    backups: mergeBackupsConfig(base?.backups, override.backups),
    codeowners: mergeCodeownersConfig(base?.codeowners, override.codeowners),
    docs: mergeDocsConfig(base?.docs, override.docs),
  };
}

export function mergeConfigs(base: Config, override: Config): Config {
  const merged: Config = { ...base };

  if (override.code) {
    merged.code = mergeCodeSection(base.code, override.code);
  }

  if (override.process) {
    merged.process = mergeProcessSection(base.process, override.process);
  }

  if (override.infra) {
    merged.infra = override.infra;
  }

  if (override.monorepo) {
    merged.monorepo = override.monorepo;
  }

  return merged;
}

export async function resolveExtends(config: Config, configDir: string): Promise<Config> {
  if (!config.extends) {
    return config;
  }

  const { registry, rulesets } = config.extends;
  const location = parseRegistryUrl(registry, configDir);
  const registryDir = await fetchRegistry(location);

  let mergedConfig: Config = {};
  for (const rulesetName of rulesets) {
    const ruleset = loadRuleset(registryDir, rulesetName);
    mergedConfig = mergeConfigs(mergedConfig, ruleset);
  }

  // Local config overrides registry config (include all domains)
  const localConfig: Config = {
    code: config.code,
    process: config.process,
    infra: config.infra,
    monorepo: config.monorepo,
  };
  return mergeConfigs(mergedConfig, localConfig);
}
