import * as fs from "node:fs";
import * as path from "node:path";

import TOML from "@iarna/toml";

import { resolveExtends } from "./registry.js";
import { type Config, configSchema, defaultConfig } from "./schema.js";

/**
 * Recursively strip Symbol properties from an object.
 * @iarna/toml adds Symbol properties to inline tables (e.g., Symbol('type')),
 * which causes Zod 4.x validation to fail with "Cannot convert a Symbol value to a string"
 * when validating z.record() schemas.
 */
function stripSymbols(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(stripSymbols);
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj as object)) {
    result[key] = stripSymbols((obj as Record<string, unknown>)[key]);
  }
  return result;
}

/** Config file name */
export const CONFIG_FILE_NAME = "standards.toml";

interface LoadConfigResult {
  config: Config;
  configPath: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Check if a path is a broken symlink
 */
function isBrokenSymlink(filePath: string): boolean {
  try {
    const stats = fs.lstatSync(filePath);
    if (stats.isSymbolicLink()) {
      // It's a symlink - check if target exists
      try {
        fs.statSync(filePath);
        return false; // Target exists, not broken
      } catch {
        return true; // Target doesn't exist, broken symlink
      }
    }
    return false; // Not a symlink
  } catch {
    return false; // Path doesn't exist at all
  }
}

/**
 * Find standards.toml by walking up the directory tree
 */
export function findConfigFile(startDir: string = process.cwd()): string | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const configPath = path.join(currentDir, CONFIG_FILE_NAME);
    if (isBrokenSymlink(configPath)) {
      throw new ConfigError(`${CONFIG_FILE_NAME} exists but is a broken symlink: ${configPath}`);
    }
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    currentDir = path.dirname(currentDir);
  }

  // Check root directory too
  const rootConfig = path.join(root, CONFIG_FILE_NAME);
  if (isBrokenSymlink(rootConfig)) {
    throw new ConfigError(`${CONFIG_FILE_NAME} exists but is a broken symlink: ${rootConfig}`);
  }
  return fs.existsSync(rootConfig) ? rootConfig : null;
}

/**
 * Resolve and validate config file path
 * Always returns an absolute path to ensure consistent behavior
 */
function resolveConfigPath(configPath?: string): string {
  const resolved = configPath ?? findConfigFile();
  if (!resolved) {
    throw new ConfigError(`No ${CONFIG_FILE_NAME} found. Create one or specify --config path.`);
  }
  // Convert to absolute path for consistent behavior across tools
  const absolutePath = path.resolve(resolved);
  if (!fs.existsSync(absolutePath)) {
    throw new ConfigError(`Config file not found: ${resolved}`);
  }
  return absolutePath;
}

/**
 * Parse TOML file content
 */
function parseTomlFile(filePath: string): unknown {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    // Strip Symbol properties that @iarna/toml adds to inline tables
    // to prevent Zod 4.x validation errors
    return stripSymbols(TOML.parse(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new ConfigError(`Failed to parse ${CONFIG_FILE_NAME}: ${message}`);
  }
}

/**
 * Validate config against schema
 */
function validateConfig(rawConfig: unknown): Config {
  const result = configSchema.safeParse(rawConfig);
  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `  - ${e.path.map((p) => (typeof p === "symbol" ? (p.description ?? "[symbol]") : p)).join(".")}: ${e.message}`)
      .join("\n");
    throw new ConfigError(`Invalid ${CONFIG_FILE_NAME} configuration:\n${errors}`);
  }
  return result.data;
}

/**
 * Load and parse standards.toml configuration (sync version without extends resolution)
 * Use loadConfigAsync for full extends support
 */
export function loadConfig(configPath?: string): LoadConfigResult {
  const resolvedPath = resolveConfigPath(configPath);
  const rawConfig = parseTomlFile(resolvedPath);
  const validatedConfig = validateConfig(rawConfig);
  const config = mergeWithDefaults(validatedConfig);
  return { config, configPath: resolvedPath };
}

/**
 * Load and parse standards.toml configuration with extends resolution
 */
export async function loadConfigAsync(configPath?: string): Promise<LoadConfigResult> {
  const resolvedPath = resolveConfigPath(configPath);
  const rawConfig = parseTomlFile(resolvedPath);
  const validatedConfig = validateConfig(rawConfig);

  // Resolve extends if present
  const configDir = path.dirname(resolvedPath);
  const resolvedConfig = await resolveExtends(validatedConfig, configDir);

  const config = mergeWithDefaults(resolvedConfig);
  return { config, configPath: resolvedPath };
}

