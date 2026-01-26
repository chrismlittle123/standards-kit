import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import TOML from "@iarna/toml";
import chalk from "chalk";
import * as yaml from "js-yaml";

import { findConfigFile, getProjectRoot } from "../core/index.js";
import {
  type RepoMetadata,
  type Tier,
  type TierSourceDetail,
  VALID_TIERS,
  type ValidateTierOptions,
  type ValidateTierResult,
} from "./types.js";

/** Default tier when not specified */
const DEFAULT_TIER: Tier = "internal";

/** Extends section from standards.toml */
interface ExtendsConfig {
  registry?: string;
  rulesets?: string[];
}

/** Raw standards.toml structure (just what we need) */
interface RawConfig {
  extends?: ExtendsConfig;
}

/** Result of loading repo-metadata.yaml with detailed source info */
interface LoadMetadataResult {
  metadata: RepoMetadata | null;
  sourceDetail: TierSourceDetail;
  parseError?: string;
}

/**
 * Find the git repository root directory
 */
function findGitRoot(startDir: string): string | null {
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return gitRoot;
  } catch {
    return null;
  }
}

/**
 * Read file content, returns null if file doesn't exist or can't be read
 */
function readFileContent(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Parse YAML content into RepoMetadata
 */
function parseYamlContent(content: string): LoadMetadataResult {
  try {
    const parsed: unknown = yaml.load(content);
    // yaml.load returns undefined for empty content, null for "null"
    if (parsed === undefined || parsed === null) {
      return { metadata: null, sourceDetail: "default (file empty)" };
    }
    return { metadata: parsed as RepoMetadata, sourceDetail: "repo-metadata.yaml" };
  } catch (error) {
    const parseError = error instanceof Error ? error.message : String(error);
    return { metadata: null, sourceDetail: "default (parse error)", parseError };
  }
}

/**
 * Load and parse repo-metadata.yaml with detailed error tracking
 */
function loadRepoMetadata(projectRoot: string): LoadMetadataResult {
  const metadataPath = path.join(projectRoot, "repo-metadata.yaml");
  const content = readFileContent(metadataPath);

  if (content === null) {
    return { metadata: null, sourceDetail: "default (file not found)" };
  }
  if (!content.trim()) {
    return { metadata: null, sourceDetail: "default (file empty)" };
  }

  return parseYamlContent(content);
}

/**
 * Load and parse standards.toml to get extends section
 */
function loadExtendsConfig(configPath: string): ExtendsConfig | null {
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = TOML.parse(content) as RawConfig;
    return parsed.extends ?? null;
  } catch {
    return null;
  }
}

/** Result of getTier with detailed info */
interface GetTierResult {
  tier: Tier;
  source: "repo-metadata.yaml" | "default";
  sourceDetail: TierSourceDetail;
  invalidValue?: string;
}

/**
 * Get tier from repo-metadata.yaml with validation
 */
function getTier(metadataResult: LoadMetadataResult): GetTierResult {
  const { metadata, sourceDetail } = metadataResult;

  // If metadata loading failed, return with the detailed reason
  if (!metadata) {
    return { tier: DEFAULT_TIER, source: "default", sourceDetail };
  }

  // Metadata exists but tier key is missing
  if (metadata.tier === undefined) {
    return { tier: DEFAULT_TIER, source: "default", sourceDetail: "default (tier not specified)" };
  }

  const tier = metadata.tier;

  // Check if tier value is valid
  if (!VALID_TIERS.includes(tier)) {
    return {
      tier: DEFAULT_TIER,
      source: "default",
      sourceDetail: "default (invalid value)",
      invalidValue: String(tier),
    };
  }

  return { tier, source: "repo-metadata.yaml", sourceDetail: "repo-metadata.yaml" };
}

/**
 * Check if rulesets include a tier-matching ruleset
 */
function findMatchingRulesets(rulesets: string[], tier: Tier): string[] {
  const suffix = `-${tier}`;
  return rulesets.filter((ruleset) => ruleset.endsWith(suffix));
}

/**
 * Resolve the config path from options
 */
function resolveConfigPath(options: ValidateTierOptions): string | null {
  if (options.config) {
    const absolutePath = path.resolve(options.config);
    return fs.existsSync(absolutePath) ? absolutePath : null;
  }
  return findConfigFile();
}

/**
 * Create result for missing config
 */
function createNotFoundResult(): ValidateTierResult {
  return {
    valid: false,
    tier: DEFAULT_TIER,
    tierSource: "default",
    rulesets: [],
    expectedPattern: `*-${DEFAULT_TIER}`,
    matchedRulesets: [],
    error: "No standards.toml found",
  };
}

/** Options for building the result */
interface BuildResultOptions {
  tier: Tier;
  source: "repo-metadata.yaml" | "default";
  sourceDetail: TierSourceDetail;
  rulesets: string[];
  matchedRulesets: string[];
  invalidTierValue?: string;
  hasEmptyRulesets?: boolean;
  registryUrl?: string;
  warnings?: string[];
  parseError?: string;
}

/**
 * Build the validation result
 */
