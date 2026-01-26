/**
 * Valid project tiers
 */
export type Tier = "production" | "internal" | "prototype";

/**
 * Valid tier values as a constant array for validation and export
 */
export const VALID_TIERS: readonly Tier[] = ["production", "internal", "prototype"];

/**
 * Parsed repo-metadata.yaml structure
 */
export interface RepoMetadata {
  tier?: Tier;
}

/**
 * Detailed tier source indicating why a default was used
 */
export type TierSourceDetail =
  | "repo-metadata.yaml" // Tier was read from file
  | "default" // Generic default (for backwards compatibility)
  | "default (file not found)" // File doesn't exist
  | "default (file empty)" // File exists but is empty
  | "default (parse error)" // File exists but YAML is invalid
  | "default (tier not specified)" // File valid but no tier key
  | "default (invalid value)"; // File has tier but value is invalid

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
  /** Project tier from repo-metadata.yaml (defaults to "internal") */
  tier: Tier;
  /** Source of tier value */
  tierSource: "repo-metadata.yaml" | "default";
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
