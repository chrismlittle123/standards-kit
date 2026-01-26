/**
 * Manifest generation from Pulumi stack exports
 *
 * Parses Pulumi stack export JSON and extracts resource ARNs/identifiers
 * to generate an infra-manifest.json file.
 */

import * as fs from "node:fs";
import * as readline from "node:readline";

import { isValidArn } from "./arn.js";
import { isValidGcpResource } from "./gcp.js";
import {
  detectAccountFromResource,
  isMultiAccountManifest,
  ManifestError,
} from "./manifest.js";
import type { LegacyManifest, Manifest, ManifestAccount, MultiAccountManifest } from "./types.js";

/**
 * Pulumi stack export structure (minimal typing for what we need)
 */
interface PulumiResource {
  urn?: string;
  type?: string;
  outputs?: Record<string, unknown>;
}

interface PulumiDeployment {
  resources?: PulumiResource[];
}

interface PulumiStackExport {
  deployment?: PulumiDeployment;
}

/** Default manifest filename */
export const DEFAULT_MANIFEST_NAME = "infra-manifest.json";

/**
 * Options for manifest generation
 */
export interface GenerateManifestOptions {
  /** Project name (extracted from stack if not provided) */
  project?: string;
  /** Output file path (defaults to infra-manifest.json) */
  output?: string;
  /** If true, output to stdout instead of file */
  stdout?: boolean;
  /** Account alias (e.g., "prod-aws") for multi-account manifests */
  account?: string;
  /** Explicit account ID (e.g., "aws:111111111111") */
  accountId?: string;
  /** Merge into existing manifest instead of overwriting */
  merge?: boolean;
}

/**
 * Clean a resource identifier by stripping Pulumi internal suffixes
 *
 * Pulumi sometimes appends internal metadata to ARNs like:
 * arn:aws:secretsmanager:...:secret:name|terraform-20260123...
 *
 * The pipe and everything after it should be stripped.
 */
function cleanResourceIdentifier(value: string): string {
  const pipeIndex = value.indexOf("|");
  if (pipeIndex !== -1) {
    return value.substring(0, pipeIndex);
  }
  return value;
}

/**
 * Check if a value is a valid resource identifier (AWS ARN or GCP path)
 */
function isValidResource(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  // Clean the value before validating (strip Pulumi suffixes)
  const cleaned = cleanResourceIdentifier(value);
  return isValidArn(cleaned) || isValidGcpResource(cleaned);
}

/**
 * Extract ARNs and resource identifiers from Pulumi resource outputs
 */
function extractResourcesFromOutputs(outputs: Record<string, unknown>): string[] {
  const resources: string[] = [];

  // Common ARN/resource output field names
  const arnFields = [
    "arn",
    "id",
    "bucketArn",
    "functionArn",
    "secretArn",
    "roleArn",
    "clusterArn",
    "serviceArn",
    "tableArn",
    "topicArn",
    "queueArn",
    "logGroupArn",
    "policyArn",
    // GCP-specific
    "name",
    "selfLink",
  ];

  for (const field of arnFields) {
    const value = outputs[field];
    if (isValidResource(value)) {
      resources.push(cleanResourceIdentifier(value));
    }
  }

  // Also check for any other fields that look like ARNs or GCP resources
  for (const [key, value] of Object.entries(outputs)) {
    if (!arnFields.includes(key) && isValidResource(value)) {
      resources.push(cleanResourceIdentifier(value));
    }
  }

  return resources;
}

/**
 * Extract project name from Pulumi resource URNs
 *
 * URN format: urn:pulumi:stack::project::type::name
 */
function extractProjectName(resources: PulumiResource[]): string | undefined {
  for (const resource of resources) {
    if (resource.urn) {
      const parts = resource.urn.split("::");
      if (parts.length >= 2) {
        return parts[1]; // project is the second part
      }
    }
  }
  return undefined;
}

/**
 * Parse Pulumi stack export JSON and extract manifest
 */
export function parseStackExport(stackExport: unknown, project?: string): Manifest {
  if (!stackExport || typeof stackExport !== "object") {
    throw new Error("Invalid stack export: expected an object");
  }

  const typed = stackExport as PulumiStackExport;
  const deployment = typed.deployment;

  if (!deployment?.resources) {
    throw new Error("Invalid stack export: missing deployment.resources");
  }

  const resources: string[] = [];

  // Extract resources from each Pulumi resource's outputs
  for (const resource of deployment.resources) {
    if (resource.outputs) {
      const extracted = extractResourcesFromOutputs(resource.outputs);
      resources.push(...extracted);
    }
  }

  // Deduplicate resources
  const uniqueResources = [...new Set(resources)];

  // Determine project name
  const projectName = project ?? extractProjectName(deployment.resources) ?? "unknown";

  return {
    project: projectName,
    resources: uniqueResources,
  };
}

