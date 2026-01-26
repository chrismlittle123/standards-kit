/**
 * Manifest reader for infra scan
 *
 * Supports two formats:
 * 1. JSON: { "project": "...", "resources": ["arn:...", "projects/..."] }
 * 2. TXT: One resource per line, # for comments
 *
 * Resources can be:
 * - AWS ARNs: arn:aws:s3:::bucket-name
 * - GCP paths: projects/{project}/locations/{location}/services/{service}
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { isValidArn } from "./arn.js";
import { isValidGcpResource } from "./gcp.js";
import {
  isValidAccountKey,
  isLegacyManifestSchema,
  isMultiAccountManifestSchema,
  validateLegacyManifest,
  validateMultiAccountManifest,
  type AccountId,
  type LegacyManifest,
  type Manifest,
  type ManifestAccount,
  type MultiAccountManifest,
} from "./types.js";

/**
 * Check if a resource identifier is valid (AWS ARN or GCP path)
 */
function isValidResource(resource: string): boolean {
  return isValidArn(resource) || isValidGcpResource(resource);
}

/**
 * Error thrown when manifest parsing fails
 */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/**
 * Type guard: check if manifest is multi-account format (v2)
 */
export function isMultiAccountManifest(manifest: Manifest): manifest is MultiAccountManifest {
  return "accounts" in manifest && typeof manifest.accounts === "object";
}

/**
 * Type guard: check if manifest is legacy format (v1)
 */
export function isLegacyManifest(manifest: Manifest): manifest is LegacyManifest {
  return "resources" in manifest && Array.isArray(manifest.resources);
}

/**
 * Parse an account key (e.g., "aws:111111111111" or "gcp:my-project")
 *
 * @param key - The account key in format "cloud:id"
 * @returns Parsed AccountId or null if invalid
 */
export function parseAccountKey(key: string): AccountId | null {
  // Use schema validation first
  if (!isValidAccountKey(key)) {
    return null;
  }

  // Extract components (we know the format is valid from schema check)
  const colonIndex = key.indexOf(":");
  return {
    cloud: key.substring(0, colonIndex) as "aws" | "gcp",
    id: key.substring(colonIndex + 1),
  };
}

/**
 * Format an account key from cloud and id
 */
export function formatAccountKey(cloud: "aws" | "gcp", id: string): string {
  return `${cloud}:${id}`;
}

/**
 * Normalize a legacy manifest to multi-account format
 * This converts v1 manifests to v2 format for unified processing
 */
export function normalizeManifest(manifest: Manifest): MultiAccountManifest {
  if (isMultiAccountManifest(manifest)) {
    return manifest;
  }

  // Group resources by detected account
  const accounts: Record<string, ManifestAccount> = {};

  for (const resource of manifest.resources) {
    const accountKey = detectAccountFromResource(resource);
    if (accountKey in accounts) {
      accounts[accountKey].resources.push(resource);
    } else {
      accounts[accountKey] = { resources: [resource] };
    }
  }

  return {
    version: 2,
    project: manifest.project,
    accounts,
  };
}

/**
 * Detect the account key from a resource identifier
 * Extracts AWS account ID from ARN or GCP project from resource path
 */
export function detectAccountFromResource(resource: string): string {
  // Check for AWS ARN: arn:partition:service:region:account:resource
  if (resource.startsWith("arn:")) {
    const parts = resource.split(":");
    if (parts.length >= 5) {
      const accountId = parts[4];
      // Some AWS resources (like S3 buckets) don't have account ID in the ARN
      if (accountId) {
        return formatAccountKey("aws", accountId);
      }
      // For S3 buckets without account ID, use a placeholder
      return "aws:unknown";
    }
  }

  // Check for GCP resource path: projects/{project}/...
  const gcpRegex = /^projects\/([^/]+)\//;
  const gcpMatch = gcpRegex.exec(resource);
  if (gcpMatch) {
    return formatAccountKey("gcp", gcpMatch[1]);
  }

  return "unknown:unknown";
}

