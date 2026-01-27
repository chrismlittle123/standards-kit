import * as fs from "node:fs";
import * as path from "node:path";

import TOML from "@iarna/toml";

import type { Tier } from "../validate/types.js";
import type { TierSource } from "./types.js";

/** Metadata section from standards.toml */
interface TomlMetadata {
  tier?: Tier;
  project?: string;
  organisation?: string;
  status?: "active" | "pre-release" | "deprecated";
}

/** Raw standards.toml structure (just what we need) */
interface RawStandardsToml {
  metadata?: TomlMetadata;
}

/** Default tier when not specified */
const DEFAULT_TIER: Tier = "internal";

/** Valid tier values */
const VALID_TIERS: readonly Tier[] = ["production", "internal", "prototype"];

/** Result of loading tier from a project directory */
export interface TierInfo {
  /** The tier value (undefined if no metadata exists) */
  tier?: Tier;
  /** Source of the tier: "standards.toml" or null if not found */
  source: TierSource;
  /** Project name (optional, from standards.toml [metadata]) */
  project?: string;
  /** Organisation name (optional, from standards.toml [metadata]) */
  organisation?: string;
  /** Status (optional, from standards.toml [metadata]) */
  status?: "active" | "pre-release" | "deprecated";
}

/**
 * Load tier information from a project directory.
 * Reads from standards.toml [metadata] section.
 * Returns tier and source, with null source if no metadata exists.
 */
export function loadProjectTier(projectDir: string): TierInfo {
  const tomlPath = path.join(projectDir, "standards.toml");

  if (!fs.existsSync(tomlPath)) {
    return { tier: undefined, source: null };
  }

  try {
    const content = fs.readFileSync(tomlPath, "utf-8");
    const parsed = TOML.parse(content) as RawStandardsToml;

    if (!parsed.metadata?.tier) {
      return { tier: DEFAULT_TIER, source: "default" };
    }

    if (!VALID_TIERS.includes(parsed.metadata.tier)) {
      return { tier: DEFAULT_TIER, source: "default" };
    }

    return {
      tier: parsed.metadata.tier,
      source: "standards.toml",
      project: parsed.metadata.project,
      organisation: parsed.metadata.organisation,
      status: parsed.metadata.status,
    };
  } catch {
    return { tier: undefined, source: null };
  }
}