/**
 * Read all content from stdin
 */
async function readStdin(): Promise<string> {
  // Check if stdin is a TTY (interactive terminal)
  if (process.stdin.isTTY) {
    throw new Error("No input provided. Pipe Pulumi stack export: pulumi stack export | conform infra generate");
  }

  return new Promise((resolve, reject) => {
    let data = "";
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    rl.on("line", (line) => {
      data += `${line}\n`;
    });

    rl.on("close", () => {
      resolve(data);
    });

    rl.on("error", reject);

    // Timeout after 5 seconds if no data
    setTimeout(() => {
      if (!data) {
        rl.close();
        reject(new Error("Timeout waiting for stdin. Pipe Pulumi stack export: pulumi stack export | conform infra generate"));
      }
    }, 5000);
  });
}

/**
 * Generate manifest from stdin (Pulumi stack export)
 */
export async function generateManifestFromStdin(options: GenerateManifestOptions = {}): Promise<Manifest> {
  const content = await readStdin();

  let stackExport: unknown;
  try {
    stackExport = JSON.parse(content);
  } catch {
    throw new Error("Invalid JSON input. Expected Pulumi stack export format.");
  }

  return parseStackExport(stackExport, options.project);
}

/**
 * Generate manifest from a file
 */
export function generateManifestFromFile(filePath: string, options: GenerateManifestOptions = {}): Manifest {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");

  let stackExport: unknown;
  try {
    stackExport = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in file ${filePath}`);
  }

  return parseStackExport(stackExport, options.project);
}

/**
 * Write manifest to file or stdout
 *
 * @param manifest - The manifest to write
 * @param options - Output options (defaults to writing infra-manifest.json)
 */
export function writeManifest(manifest: Manifest, options: { output?: string; stdout?: boolean } = {}): void {
  const json = JSON.stringify(manifest, null, 2);

  if (options.stdout) {
    process.stdout.write(`${json}\n`);
  } else {
    const outputPath = options.output ?? DEFAULT_MANIFEST_NAME;
    fs.writeFileSync(outputPath, `${json}\n`, "utf-8");
  }
}

/**
 * Extract and deduplicate resources from a Pulumi deployment
 */
function extractDeploymentResources(deployment: PulumiDeployment): string[] {
  const resources: string[] = [];
  for (const resource of deployment.resources ?? []) {
    if (resource.outputs) {
      const extracted = extractResourcesFromOutputs(resource.outputs);
      resources.push(...extracted);
    }
  }
  return [...new Set(resources)];
}

/**
 * Group resources by detected account
 */
function groupResourcesByAccount(resources: string[]): Map<string, ManifestAccount> {
  const accountsMap = new Map<string, ManifestAccount>();

  for (const resource of resources) {
    const accountKey = detectAccountFromResource(resource);
    const existing = accountsMap.get(accountKey);
    if (existing) {
      existing.resources.push(resource);
    } else {
      accountsMap.set(accountKey, { resources: [resource] });
    }
  }

  return accountsMap;
}

/**
 * Convert accounts map to record, optionally applying alias
 */
function buildAccountsRecord(
  accountsMap: Map<string, ManifestAccount>,
  alias?: string
): Record<string, ManifestAccount> {
  const accounts: Record<string, ManifestAccount> = {};
  const entries = Array.from(accountsMap.entries());

  if (alias && entries.length === 1) {
    const [key, value] = entries[0];
    accounts[key] = { alias, resources: value.resources };
  } else {
    for (const [key, value] of entries) {
      accounts[key] = value;
    }
  }

  return accounts;
}

/**
 * Parse Pulumi stack export and create multi-account manifest
 * Groups resources by detected account
 */
export function parseStackExportMultiAccount(
  stackExport: unknown,
  options: GenerateManifestOptions = {}
): MultiAccountManifest {
  if (!stackExport || typeof stackExport !== "object") {
    throw new Error("Invalid stack export: expected an object");
  }

  const typed = stackExport as PulumiStackExport;
  const deployment = typed.deployment;

  if (!deployment?.resources) {
    throw new Error("Invalid stack export: missing deployment.resources");
  }

  const uniqueResources = extractDeploymentResources(deployment);
  const projectName = options.project ?? extractProjectName(deployment.resources);

  // If explicit account ID provided, use it
  if (options.accountId) {
    return {
      version: 2,
      project: projectName,
      accounts: {
        [options.accountId]: { alias: options.account, resources: uniqueResources },
      },
    };
  }

  // Group resources by auto-detected account
  const accountsMap = groupResourcesByAccount(uniqueResources);
  const accounts = buildAccountsRecord(accountsMap, options.account);

  return { version: 2, project: projectName, accounts };
}

/**
 * Read existing manifest from file
 * Returns null if file doesn't exist
 */
export function readExistingManifest(filePath: string): Manifest | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(content) as Manifest;
  } catch {
    throw new ManifestError(`Invalid JSON in existing manifest: ${filePath}`);
  }
}

/**
 * Convert legacy manifest to multi-account format
 */
function convertLegacyToMultiAccount(legacy: LegacyManifest): MultiAccountManifest {
  const legacyAccounts: Record<string, ManifestAccount> = {};
  for (const resource of legacy.resources) {
    const key = detectAccountFromResource(resource);
    if (key in legacyAccounts) {
      legacyAccounts[key].resources.push(resource);
    } else {
      legacyAccounts[key] = { resources: [resource] };
    }
  }
  return { version: 2, project: legacy.project, accounts: legacyAccounts };
}

/**
 * Merge new resources into an existing manifest
 */
export function mergeIntoManifest(
  existing: Manifest,
  newResources: string[],
  accountKey: string,
  alias?: string
): MultiAccountManifest {
  // Convert existing to multi-account if it's legacy format
  const multiAccount: MultiAccountManifest = isMultiAccountManifest(existing)
    ? { ...existing, accounts: { ...existing.accounts } }
    : convertLegacyToMultiAccount(existing);

  // Add or update the target account
  const hasExisting = accountKey in multiAccount.accounts;
  const existingResources = hasExisting ? multiAccount.accounts[accountKey].resources : [];
  const existingAlias = hasExisting ? multiAccount.accounts[accountKey].alias : undefined;
  const mergedResources = [...new Set([...existingResources, ...newResources])];

  multiAccount.accounts[accountKey] = {
    alias: alias ?? existingAlias,
    resources: mergedResources,
  };

  return multiAccount;
}

/**
 * Generate multi-account manifest from stdin (Pulumi stack export)
 */
export async function generateMultiAccountFromStdin(
  options: GenerateManifestOptions = {}
): Promise<MultiAccountManifest> {
  const content = await readStdin();

  let stackExport: unknown;
  try {
    stackExport = JSON.parse(content);
  } catch {
    throw new Error("Invalid JSON input. Expected Pulumi stack export format.");
  }

  return parseStackExportMultiAccount(stackExport, options);
}

/**
 * Generate multi-account manifest from a file
 */
export function generateMultiAccountFromFile(
  filePath: string,
  options: GenerateManifestOptions = {}
): MultiAccountManifest {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");

  let stackExport: unknown;
  try {
    stackExport = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in file ${filePath}`);
  }

  return parseStackExportMultiAccount(stackExport, options);
}

