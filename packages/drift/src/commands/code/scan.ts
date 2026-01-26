import { resolve } from "path";
import { existsSync } from "fs";
import { loadConfig, findConfigPath } from "../../config/loader.js";
import { scanOrg } from "../../github/org-scanner.js";
import { version } from "../../version.js";
import { actionsOutput } from "../../utils/index.js";
import {
  hasMetadata,
  hasCheckToml,
  getRepoMetadata,
  findCheckTomlFiles,
} from "../../repo/detection.js";
import { validateCheckToml } from "../../repo/check-toml.js";

export interface ScanOptions {
  org?: string;
  repo?: string;
  path?: string;
  config?: string;
  configRepo?: string;
  githubToken?: string;
  json?: boolean;
  dryRun?: boolean;
  all?: boolean; // Skip commit window filter (scan all repos)
  since?: number; // Hours to look back for commits (default: 24)
}

/**
 * Validate that required repo files exist and are valid.
 * Returns warnings for missing or empty files.
 */
function validateRepoFiles(targetPath: string): string[] {
  const warnings: string[] = [];

  // Check for repo-metadata.yaml
  if (!hasMetadata(targetPath)) {
    warnings.push(
      "repo-metadata.yaml not found. Create this file to define tier and team."
    );
  } else {
    // Check for empty metadata (has file but no content)
    const metadataResult = getRepoMetadata(targetPath);
    if (metadataResult.metadata === null) {
      // File exists but couldn't be parsed (empty or read error)
      if (metadataResult.warnings.length > 0) {
        warnings.push(...metadataResult.warnings);
      }
    } else if (metadataResult.warnings.length > 0) {
      // File parsed but has validation warnings (e.g., empty, invalid format)
      warnings.push(...metadataResult.warnings);
    }
  }

  // Check for standards.toml
  if (!hasCheckToml(targetPath)) {
    warnings.push(
      "standards.toml not found. Create this file to configure @standards-kit/conform standards."
    );
  } else {
    // Validate standards.toml content (TOML parse check)
    const checkTomlPaths = findCheckTomlFiles(targetPath);
    for (const checkTomlPath of checkTomlPaths) {
      const validation = validateCheckToml(targetPath, checkTomlPath);
      if (!validation.valid) {
        warnings.push(`Invalid TOML in ${checkTomlPath}: ${validation.error}`);
      }
    }
  }

  return warnings;
}

/**
 * Print repo file warnings
 */
function printRepoFileWarnings(warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }

  console.log("\n⚠️  REPO CONFIGURATION WARNINGS");
  console.log("─".repeat(50));
  for (const warning of warnings) {
    console.log(`  • ${warning}`);
  }
  console.log("");
}

/**
 * Print help message when no config is found
 */
function printNoConfigHelp(targetPath: string): void {
  console.log(`Drift v${version}`);
  console.log(`Target: ${targetPath}`);
  console.log("");
  console.log(
    "No drift.config.yaml found. Create one to configure drift detection."
  );
  console.log("");
  console.log("Example drift.config.yaml:");
  console.log("  schema:");
  console.log("    tiers:");
  console.log("      - production");
  console.log("      - staging");
  console.log("      - development");
}

export async function scan(options: ScanOptions): Promise<void> {
  // GitHub org scanning mode
  if (options.org) {
    await scanOrg({
      org: options.org,
      repo: options.repo,
      configRepo: options.configRepo,
      token: options.githubToken,
      json: options.json,
      dryRun: options.dryRun,
      all: options.all,
      since: options.since,
    });
    return;
  }

  // Local scanning mode
  let targetPath: string;

  if (options.path) {
    targetPath = resolve(options.path);
  } else if (options.repo) {
    // --repo without --org is an error
    const errorMsg = "--repo requires --org to be specified";
    console.error(`Error: ${errorMsg}.`);
    console.error("Use --path to scan a local directory.");
    actionsOutput.error(errorMsg);
    process.exit(1);
    return;
  } else {
    // Default to current directory
    targetPath = process.cwd();
  }

  // Verify path exists
  if (!existsSync(targetPath)) {
    const errorMsg = `Path does not exist: ${targetPath}`;
    console.error(`Error: ${errorMsg}`);
    actionsOutput.error(errorMsg);
    process.exit(1);
    return;
  }

  // Load configuration
  const configPath = options.config
    ? resolve(options.config)
    : findConfigPath(targetPath);
  const config = configPath ? loadConfig(targetPath) : null;

  if (!config && !options.json) {
    printNoConfigHelp(targetPath);
    return;
  }

  // Validate required repo files (repo-metadata.yaml, standards.toml)
  if (!options.json) {
    const repoFileWarnings = validateRepoFiles(targetPath);
    if (repoFileWarnings.length > 0) {
      printRepoFileWarnings(repoFileWarnings);
    }
  }

  // Print scan info
  if (!options.json) {
    console.log(`Drift v${version}`);
    console.log(`Target: ${targetPath}`);
    console.log("");
    console.log("✓ Repository validated");
    actionsOutput.notice("Repository validated");
  } else {
    console.log(
      JSON.stringify({
        path: targetPath,
        timestamp: new Date().toISOString(),
      })
    );
  }
}
