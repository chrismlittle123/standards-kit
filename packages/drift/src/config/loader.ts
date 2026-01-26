import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";
import { z } from "zod";
import type { DriftConfig } from "../types.js";
import { FILE_PATTERNS } from "../constants.js";
import { safeJoinPath, PathTraversalError } from "../utils/paths.js";

/**
 * Zod schema for validating drift configuration
 */
const METADATA_SCHEMA_SCHEMA = z
  .object({
    tiers: z.array(z.string()).optional(),
    teams: z.array(z.string()).optional(),
  })
  .optional();

const DRIFT_CONFIG_SCHEMA = z.object({
  schema: METADATA_SCHEMA_SCHEMA,
  exclude: z.array(z.string()).optional(),
});

/**
 * Load and parse a config file, returning the validated config or null on error.
 */
function loadConfigFile(configPath: string): DriftConfig | null {
  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed: unknown = parse(content);

    const result = DRIFT_CONFIG_SCHEMA.safeParse(parsed);
    if (!result.success) {
      const errors = result.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");
      console.error(`Invalid config in ${configPath}:\n${errors}`);
      return null;
    }

    return result.data as DriftConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error parsing ${configPath}: ${message}`);
    return null;
  }
}

/**
 * Load drift configuration from the specified path.
 * Searches for config files in order: drift.config.yaml, drift.config.yml, drift.yaml.
 * Validates the config against the Zod schema to catch errors early.
 * Uses safe path joining to prevent path traversal attacks.
 */
export function loadConfig(basePath: string): DriftConfig | null {
  for (const filename of FILE_PATTERNS.config) {
    try {
      const configPath = safeJoinPath(basePath, filename);
      if (existsSync(configPath)) {
        return loadConfigFile(configPath);
      }
    } catch (error) {
      if (error instanceof PathTraversalError) {
        console.error(`Security error: ${error.message}`);
        return null;
      }
      throw error;
    }
  }
  return null;
}

/**
 * Find the config file path if it exists.
 * Searches for config files in order: drift.config.yaml, drift.config.yml, drift.yaml.
 * Uses safe path joining to prevent path traversal attacks.
 */
export function findConfigPath(basePath: string): string | null {
  for (const filename of FILE_PATTERNS.config) {
    try {
      const configPath = safeJoinPath(basePath, filename);
      if (existsSync(configPath)) {
        return configPath;
      }
    } catch (error) {
      if (error instanceof PathTraversalError) {
        console.error(`Security error: ${error.message}`);
        return null;
      }
      throw error;
    }
  }
  return null;
}
