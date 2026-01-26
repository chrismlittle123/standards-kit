import * as fs from "node:fs";
import * as path from "node:path";

import * as yaml from "js-yaml";

import type { Tier } from "../validate/types.js";
import type { TierSource } from "./types.js";

/** Parsed repo-metadata.yaml structure */
interface RepoMetadata {
  tier?: Tier;
}

/** Default tier when not specified */
const DEFAULT_TIER: Tier = "internal";

/** Valid tier values */
const VALID_TIERS: readonly Tier[] = ["production", "internal", "prototype"];

/** Result of loading tier from a project directory */
export interface TierInfo {
  /** The tier value (undefined if no repo-metadata.yaml exists) */
  tier?: Tier;
  /** Source of the tier: "repo-metadata.yaml", "default", or null if no file */
  source: TierSource;
}

/**
 * Load tier information from a project directory.
 * Returns tier and source, with null source if no repo-metadata.yaml exists.
 */
export function loadProjectTier(projectDir: string): TierInfo {
  const metadataPath = path.join(projectDir, "repo-metadata.yaml");

  if (!fs.existsSync(metadataPath)) {
    return { tier: undefined, source: null };
  }

  try {
    const content = fs.readFileSync(metadataPath, "utf-8");
    const metadata = yaml.load(content) as RepoMetadata | null;

    if (!metadata?.tier) {
      return { tier: DEFAULT_TIER, source: "default" };
    }

    if (!VALID_TIERS.includes(metadata.tier)) {
      return { tier: DEFAULT_TIER, source: "default" };
    }

    return { tier: metadata.tier, source: "repo-metadata.yaml" };
  } catch {
    return { tier: undefined, source: null };
  }
}
