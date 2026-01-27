/**
 * Zod schemas for runtime validation of infra manifests and resources
 *
 * These schemas validate external inputs like manifest files,
 * stack exports, ARNs, and GCP resource paths at runtime.
 */

import { z } from "zod";

// =============================================================================
// Cloud Provider Types
// =============================================================================

/**
 * Cloud provider schema
 */
export const CloudProviderSchema = z.enum(["aws", "gcp"]);
export type CloudProvider = z.infer<typeof CloudProviderSchema>;

/**
 * Account key schema - format: "provider:accountId"
 * Examples: "aws:123456789012", "gcp:my-project-id"
 */
export const AccountKeySchema = z
  .string()
  .regex(
    /^(aws|gcp):.+$/,
    "Invalid account key format. Expected: provider:accountId (e.g., aws:123456789012, gcp:my-project)"
  );
type AccountKey = z.infer<typeof AccountKeySchema>;

// =============================================================================
// AWS Resource Schemas
// =============================================================================

/**
 * ARN schema - validates AWS ARN format
 *
 * Format: arn:partition:service:region:account-id:resource
 */
export const ArnSchema = z
  .string()
  .regex(
    /^arn:(aws|aws-cn|aws-us-gov):[a-z0-9-]+:[a-z0-9-]*:[0-9]*:.+$/,
    "Invalid ARN format. Expected: arn:partition:service:region:account-id:resource"
  );
export type Arn = z.infer<typeof ArnSchema>;

/**
 * Parsed ARN schema - components extracted from an ARN
 */
export const ParsedArnSchema = z.object({
  /** Cloud provider (always "aws" for ARNs) */
  cloud: z.literal("aws"),

  /** AWS partition (aws, aws-cn, aws-us-gov) */
  partition: z.string(),

  /** AWS service (s3, lambda, rds, etc.) */
  service: z.string(),

  /** AWS region (empty for global services like S3, IAM) */
  region: z.string(),

  /** AWS account ID (empty for S3 buckets) */
  accountId: z.string(),

  /** Resource type (e.g., function, table, bucket) */
  resourceType: z.string(),

  /** Resource name/identifier */
  resourceId: z.string(),

  /** Original ARN string */
  raw: z.string(),
});
export type ParsedArn = z.infer<typeof ParsedArnSchema>;

// =============================================================================
// GCP Resource Schemas
// =============================================================================

/**
 * GCP resource path schema - validates GCP resource path format
 *
 * Examples:
 * - projects/my-project/locations/us-central1/functions/my-func
 * - projects/my-project/topics/my-topic
 * - projects/my-project/subscriptions/my-sub
 */
export const GcpResourcePathSchema = z
  .string()
  .regex(
    /^projects\/[^/]+\/.+$/,
    "Invalid GCP resource path format. Expected: projects/{project-id}/..."
  );
export type GcpResourcePath = z.infer<typeof GcpResourcePathSchema>;

/**
 * Parsed GCP resource schema - components extracted from a GCP resource path
 */
export const ParsedGcpResourceSchema = z.object({
  /** Cloud provider (always "gcp" for GCP resources) */
  cloud: z.literal("gcp"),

  /** GCP project ID */
  project: z.string(),

  /** GCP service (run, iam, secretmanager, artifactregistry, etc.) */
  service: z.string(),

  /** Location/region (us-central1, global, etc.) */
  location: z.string(),

  /** Resource type (services, serviceAccounts, secrets, repositories, etc.) */
  resourceType: z.string(),

  /** Resource name/ID */
  resourceId: z.string(),

  /** Original resource path */
  raw: z.string(),
});
export type ParsedGcpResource = z.infer<typeof ParsedGcpResourceSchema>;

/**
 * Generic resource identifier - can be AWS ARN or GCP resource path
 */
export const ResourceIdentifierSchema = z.union([ArnSchema, GcpResourcePathSchema]);
export type ResourceIdentifier = z.infer<typeof ResourceIdentifierSchema>;