/** Merge two optional objects, with right side taking precedence */
function merge<T extends object>(a: T | undefined, b: T | undefined): T {
  return { ...a, ...b } as T;
}

type CodeConfig = NonNullable<Config["code"]>;

function mergeLinting(c: Config, dc: Config): CodeConfig["linting"] {
  const cl = c.code?.linting;
  const dl = dc.code?.linting;
  return { eslint: merge(dl?.eslint, cl?.eslint), ruff: merge(dl?.ruff, cl?.ruff) };
}

function mergeSecurity(c: Config, dc: Config): CodeConfig["security"] {
  const cs = c.code?.security;
  const ds = dc.code?.security;
  return {
    secrets: merge(ds?.secrets, cs?.secrets),
    pnpmaudit: merge(ds?.pnpmaudit, cs?.pnpmaudit),
    pipaudit: merge(ds?.pipaudit, cs?.pipaudit),
  };
}

function mergeTypes(c: Config, dc: Config): CodeConfig["types"] {
  return {
    tsc: merge(dc.code?.types?.tsc, c.code?.types?.tsc),
    ty: merge(dc.code?.types?.ty, c.code?.types?.ty),
  };
}

function mergeUnused(c: Config, dc: Config): CodeConfig["unused"] {
  return {
    knip: merge(dc.code?.unused?.knip, c.code?.unused?.knip),
    vulture: merge(dc.code?.unused?.vulture, c.code?.unused?.vulture),
  };
}

function mergeCoverageRun(c: Config, dc: Config): CodeConfig["coverage_run"] {
  return merge(dc.code?.coverage_run, c.code?.coverage_run);
}

function mergeNaming(c: Config, dc: Config): CodeConfig["naming"] {
  const cn = c.code?.naming;
  const dn = dc.code?.naming;
  // For naming, we want to preserve the rules array from user config
  return {
    enabled: cn?.enabled ?? dn?.enabled ?? false,
    rules: cn?.rules ?? dn?.rules,
  };
}

function mergeQuality(c: Config, dc: Config): CodeConfig["quality"] {
  const cq = c.code?.quality;
  const dq = dc.code?.quality;
  return {
    "disable-comments": merge(dq?.["disable-comments"], cq?.["disable-comments"]),
  };
}

function mergeCode(c: Config, dc: Config): CodeConfig {
  return {
    linting: mergeLinting(c, dc),
    types: mergeTypes(c, dc),
    unused: mergeUnused(c, dc),
    coverage_run: mergeCoverageRun(c, dc),
    security: mergeSecurity(c, dc),
    naming: mergeNaming(c, dc),
    quality: mergeQuality(c, dc),
  };
}

type ProcessConfig = NonNullable<Config["process"]>;
type HooksConfig = NonNullable<ProcessConfig["hooks"]>;
type CiConfig = NonNullable<ProcessConfig["ci"]>;
type BranchesConfig = NonNullable<ProcessConfig["branches"]>;
type CommitsConfig = NonNullable<ProcessConfig["commits"]>;
type ChangesetsConfig = NonNullable<ProcessConfig["changesets"]>;
type PrConfig = NonNullable<ProcessConfig["pr"]>;
type TicketsConfig = NonNullable<ProcessConfig["tickets"]>;
type CoverageConfig = NonNullable<ProcessConfig["coverage"]>;
type RepoConfig = NonNullable<ProcessConfig["repo"]>;
type BackupsConfig = NonNullable<ProcessConfig["backups"]>;
type CodeownersConfig = NonNullable<ProcessConfig["codeowners"]>;
type DocsConfig = NonNullable<ProcessConfig["docs"]>;
type ForbiddenFilesConfig = NonNullable<ProcessConfig["forbidden_files"]>;

const defaultHooks: HooksConfig = { enabled: false, require_husky: true };
const defaultCi: CiConfig = { enabled: false };
const defaultBranches: BranchesConfig = { enabled: false, require_issue: false };
const defaultCommits: CommitsConfig = { enabled: false, require_scope: false };
const defaultChangesets: ChangesetsConfig = {
  enabled: false,
  validate_format: true,
  require_description: true,
};
const defaultPr: PrConfig = { enabled: false, require_issue: false };
const defaultTickets: TicketsConfig = {
  enabled: false,
  require_in_commits: true,
  require_in_branch: false,
};
const defaultCoverage: CoverageConfig = { enabled: false, enforce_in: "config" };
const defaultRepo: RepoConfig = {
  enabled: false,
  require_branch_protection: false,
  require_codeowners: false,
};
const defaultBackups: BackupsConfig = { enabled: false, max_age_hours: 24 };
const defaultCodeowners: CodeownersConfig = { enabled: false };
const defaultDocs: DocsConfig = {
  enabled: false,
  path: "docs/",
  enforcement: "warn",
  staleness_days: 30,
};
const defaultForbiddenFiles: ForbiddenFilesConfig = { enabled: false };

