/**
 * Core implementation of the conform dependencies command
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { globSync } from "glob";

import { type Config, getProjectRoot, loadConfigAsync } from "../core/index.js";
import { ALWAYS_TRACKED, BUILTIN_MAPPINGS } from "./mappings.js";
import { formatDependenciesJson, formatDependenciesText } from "./output.js";
import type { DependenciesOptions, DependenciesResult } from "./types.js";

// Re-export types for library consumers
export type { DependenciesOptions, DependenciesResult } from "./types.js";

/**
 * Tool configuration with optional dependencies field
 */
interface ToolConfig {
  enabled?: boolean;
  dependencies?: string[];
}

/** Map of tool IDs to config accessor functions */
const TOOL_CONFIG_ACCESSORS: Record<string, (c: Config) => ToolConfig | undefined> = {
  eslint: (c) => c.code?.linting?.eslint,
  ruff: (c) => c.code?.linting?.ruff,
  tsc: (c) => c.code?.types?.tsc,
  ty: (c) => c.code?.types?.ty,
  knip: (c) => c.code?.unused?.knip,
  vulture: (c) => c.code?.unused?.vulture,
  secrets: (c) => c.code?.security?.secrets,
  pnpmaudit: (c) => c.code?.security?.pnpmaudit,
  pipaudit: (c) => c.code?.security?.pipaudit,
};

/** Coverage runner tool IDs */
const COVERAGE_RUNNERS = ["vitest", "jest", "pytest"];

/**
 * Get tool configuration from standards.toml config by tool ID
 */
function getToolConfig(config: Config, toolId: string): ToolConfig | undefined {
  // Handle coverage runners specially
  if (COVERAGE_RUNNERS.includes(toolId)) {
    const coverageConfig = config.code?.coverage_run;
    if (!coverageConfig?.enabled) {
      return undefined;
    }
    const runner = coverageConfig.runner;
    if (runner === "auto" || runner === toolId) {
      return coverageConfig;
    }
    return undefined;
  }
  // Use lookup table for other tools
  if (!(toolId in TOOL_CONFIG_ACCESSORS)) {
    return undefined;
  }
  return TOOL_CONFIG_ACCESSORS[toolId](config);
}

/**
 * Check if a pattern contains glob characters
 */
function isGlobPattern(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

/**
 * Expand glob patterns and filter to only existing files
 */
function expandAndFilter(patterns: string[], projectRoot: string): string[] {
  const results: string[] = [];

  for (const pattern of patterns) {
    if (isGlobPattern(pattern)) {
      const matches = globSync(pattern, { cwd: projectRoot, nodir: true, dot: true });
      results.push(...matches);
    } else {
      const fullPath = path.join(projectRoot, pattern);
      if (fs.existsSync(fullPath)) {
        results.push(pattern);
      }
    }
  }

  return [...new Set(results)].sort();
}

/**
 * Collect dependencies for a single tool
 */
function collectToolDependencies(
  toolId: string,
  config: Config,
  projectRoot: string
): string[] | null {
  const toolConfig = getToolConfig(config, toolId);
  if (!toolConfig?.enabled) {
    return null;
  }

  const mapping = BUILTIN_MAPPINGS[toolId];
  const builtinFiles = expandAndFilter(mapping.configFiles, projectRoot);
  const customFiles = toolConfig.dependencies
    ? expandAndFilter(toolConfig.dependencies, projectRoot)
    : [];

  const allFiles = [...new Set([...builtinFiles, ...customFiles])].sort();
  return allFiles.length > 0 ? allFiles : null;
}

/**
 * Get all dependencies for a project
 */
export async function getDependencies(
  options: Partial<DependenciesOptions> = {}
): Promise<DependenciesResult> {
  const { config, configPath } = await loadConfigAsync(options.config);
  const projectRoot = options.project
    ? path.resolve(process.cwd(), options.project)
    : getProjectRoot(configPath);

  const dependencies: Record<string, string[]> = {};

  for (const toolId of Object.keys(BUILTIN_MAPPINGS)) {
    if (options.check && options.check !== toolId) {
      continue;
    }
    const files = collectToolDependencies(toolId, config, projectRoot);
    if (files) {
      dependencies[toolId] = files;
    }
  }

  const alwaysTracked = expandAndFilter(ALWAYS_TRACKED, projectRoot);
  const allFiles = [...new Set([...Object.values(dependencies).flat(), ...alwaysTracked])].sort();

  return {
    project: options.project ?? ".",
    checkTomlPath: path.relative(projectRoot, configPath) || "standards.toml",
    dependencies,
    alwaysTracked,
    allFiles,
  };
}

/**
 * Run the dependencies command (CLI entry point)
 */
export async function runDependencies(options: DependenciesOptions): Promise<void> {
  const result = await getDependencies(options);
  const output =
    options.format === "json" ? formatDependenciesJson(result) : formatDependenciesText(result);
  process.stdout.write(`${output}\n`);
}
