/**
 * Type definitions for the infra scan module
 *
 * Types are derived from Zod schemas for runtime validation support.
 * Re-exports from schemas.ts for backwards compatibility.
 */

// Re-export all types from schemas (derived from Zod)
export type {
  // Cloud providers
  CloudProvider,

  // AWS types
  Arn,
  ParsedArn,

  // GCP types
  GcpResourcePath,
  ParsedGcpResource,
  ResourceIdentifier,

  // Account types
  AccountId,
  ManifestAccount,

  // Manifest types
  MultiAccountManifest,
  LegacyManifest,
  Manifest,

  // Scan result types
  ResourceCheckResult,
  InfraScanSummary,
  AccountScanResult,
  InfraScanResult,

  // Options types
  ScanInfraOptions,
  RunInfraScanOptions,

  // Pulumi types
  PulumiResource,
  PulumiStackExport,
} from "./schemas.js";

// Re-export schemas for runtime validation (public API)
export {
  // Schemas
  CloudProviderSchema,
  AccountKeySchema,
  ArnSchema,
  ParsedArnSchema,
  GcpResourcePathSchema,
  ParsedGcpResourceSchema,
  ResourceIdentifierSchema,
  AccountIdSchema,
  ManifestAccountSchema,
  MultiAccountManifestSchema,
  LegacyManifestSchema,
  ManifestSchema,
  ResourceCheckResultSchema,
  InfraScanSummarySchema,
  InfraScanResultSchema,
  PulumiResourceSchema,
  PulumiStackExportSchema,

  // Validation functions
  validateArn,
  isValidArnFormat,
  validateGcpResourcePath,
  isValidGcpResourcePath,
  validateAccountKey,
  isValidAccountKey,
  validateLegacyManifest,
  validateMultiAccountManifest,
  validateManifest,
  isMultiAccountManifestSchema,
  isLegacyManifestSchema,
  validateStackExport,
} from "./schemas.js";