/** Merge a single process config section with defaults */
function mergeProcessSection<T>(defaultVal: T, dcVal: T | undefined, cVal: T | undefined): T {
  return { ...defaultVal, ...dcVal, ...cVal };
}

function mergeProcessHooks(
  cp: ProcessConfig | undefined,
  dcp: ProcessConfig | undefined
): HooksConfig {
  return mergeProcessSection(defaultHooks, dcp?.hooks, cp?.hooks);
}

function mergeProcessCi(cp: ProcessConfig | undefined, dcp: ProcessConfig | undefined): CiConfig {
  return mergeProcessSection(defaultCi, dcp?.ci, cp?.ci);
}

function mergeProcessBranches(
  cp: ProcessConfig | undefined,
  dcp: ProcessConfig | undefined
): BranchesConfig {
  return mergeProcessSection(defaultBranches, dcp?.branches, cp?.branches);
}

function mergeProcessCommits(
  cp: ProcessConfig | undefined,
  dcp: ProcessConfig | undefined
): CommitsConfig {
  return mergeProcessSection(defaultCommits, dcp?.commits, cp?.commits);
}

function mergeProcessChangesets(
  cp: ProcessConfig | undefined,
  dcp: ProcessConfig | undefined
): ChangesetsConfig {
  return mergeProcessSection(defaultChangesets, dcp?.changesets, cp?.changesets);
}

function mergeProcessPr(cp: ProcessConfig | undefined, dcp: ProcessConfig | undefined): PrConfig {
  return mergeProcessSection(defaultPr, dcp?.pr, cp?.pr);
}

function mergeProcessTickets(
  cp: ProcessConfig | undefined,
  dcp: ProcessConfig | undefined
): TicketsConfig {
  return mergeProcessSection(defaultTickets, dcp?.tickets, cp?.tickets);
}

function mergeProcessCoverage(
  cp: ProcessConfig | undefined,
  dcp: ProcessConfig | undefined
): CoverageConfig {
  return mergeProcessSection(defaultCoverage, dcp?.coverage, cp?.coverage);
}

function mergeProcessRepo(
  cp: ProcessConfig | undefined,
  dcp: ProcessConfig | undefined
): RepoConfig {
  return mergeProcessSection(defaultRepo, dcp?.repo, cp?.repo);
}

function mergeProcessBackups(
  cp: ProcessConfig | undefined,
  dcp: ProcessConfig | undefined
): BackupsConfig {
  return mergeProcessSection(defaultBackups, dcp?.backups, cp?.backups);
}

function mergeProcessCodeowners(
  cp: ProcessConfig | undefined,
  dcp: ProcessConfig | undefined
): CodeownersConfig {
  const cco = cp?.codeowners;
  const dco = dcp?.codeowners;
  // Merge rules arrays: registry rules + project rules (deduplicated by pattern)
  const registryRules = dco?.rules ?? [];
  const projectRules = cco?.rules ?? [];
  // Project rules can override registry rules for the same pattern
  const ruleMap = new Map<string, { pattern: string; owners: string[] }>();
  for (const rule of registryRules) {
    ruleMap.set(rule.pattern, rule);
  }
  for (const rule of projectRules) {
    ruleMap.set(rule.pattern, rule);
  }
  const mergedRules = Array.from(ruleMap.values());
  return {
    ...defaultCodeowners,
    ...dco,
    ...cco,
    rules: mergedRules.length > 0 ? mergedRules : undefined,
  };
}

function mergeProcessDocs(
  cp: ProcessConfig | undefined,
  dcp: ProcessConfig | undefined
): DocsConfig {
  return mergeProcessSection(defaultDocs, dcp?.docs, cp?.docs);
}

function mergeProcessForbiddenFiles(
  cp: ProcessConfig | undefined,
  dcp: ProcessConfig | undefined
): ForbiddenFilesConfig {
  return mergeProcessSection(defaultForbiddenFiles, dcp?.forbidden_files, cp?.forbidden_files);
}

