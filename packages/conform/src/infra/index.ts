/**
 * Infra scan module - Public API
 *
 * Provides functionality to verify AWS resources declared in a manifest actually exist.
 */

import * as path from "node:path";

import chalk from "chalk";

import { getProjectRoot, loadConfigAsync } from "../core/index.js";
import { ExitCode } from "../core/index.js";

import { ManifestError, readManifest } from "./manifest.js";
import { formatScan } from "./output.js";
import { scanManifest } from "./scan.js";
import type { InfraScanResult, RunInfraScanOptions, ScanInfraOptions } from "./types.js";

// Re-export types
export type {
  AccountId,
  AccountScanResult,
  Arn,
  CloudProvider,
  GcpResourcePath,
  InfraScanResult,
  InfraScanSummary,
  LegacyManifest,
  Manifest,
  ManifestAccount,
  MultiAccountManifest,
  ParsedArn,
  ParsedGcpResource,
  PulumiResource,
  PulumiStackExport,
  ResourceCheckResult,
  ResourceIdentifier,
  ScanInfraOptions,
} from "./types.js";

// Re-export Zod schemas and validation functions for public API
export {
  // Schemas - for external consumers to validate manifests
  ArnSchema,
  AccountIdSchema,
  AccountKeySchema,
  CloudProviderSchema,
  GcpResourcePathSchema,
  InfraScanResultSchema,
  InfraScanSummarySchema,
  LegacyManifestSchema,
  ManifestAccountSchema,
  ManifestSchema,
  MultiAccountManifestSchema,
  ParsedArnSchema,
  ParsedGcpResourceSchema,
  PulumiResourceSchema,
  PulumiStackExportSchema,
  ResourceCheckResultSchema,
  ResourceIdentifierSchema,
  // Validation functions
  isValidArnFormat,
  isValidGcpResourcePath,
  isValidAccountKey,
  isMultiAccountManifestSchema,
  isLegacyManifestSchema,
  validateArn,
  validateGcpResourcePath,
  validateAccountKey,
  validateManifest,
  validateMultiAccountManifest,
  validateLegacyManifest,
  validateStackExport,
} from "./types.js";
export {
  ManifestError,
  isMultiAccountManifest,
  isLegacyManifest,
  parseAccountKey,
  formatAccountKey,
  normalizeManifest,
  detectAccountFromResource,
  getAllResources,
} from "./manifest.js";
export { parseArn, isValidArn } from "./arn.js";
export { parseGcpResource, isValidGcpResource } from "./gcp.js";
export { SUPPORTED_SERVICES, isSupportedService } from "./checkers/index.js";
export { SUPPORTED_GCP_SERVICES, isSupportedGcpService } from "./checkers/gcp/index.js";

// Re-export generate functionality
export {
  DEFAULT_MANIFEST_NAME,
  generateManifestFromStdin,
  generateManifestFromFile,
  generateMultiAccountFromStdin,
  generateMultiAccountFromFile,
  generateWithMerge,
  mergeIntoManifest,
  parseStackExport,
  parseStackExportMultiAccount,
  readExistingManifest,
  writeManifest,
  type GenerateManifestOptions,
} from "./generate.js";

/**
 * Scan infrastructure resources declared in a manifest.
 *
 * This is the programmatic API for @standards-kit/drift integration.
 *
 * @param options - Options for the scan
 * @returns Scan result with all resource check results and summary
 *
 * @example
 * ```typescript
 * import { scanInfra } from "@standards-kit/conform";
 *
 * const result = await scanInfra({ manifestPath: "./infra-manifest.json" });
 * console.log(result.summary);
 * // { total: 5, found: 4, missing: 1, errors: 0 }
 * ```
 */
export async function scanInfra(options: ScanInfraOptions = {}): Promise<InfraScanResult> {
  const resolvedManifestPath = await resolveManifestPath(options);
  const manifest = readManifest(resolvedManifestPath);
  return scanManifest(manifest, resolvedManifestPath, { account: options.account });
}