function buildResult(options: BuildResultOptions): ValidateTierResult {
  const {
    tier,
    source,
    sourceDetail,
    rulesets,
    matchedRulesets,
    invalidTierValue,
    hasEmptyRulesets,
    registryUrl,
    parseError,
  } = options;
  const warnings: string[] = options.warnings ?? [];

  const expectedPattern = `*-${tier}`;
  const valid = rulesets.length === 0 || matchedRulesets.length > 0;

  // Add warning for invalid tier value
  if (invalidTierValue) {
    warnings.push(
      `Invalid tier '${invalidTierValue}' in repo-metadata.yaml. Valid values are: ${VALID_TIERS.join(", ")}`
    );
  }

  // Add warning for parse error
  if (parseError) {
    warnings.push(`Failed to parse repo-metadata.yaml: ${parseError}`);
  }

  // Add warning for empty rulesets with registry configured
  if (hasEmptyRulesets && registryUrl) {
    warnings.push(
      `[extends] is configured with registry '${registryUrl}' but rulesets is empty - no standards will be inherited`
    );
  }

  return {
    valid,
    tier,
    tierSource: source,
    tierSourceDetail: sourceDetail,
    rulesets,
    expectedPattern,
    matchedRulesets,
    error: valid
      ? undefined
      : `No ruleset matching pattern '${expectedPattern}' found. Rulesets: [${rulesets.join(", ")}]`,
    invalidTierValue,
    hasEmptyRulesets,
    registryUrl,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Validate that project tier matches its rulesets.
 * This is the programmatic API exported for library consumers.
 */
export function validateTierRuleset(options: ValidateTierOptions = {}): ValidateTierResult {
  const configPath = resolveConfigPath(options);
  if (!configPath) {
    return createNotFoundResult();
  }

  // Try to find repo-metadata.yaml from git root first, fall back to config directory
  const configDir = getProjectRoot(configPath);
  const gitRoot = findGitRoot(configDir);
  const metadataSearchPath = gitRoot ?? configDir;

  const metadataResult = loadRepoMetadata(metadataSearchPath);
  const { tier, source, sourceDetail, invalidValue } = getTier(metadataResult);

  const extendsConfig = loadExtendsConfig(configPath);
  const rulesets = extendsConfig?.rulesets ?? [];
  const matchedRulesets = rulesets.length > 0 ? findMatchingRulesets(rulesets, tier) : [];

  // Detect empty rulesets with registry configured
  const hasEmptyRulesets = extendsConfig !== null && rulesets.length === 0;
  const registryUrl = extendsConfig?.registry;

  return buildResult({
    tier,
    source,
    sourceDetail,
    rulesets,
    matchedRulesets,
    invalidTierValue: invalidValue,
    hasEmptyRulesets,
    registryUrl,
    parseError: metadataResult.parseError,
  });
}

/** Format warnings section */
function formatWarnings(warnings: string[] | undefined): string[] {
  if (!warnings || warnings.length === 0) {
    return [];
  }
  const lines = warnings.map((w) => chalk.yellow(`⚠ Warning: ${w}`));
  lines.push(""); // Empty line after warnings
  return lines;
}

/** Format the rulesets message based on configuration */
function formatRulesetsMessage(result: ValidateTierResult): string {
  if (result.matchedRulesets.length > 0) {
    return `  Matching rulesets: ${result.matchedRulesets.join(", ")}`;
  }
  if (result.hasEmptyRulesets) {
    return "  No rulesets specified (no tier constraint)";
  }
  return "  No extends configured (no tier constraint)";
}

/** Format the failed validation section */
function formatFailedValidation(result: ValidateTierResult, sourceDisplay: string): string[] {
  const lines = [
    chalk.red("✗ Tier validation failed"),
    `  Tier: ${result.tier} (source: ${sourceDisplay})`,
    `  Expected pattern: ${result.expectedPattern}`,
    `  Rulesets: [${result.rulesets.join(", ")}]`,
  ];
  if (result.error) {
    lines.push(chalk.red(`  Error: ${result.error}`));
  }
  if (result.invalidTierValue) {
    lines.push("");
    lines.push(
      chalk.cyan(
        `  Hint: Update repo-metadata.yaml to use a valid tier value: ${VALID_TIERS.join(", ")}`
      )
    );
  }
  return lines;
}

/**
 * Format tier validation result as text
 */
export function formatTierResultText(result: ValidateTierResult): string {
  const lines: string[] = formatWarnings(result.warnings);
  const sourceDisplay = result.tierSourceDetail ?? result.tierSource;

  if (result.valid) {
    lines.push(chalk.green("✓ Tier validation passed"));
    lines.push(`  Tier: ${result.tier} (source: ${sourceDisplay})`);
    lines.push(formatRulesetsMessage(result));
  } else {
    lines.push(...formatFailedValidation(result, sourceDisplay));
  }

  return lines.join("\n");
}

/**
 * Format tier validation result as JSON
 */
export function formatTierResultJson(result: ValidateTierResult): string {
  return JSON.stringify(result, null, 2);
}