// =============================================================================
// Account Types
// =============================================================================

/**
 * Account identifier schema - parsed from account key
 */
export const AccountIdSchema = z.object({
  /** Cloud provider */
  cloud: CloudProviderSchema,

  /** AWS account ID or GCP project ID */
  id: z.string(),
});
export type AccountId = z.infer<typeof AccountIdSchema>;

/**
 * Account entry in a multi-account manifest
 */
export const ManifestAccountSchema = z.object({
  /** Optional human-readable alias for this account */
  alias: z.string().optional(),

  /** List of resource identifiers (ARNs or GCP resource paths) */
  resources: z.array(z.string()),
});
export type ManifestAccount = z.infer<typeof ManifestAccountSchema>;

// =============================================================================
// Manifest Schemas
// =============================================================================

/**
 * V2 Multi-account manifest schema
 *
 * Resources are grouped by cloud account (AWS account ID or GCP project ID)
 */
export const MultiAccountManifestSchema = z.object({
  /** Manifest version - must be 2 for multi-account format */
  version: z.literal(2),

  /** Optional project name */
  project: z.string().optional(),

  /** Resources grouped by account key (e.g., "aws:123456789012", "gcp:my-project") */
  accounts: z.record(z.string(), ManifestAccountSchema),
});
export type MultiAccountManifest = z.infer<typeof MultiAccountManifestSchema>;

/**
 * Legacy manifest schema (v1) - flat array of resources
 */
export const LegacyManifestSchema = z.object({
  /** Optional manifest version (1 or undefined for legacy) */
  version: z.literal(1).optional(),

  /** Optional project name */
  project: z.string().optional(),

  /** Flat list of resource identifiers */
  resources: z.array(z.string()),
});
export type LegacyManifest = z.infer<typeof LegacyManifestSchema>;

/**
 * Any manifest schema - accepts either v1 or v2 format
 */
export const ManifestSchema = z.union([MultiAccountManifestSchema, LegacyManifestSchema]);
export type Manifest = z.infer<typeof ManifestSchema>;

// =============================================================================
// Scan Result Schemas
// =============================================================================

/**
 * Result of checking a single resource
 */
export const ResourceCheckResultSchema = z.object({
  /** The resource ARN or GCP path */
  arn: z.string(),

  /** Whether the resource exists */
  exists: z.boolean(),

  /** Error message if check failed */
  error: z.string().optional(),

  /** Service name (e.g., s3, lambda, run) */
  service: z.string(),

  /** Resource type (e.g., bucket, function) */
  resourceType: z.string(),

  /** Resource identifier */
  resourceId: z.string(),
});
export type ResourceCheckResult = z.infer<typeof ResourceCheckResultSchema>;

/**
 * Scan summary statistics
 */
export const InfraScanSummarySchema = z.object({
  /** Total resources checked */
  total: z.number().int().nonnegative(),

  /** Resources that exist */
  found: z.number().int().nonnegative(),

  /** Resources that don't exist */
  missing: z.number().int().nonnegative(),

  /** Resources that couldn't be checked (errors) */
  errors: z.number().int().nonnegative(),
});
export type InfraScanSummary = z.infer<typeof InfraScanSummarySchema>;

/**
 * Per-account scan results
 */
const AccountScanResultSchema = z.object({
  /** Account alias if provided */
  alias: z.string().optional(),

  /** Individual resource check results */
  results: z.array(ResourceCheckResultSchema),

  /** Summary statistics for this account */
  summary: InfraScanSummarySchema,
});
export type AccountScanResult = z.infer<typeof AccountScanResultSchema>;

/**
 * Full infrastructure scan result
 */
export const InfraScanResultSchema = z.object({
  /** Path to the manifest file */
  manifest: z.string(),

  /** Project name */
  project: z.string().optional(),

  /** Individual resource check results */
  results: z.array(ResourceCheckResultSchema),

  /** Summary statistics */
  summary: InfraScanSummarySchema,

  /** Per-account results (only present for multi-account manifests) */
  accountResults: z.record(z.string(), AccountScanResultSchema).optional(),
});
export type InfraScanResult = z.infer<typeof InfraScanResultSchema>;