async function resolveManifestPath(options: ScanInfraOptions): Promise<string> {
  const { manifestPath, configPath } = options;

  if (manifestPath) {
    return path.isAbsolute(manifestPath)
      ? manifestPath
      : path.resolve(process.cwd(), manifestPath);
  }

  const { config, configPath: loadedConfigPath } = await loadConfigAsync(configPath);
  const projectRoot = getProjectRoot(loadedConfigPath);

  const infraConfig = config.infra;
  if (!infraConfig?.enabled) {
    throw new ManifestError("Infra scanning is not enabled in standards.toml");
  }

  const manifestName = infraConfig.manifest;
  return path.resolve(projectRoot, manifestName);
}

/**
 * Run infra scan from CLI
 */
export async function runInfraScan(options: RunInfraScanOptions = {}): Promise<void> {
  const { format = "text", manifestPath, configPath, account } = options;

  try {
    const result = await scanInfra({ manifestPath, configPath, account });
    outputResult(result, format);
  } catch (error) {
    handleError(error, format);
  }
}

function outputResult(result: InfraScanResult, format: "text" | "json"): never {
  process.stdout.write(`${formatScan(result, format)}\n`);

  if (result.summary.errors > 0) {
    process.exit(ExitCode.RUNTIME_ERROR);
  } else if (result.summary.missing > 0) {
    process.exit(ExitCode.VIOLATIONS_FOUND);
  } else {
    process.exit(ExitCode.SUCCESS);
  }
}

function handleError(error: unknown, format: "text" | "json"): never {
  const message = error instanceof Error ? error.message : "Unknown error";
  const isConfigError = error instanceof ManifestError;

  if (format === "json") {
    process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  } else {
    console.error(chalk.red(`Error: ${message}`));
  }

  process.exit(isConfigError ? ExitCode.CONFIG_ERROR : ExitCode.RUNTIME_ERROR);
}

/**
 * Options for CLI generate command
 */
export interface RunInfraGenerateOptions {
  /** Input file path (if not provided, reads from stdin) */
  input?: string;
  /** Output file path (defaults to infra-manifest.json) */
  output?: string;
  /** Project name override */
  project?: string;
  /** Output to stdout instead of file */
  stdout?: boolean;
  /** Account alias (e.g., "prod-aws") for multi-account manifests */
  account?: string;
  /** Explicit account ID (e.g., "aws:111111111111") */
  accountId?: string;
  /** Merge into existing manifest instead of overwriting */
  merge?: boolean;
}

/**
 * Run infra generate from CLI
 */
export async function runInfraGenerate(options: RunInfraGenerateOptions = {}): Promise<void> {
  const {
    generateWithMerge,
    writeManifest,
    DEFAULT_MANIFEST_NAME,
  } = await import("./generate.js");
  const { getAllResources, isMultiAccountManifest } = await import("./manifest.js");

  try {
    const manifest = await generateWithMerge(options.input, {
      project: options.project,
      output: options.output,
      account: options.account,
      accountId: options.accountId,
      merge: options.merge,
    });

    writeManifest(manifest, { output: options.output, stdout: options.stdout });

    if (!options.stdout) {
      const outputPath = options.output ?? DEFAULT_MANIFEST_NAME;
      const resourceCount = getAllResources(manifest).length;
      const accountCount = isMultiAccountManifest(manifest)
        ? Object.keys(manifest.accounts).length
        : 1;
      const accountLabel = accountCount === 1 ? "account" : "accounts";

      console.error(
        chalk.green(`✓ Generated ${outputPath} with ${resourceCount} resources across ${accountCount} ${accountLabel}`)
      );
    }

    process.exit(ExitCode.SUCCESS);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red(`Error: ${message}`));
    process.exit(ExitCode.RUNTIME_ERROR);
  }
}
