/**
 * Types for the conform dependencies command
 */

/** Options for the dependencies command */
export interface DependenciesOptions {
  /** Path to standards.toml config file */
  config?: string;
  /** Output format */
  format: "text" | "json";
  /** Filter to specific check (e.g., "eslint") */
  check?: string;
  /** Monorepo project path filter */
  project?: string;
}

/** Result of dependency collection */
export interface DependenciesResult {
  /** Project path (relative, or "." for root) */
  project: string;
  /** Path to standards.toml */
  checkTomlPath: string;
  /** Map of tool ID to its dependency files (only existing files) */
  dependencies: Record<string, string[]>;
  /** Files that are always tracked (only existing files) */
  alwaysTracked: string[];
  /** Flattened list of all dependency files (deduplicated and sorted) */
  allFiles: string[];
}

/** Tool dependency mapping configuration */
export interface ToolDependencyMapping {
  /** Tool identifier */
  toolId: string;
  /** Config file patterns (may include globs) */
  configFiles: string[];
}