function mergeProcess(c: Config, dc: Config): ProcessConfig {
  return {
    hooks: mergeProcessHooks(c.process, dc.process),
    ci: mergeProcessCi(c.process, dc.process),
    branches: mergeProcessBranches(c.process, dc.process),
    commits: mergeProcessCommits(c.process, dc.process),
    changesets: mergeProcessChangesets(c.process, dc.process),
    pr: mergeProcessPr(c.process, dc.process),
    tickets: mergeProcessTickets(c.process, dc.process),
    coverage: mergeProcessCoverage(c.process, dc.process),
    repo: mergeProcessRepo(c.process, dc.process),
    backups: mergeProcessBackups(c.process, dc.process),
    codeowners: mergeProcessCodeowners(c.process, dc.process),
    docs: mergeProcessDocs(c.process, dc.process),
    forbidden_files: mergeProcessForbiddenFiles(c.process, dc.process),
  };
}

type InfraConfig = NonNullable<Config["infra"]>;

function mergeInfra(c: Config, dc: Config): InfraConfig {
  return {
    enabled: c.infra?.enabled ?? dc.infra?.enabled ?? false,
    manifest: c.infra?.manifest ?? dc.infra?.manifest ?? "infra-manifest.json",
  };
}

/**
 * Deep merge config with defaults
 */
function mergeWithDefaults(config: Config): Config {
  return {
    code: mergeCode(config, defaultConfig),
    process: mergeProcess(config, defaultConfig),
    infra: mergeInfra(config, defaultConfig),
    monorepo: config.monorepo,
  };
}

/**
 * Get the project root directory (where standards.toml is located)
 */
export function getProjectRoot(configPath: string): string {
  return path.dirname(configPath);
}

/** Information about a config override */
export interface ConfigOverride {
  section: string;
  key: string;
  registryValue: string;
  projectValue: string;
}

/** Check if a project rule overrides a registry rule */
function checkRuleOverride(
  projectRule: { pattern: string; owners: string[] },
  registryOwners: string[] | undefined
): ConfigOverride | null {
  if (!registryOwners) {
    return null;
  }
  const registryStr = registryOwners.join(" ");
  const projectStr = projectRule.owners.join(" ");
  if (registryStr === projectStr) {
    return null;
  }
  return {
    section: "process.codeowners.rules",
    key: projectRule.pattern,
    registryValue: registryStr,
    projectValue: projectStr,
  };
}

/** Detect CODEOWNERS rule overrides between registry and project config */
function detectCodeownersOverrides(
  registryConfig: Config | undefined,
  projectConfig: Config | undefined
): ConfigOverride[] {
  const registryRules = registryConfig?.process?.codeowners?.rules ?? [];
  const projectRules = projectConfig?.process?.codeowners?.rules ?? [];
  const registryMap = new Map(registryRules.map((r) => [r.pattern, r.owners]));

  return projectRules
    .map((rule) => checkRuleOverride(rule, registryMap.get(rule.pattern)))
    .filter((o): o is ConfigOverride => o !== null);
}

/** Load registry config from extends */
async function loadRegistryConfig(
  extendsConfig: NonNullable<Config["extends"]>,
  configDir: string
): Promise<Config> {
  const registryModule = await import("./registry.js");
  const loc = registryModule.parseRegistryUrl(extendsConfig.registry, configDir);
  const registryDir = await registryModule.fetchRegistry(loc);

  let config: Config = {};
  for (const name of extendsConfig.rulesets) {
    config = registryModule.mergeConfigs(config, registryModule.loadRuleset(registryDir, name));
  }
  return config;
}

/**
 * Load config and detect any overrides from registry
 * Returns both the merged config and information about overrides
 */
export async function loadConfigWithOverrides(
  configPath?: string
): Promise<LoadConfigResult & { overrides: ConfigOverride[] }> {
  const resolvedPath = resolveConfigPath(configPath);
  const validatedConfig = validateConfig(parseTomlFile(resolvedPath));

  let overrides: ConfigOverride[] = [];
  if (validatedConfig.extends) {
    const registryConfig = await loadRegistryConfig(
      validatedConfig.extends,
      path.dirname(resolvedPath)
    );
    overrides = detectCodeownersOverrides(registryConfig, validatedConfig);
  }

  const { config, configPath: finalPath } = await loadConfigAsync(configPath);
  return { config, configPath: finalPath, overrides };
}
