/**
 * Valid project tiers
 */
export type Tier = "production" | "internal" | "prototype";

/**
 * Valid tier values as a constant array for validation and export
 */
export const VALID_TIERS: readonly Tier[] = ["production", "internal", "prototype"];

/**
 * Detailed tier source indicating why a default was used
 */
export type TierSourceDetail =
  | "standards.toml" // Tier was read from [metadata] section
  | "default" // Generic default (for backwards compatibility)
  | "default (file not found)" // standards.toml doesn't exist
  | "default (no metadata)" // standards.toml exists but no [metadata] section
  | "default (tier not specified)" // [metadata] exists but no tier key
  | "default (invalid value)"; // [metadata] has tier but value is invalid

/**
 * Options for the tier validation command
 */
export interface ValidateTierOptions {
  /** Path to standards.toml config file */
  config?: string;
  /** Output format */
  format?: "text" | "json";
}

/**
 * Result of tier validation
 */
export interface ValidateTierResult {
  /** Whether validation passed */
  valid: boolean;
  /** Project tier from standards.toml [metadata] (defaults to "internal") */
  tier: Tier;
  /** Source of tier value */
  tierSource: "standards.toml" | "default";
  /** Detailed source of tier value with reason for default */
  tierSourceDetail?: TierSourceDetail;
  /** Rulesets from standards.toml extends section */
  rulesets: string[];
  /** Expected ruleset suffix pattern */
  expectedPattern: string;
  /** Matched rulesets (those that satisfy the tier requirement) */
  matchedRulesets: string[];
  /** Error message if invalid */
  error?: string;
  /** Invalid tier value that was rejected (for error messages) */
  invalidTierValue?: string;
  /** Whether extends is configured but has empty rulesets */
  hasEmptyRulesets?: boolean;
  /** Registry URL if extends is configured */
  registryUrl?: string;
  /** Warnings about configuration */
  warnings?: string[];
}