/**
 * Get all resources from a manifest (flattened for v2 manifests)
 */
export function getAllResources(manifest: Manifest): string[] {
  if (isMultiAccountManifest(manifest)) {
    return Object.values(manifest.accounts).flatMap((account) => account.resources);
  }
  return manifest.resources;
}

/**
 * Read and parse a manifest file
 *
 * @param manifestPath - Path to the manifest file
 * @returns Parsed manifest with project name and resource ARNs
 */
export function readManifest(manifestPath: string): Manifest {
  if (!fs.existsSync(manifestPath)) {
    throw new ManifestError(`Manifest file not found: ${manifestPath}`);
  }

  const content = fs.readFileSync(manifestPath, "utf-8");
  const ext = path.extname(manifestPath).toLowerCase();

  if (ext === ".json") {
    return parseJsonManifest(content, manifestPath);
  }

  if (ext === ".txt") {
    return parseTxtManifest(content, manifestPath);
  }

  // Try JSON first, then TXT
  try {
    return parseJsonManifest(content, manifestPath);
  } catch {
    return parseTxtManifest(content, manifestPath);
  }
}

/**
 * Parse a JSON format manifest using Zod schema validation
 */
function parseJsonManifest(content: string, manifestPath: string): Manifest {
  const data = parseJsonContent(content, manifestPath);

  // First validate basic structure
  if (!data || typeof data !== "object") {
    throw new ManifestError(`Manifest ${manifestPath} must be a JSON object`);
  }

  // Try multi-account (v2) format first using Zod schema
  if (isMultiAccountManifestSchema(data)) {
    return validateMultiAccountManifestWithResources(data, manifestPath);
  }

  // Try legacy (v1) format using Zod schema
  if (isLegacyManifestSchema(data)) {
    return validateLegacyManifestWithResources(data, manifestPath);
  }

  // Fallback to manual validation for better error messages
  return parseFallbackManifest(data as Record<string, unknown>, manifestPath);
}

/**
 * Fallback parser for manifests that don't match Zod schemas
 */
function parseFallbackManifest(obj: Record<string, unknown>, manifestPath: string): Manifest {
  if ("accounts" in obj) {
    return parseMultiAccountManifestFallback(obj, manifestPath);
  }

  validateJsonStructure(obj, manifestPath);
  const resources = extractAndValidateResources(obj.resources as unknown[], manifestPath);
  const project = typeof obj.project === "string" ? obj.project : undefined;

  return { project, resources };
}

/**
 * Validate multi-account manifest and its resources
 */
function validateMultiAccountManifestWithResources(
  data: unknown,
  manifestPath: string
): MultiAccountManifest {
  try {
    const manifest = validateMultiAccountManifest(data);

    // Validate account keys and resources
    for (const [accountKey, account] of Object.entries(manifest.accounts)) {
      // Validate account key format (must be "aws:xxx" or "gcp:xxx")
      if (!isValidAccountKey(accountKey)) {
        throw new ManifestError(
          `Manifest ${manifestPath} has invalid account key: "${accountKey}". Expected format: "aws:<account-id>" or "gcp:<project-id>"`
        );
      }

      // Validate each resource is a valid ARN or GCP path
      const invalidResources = account.resources.filter((r) => !isValidResource(r));
      if (invalidResources.length > 0) {
        throw new ManifestError(
          `Manifest ${manifestPath} account "${accountKey}" contains invalid resources: ${invalidResources.join(", ")}`
        );
      }
    }

    return manifest;
  } catch (error) {
    if (error instanceof ManifestError) {
      throw error;
    }
    // Convert Zod errors to ManifestError
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new ManifestError(`Invalid manifest ${manifestPath}: ${message}`);
  }
}

/**
 * Validate legacy manifest and its resources
 */
