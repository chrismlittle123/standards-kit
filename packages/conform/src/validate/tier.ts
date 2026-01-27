import * as fs from "node:fs";
import * as path from "node:path";

import TOML from "@iarna/toml";
import chalk from "chalk";

import { findConfigFile } from "../core/index.js";
import {
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

/** Metadata section from standards.toml */
interface MetadataConfig {
  tier?: Tier;
  project?: string;
  organisation?: string;
  status?: string;
}

/** Raw standards.toml structure (just what we need) */
interface RawConfig {
  metadata?: MetadataConfig;
  extends?: ExtendsConfig;
}

/** Result of getTier with detailed info */
interface GetTierResult {
  tier: Tier;
  source: "standards.toml" | "default";
  sourceDetail: TierSourceDetail;
  invalidValue?: string;
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

/**
 * Load tier from standards.toml [metadata] section
 */
function loadTierFromStandardsToml(configPath: string): GetTierResult {
  if (!fs.existsSync(configPath)) {
    return {
      tier: DEFAULT_TIER,
      source: "default",
      sourceDetail: "default (file not found)",
    };
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = TOML.parse(content) as RawConfig;

    if (!parsed.metadata) {
      return {
        tier: DEFAULT_TIER,
        source: "default",
        sourceDetail: "default (no metadata)",
      };
    }

    if (parsed.metadata.tier === undefined) {
      return {
        tier: DEFAULT_TIER,
        source: "default",
        sourceDetail: "default (tier not specified)",
      };
    }

    const tier = parsed.metadata.tier;

    // Check if tier value is valid
    if (!VALID_TIERS.includes(tier)) {
      return {
        tier: DEFAULT_TIER,
        source: "default",
        sourceDetail: "default (invalid value)",
        invalidValue: String(tier),
      };
    }

    return { tier, source: "standards.toml", sourceDetail: "standards.toml" };
  } catch {
    return {
      tier: DEFAULT_TIER,
      source: "default",
      sourceDetail: "default (file not found)",
    };
  }
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
    tierSourceDetail: "default (file not found)",
    rulesets: [],
    expectedPattern: `*-${DEFAULT_TIER}`,
    matchedRulesets: [],
    error: "No standards.toml found",
  };
}

/** Options for building the result */
interface BuildResultOptions {
  tier: Tier;
  source: "standards.toml" | "default";
  sourceDetail: TierSourceDetail;
  rulesets: string[];
  matchedRulesets: string[];
  invalidTierValue?: string;
  hasEmptyRulesets?: boolean;
  registryUrl?: string;
  warnings?: string[];
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
  } = options;
  const warnings: string[] = options.warnings ?? [];

  const expectedPattern = `*-${tier}`;
  const valid = rulesets.length === 0 || matchedRulesets.length > 0;

  // Add warning for invalid tier value
  if (invalidTierValue) {
    warnings.push(
      `Invalid tier '${invalidTierValue}' in standards.toml [metadata]. Valid values are: ${VALID_TIERS.join(", ")}`
    );
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
 *
 * Tier is loaded from standards.toml [metadata].tier
 * Defaults to "internal" if not specified
 */
export function validateTierRuleset(options: ValidateTierOptions = {}): ValidateTierResult {
  const configPath = resolveConfigPath(options);
  if (!configPath) {
    return createNotFoundResult();
  }

  const tierResult = loadTierFromStandardsToml(configPath);

  const extendsConfig = loadExtendsConfig(configPath);
  const rulesets = extendsConfig?.rulesets ?? [];
  const matchedRulesets = rulesets.length > 0 ? findMatchingRulesets(rulesets, tierResult.tier) : [];

  // Detect empty rulesets with registry configured
  const hasEmptyRulesets = extendsConfig !== null && rulesets.length === 0;
  const registryUrl = extendsConfig?.registry;

  return buildResult({
    tier: tierResult.tier,
    source: tierResult.source,
    sourceDetail: tierResult.sourceDetail,
    rulesets,
    matchedRulesets,
    invalidTierValue: tierResult.invalidValue,
    hasEmptyRulesets,
    registryUrl,
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
        `  Hint: Update standards.toml [metadata].tier to use a valid value: ${VALID_TIERS.join(", ")}`
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