/**
 * Generate new manifest from input
 */
async function generateNewManifest(
  inputPath: string | undefined,
  options: GenerateManifestOptions
): Promise<MultiAccountManifest> {
  if (inputPath) {
    return generateMultiAccountFromFile(inputPath, options);
  }
  return generateMultiAccountFromStdin(options);
}

/**
 * Merge new manifest accounts into existing manifest
 */
function mergeManifests(
  existing: Manifest,
  newManifest: MultiAccountManifest,
  projectOverride?: string
): MultiAccountManifest {
  // Start with existing converted to multi-account
  let merged: MultiAccountManifest = isMultiAccountManifest(existing)
    ? { ...existing, accounts: { ...existing.accounts } }
    : convertLegacyToMultiAccount(existing);

  // Merge in new accounts
  for (const [key, account] of Object.entries(newManifest.accounts)) {
    merged = mergeIntoManifest(merged, account.resources, key, account.alias);
  }

  // Apply project override if provided
  if (projectOverride) {
    merged.project = projectOverride;
  }

  return merged;
}

/**
 * Handle merge operation for manifest generation
 */
export async function generateWithMerge(
  inputPath: string | undefined,
  options: GenerateManifestOptions
): Promise<Manifest> {
  const outputPath = options.output ?? DEFAULT_MANIFEST_NAME;
  const newManifest = await generateNewManifest(inputPath, options);

  // If not merging, just return the new manifest
  if (!options.merge) {
    return newManifest;
  }

  // Read existing manifest
  const existing = readExistingManifest(outputPath);
  if (!existing) {
    return newManifest;
  }

  return mergeManifests(existing, newManifest, options.project);
}