function validateLegacyManifestWithResources(
  data: unknown,
  manifestPath: string
): LegacyManifest {
  try {
    const manifest = validateLegacyManifest(data);

    // Additionally validate each resource is a valid ARN or GCP path
    const invalidResources = manifest.resources.filter((r) => !isValidResource(r));
    if (invalidResources.length > 0) {
      throw new ManifestError(
        `Manifest ${manifestPath} contains invalid resources: ${invalidResources.join(", ")}`
      );
    }

    return manifest;
  } catch (error) {
    if (error instanceof ManifestError) {
      throw error;
    }
    // Convert Zod errors to ManifestError
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new ManifestError(`Invalid manifest ${manifestPath}: ${message}`);
  }
}

/**
 * Fallback parser for multi-account manifest with detailed error messages
 */
function parseMultiAccountManifestFallback(
  obj: Record<string, unknown>,
  manifestPath: string
): MultiAccountManifest {
  const accountsRaw = obj.accounts as Record<string, unknown>;
  const accounts: Record<string, ManifestAccount> = {};

  for (const [key, value] of Object.entries(accountsRaw)) {
    accounts[key] = parseAccountEntry(key, value, manifestPath);
  }

  const project = typeof obj.project === "string" ? obj.project : undefined;

  return { version: 2, project, accounts };
}

/**
 * Validate and parse a single account entry from manifest
 */
function parseAccountEntry(
  key: string,
  value: unknown,
  manifestPath: string
): ManifestAccount {
  const parsedKey = parseAccountKey(key);
  if (!parsedKey) {
    throw new ManifestError(
      `Manifest ${manifestPath} has invalid account key: "${key}". Expected format: "aws:<account-id>" or "gcp:<project-id>"`
    );
  }

  if (!value || typeof value !== "object") {
    throw new ManifestError(`Manifest ${manifestPath} account "${key}" must be an object`);
  }

  const accountObj = value as Record<string, unknown>;
  if (!Array.isArray(accountObj.resources)) {
    throw new ManifestError(`Manifest ${manifestPath} account "${key}" must have a "resources" array`);
  }

  const resources = extractAndValidateResources(accountObj.resources, manifestPath);
  const alias = typeof accountObj.alias === "string" ? accountObj.alias : undefined;

  return { alias, resources };
}

function parseJsonContent(content: string, manifestPath: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new ManifestError(`Invalid JSON in manifest ${manifestPath}: ${message}`);
  }
}

function validateJsonStructure(data: unknown, manifestPath: string): void {
  if (!data || typeof data !== "object") {
    throw new ManifestError(`Manifest ${manifestPath} must be a JSON object`);
  }

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.resources)) {
    throw new ManifestError(`Manifest ${manifestPath} must have a "resources" array`);
  }
}

function extractAndValidateResources(items: unknown[], manifestPath: string): string[] {
  const resources: string[] = [];
  const invalidResources: string[] = [];

  for (const item of items) {
    if (typeof item !== "string") {
      throw new ManifestError(
        `Manifest ${manifestPath} contains non-string resource: ${JSON.stringify(item)}`
      );
    }
    if (!isValidResource(item)) {
      invalidResources.push(item);
    } else {
      resources.push(item);
    }
  }

  if (invalidResources.length > 0) {
    throw new ManifestError(
      `Manifest ${manifestPath} contains invalid resources: ${invalidResources.join(", ")}`
    );
  }

  return resources;
}

/**
 * Parse a TXT format manifest (one resource per line, # for comments)
 */
function parseTxtManifest(content: string, manifestPath: string): Manifest {
  const lines = content.split("\n");
  const resources: string[] = [];
  const invalidResources: { line: number; value: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) {
      continue;
    }

    if (!isValidResource(line)) {
      invalidResources.push({ line: i + 1, value: line });
    } else {
      resources.push(line);
    }
  }

  if (invalidResources.length > 0) {
    const details = invalidResources.map((a) => `line ${a.line}: "${a.value}"`).join(", ");
    throw new ManifestError(`Manifest ${manifestPath} contains invalid resources: ${details}`);
  }

  return { resources };
}
