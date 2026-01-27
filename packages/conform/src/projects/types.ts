import type { Tier } from "../validate/types.js";

/** Re-export Tier for convenience */
export type { Tier } from "../validate/types.js";

/** Project types detected by marker files */
export type ProjectType = "typescript" | "python";

/** Source of tier value */
export type TierSource = "standards.toml" | "default" | null;

/** Project marker file configuration */
export interface ProjectMarker {
  file: string;
  type: ProjectType;
  /** Optional function to check if this marker indicates a workspace root */
  isWorkspaceRoot?: (content: string) => boolean;
}

/** A detected project in the monorepo */
export interface DetectedProject {
  /** Relative path from search root */
  path: string;
  /** Detected project type */
  type: ProjectType;
  /** Whether standards.toml exists in this project */
  hasCheckToml: boolean;
  /** Which marker file triggered detection */
  markerFile: string;
}

/** A project enriched with tier information */
export interface EnrichedProject extends DetectedProject {
  /** Tier from standards.toml [metadata] (undefined if not found) */
  tier?: Tier;
  /** Source of tier value: standards.toml, default, or null if not found */
  tierSource?: TierSource;
}

/** Result of project detection */
export interface DetectionResult {
  /** All detected projects */
  projects: DetectedProject[];
  /** Paths that were identified as workspace roots (skipped) */
  workspaceRoots: string[];
}

/** Options for the detect command */
export interface DetectOptions {
  /** Create missing standards.toml files */
  fix?: boolean;
  /** Show what would be created without creating */
  dryRun?: boolean;
  /** Create shared registry and extend from it */
  registry?: string;
  /** Output format */
  format: "text" | "json";
  /** Show tier/status from standards.toml [metadata] */
  showStatus?: boolean;
  /** Filter to projects without standards.toml */
  missingConfig?: boolean;
}

/** JSON output structure */
export interface DetectJsonOutput {
  projects: {
    path: string;
    type: string;
    status: "has-config" | "missing-config";
    /** Tier from repo-metadata.yaml (only when --show-status) */
    tier?: Tier | null;
    /** Source of tier value (only when --show-status) */
    tierSource?: TierSource;
  }[];
  workspaceRoots: string[];
  summary: {
    total: number;
    withConfig: number;
    missingConfig: number;
  };
  actions?: {
    action: "created" | "would-create";
    path: string;
  }[];
}