// =============================================================================
// Scan Options Schemas
// =============================================================================

/**
 * Options for programmatic API
 */
export interface ScanInfraOptions {
  /** Path to manifest file */
  manifestPath?: string;

  /** Path to config file */
  configPath?: string;

  /** Filter to specific account (by alias or account key like "aws:123") */
  account?: string;
}

/**
 * Options for CLI handler
 */
export type RunInfraScanOptions = ScanInfraOptions & {
  /** Output format */
  format?: "text" | "json";
};

// =============================================================================
// Pulumi Stack Export Schemas
// =============================================================================

/**
 * Pulumi resource in stack export
 */
export const PulumiResourceSchema = z.object({
  urn: z.string().optional(),
  type: z.string().optional(),
  inputs: z.record(z.string(), z.unknown()).optional(),
  outputs: z.record(z.string(), z.unknown()).optional(),
});
export type PulumiResource = z.infer<typeof PulumiResourceSchema>;

/**
 * Pulumi stack export schema (simplified)
 */
export const PulumiStackExportSchema = z.object({
  version: z.number().optional(),
  deployment: z
    .object({
      manifest: z
        .object({
          time: z.string().optional(),
          magic: z.string().optional(),
          version: z.string().optional(),
        })
        .optional(),
      resources: z.array(PulumiResourceSchema).optional(),
    })
    .optional(),
});
export type PulumiStackExport = z.infer<typeof PulumiStackExportSchema>;

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate an ARN string
 * @throws ZodError if invalid
 */
export function validateArn(arn: string): Arn {
  return ArnSchema.parse(arn);
}

/**
 * Check if a string is a valid ARN format
 */
export function isValidArnFormat(arn: string): boolean {
  return ArnSchema.safeParse(arn).success;
}

/**
 * Validate a GCP resource path
 * @throws ZodError if invalid
 */
export function validateGcpResourcePath(path: string): GcpResourcePath {
  return GcpResourcePathSchema.parse(path);
}

/**
 * Check if a string is a valid GCP resource path
 */
export function isValidGcpResourcePath(path: string): boolean {
  return GcpResourcePathSchema.safeParse(path).success;
}

/**
 * Validate an account key string
 * @throws ZodError if invalid
 */
export function validateAccountKey(key: string): AccountKey {
  return AccountKeySchema.parse(key);
}

/**
 * Check if a string is a valid account key
 */
export function isValidAccountKey(key: string): boolean {
  return AccountKeySchema.safeParse(key).success;
}

/**
 * Validate a legacy (v1) manifest
 * @throws ZodError if invalid
 */
export function validateLegacyManifest(data: unknown): LegacyManifest {
  return LegacyManifestSchema.parse(data);
}

/**
 * Validate a multi-account (v2) manifest
 * @throws ZodError if invalid
 */
export function validateMultiAccountManifest(data: unknown): MultiAccountManifest {
  return MultiAccountManifestSchema.parse(data);
}

/**
 * Validate any manifest format (v1 or v2)
 * @throws ZodError if invalid
 */
export function validateManifest(data: unknown): Manifest {
  return ManifestSchema.parse(data);
}

/**
 * Check if data is a valid multi-account (v2) manifest
 */
export function isMultiAccountManifestSchema(data: unknown): data is MultiAccountManifest {
  return MultiAccountManifestSchema.safeParse(data).success;
}

/**
 * Check if data is a valid legacy (v1) manifest
 */
export function isLegacyManifestSchema(data: unknown): data is LegacyManifest {
  return LegacyManifestSchema.safeParse(data).success;
}

/**
 * Validate a Pulumi stack export
 * @throws ZodError if invalid
 */
export function validateStackExport(data: unknown): PulumiStackExport {
  return PulumiStackExportSchema.parse(data);
}

