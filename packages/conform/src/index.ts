/**
 * @standards-kit/conform - In-repo standards enforcement
 */

// Types
export type {
  CheckResult,
  DomainResult,
  DomainStatus,
  ExitCodeType,
  FullResult,
  IToolRunner,
  Severity,
  Violation,
  ViolationOptions,
} from "./core/index.js";

// Builders and constants
export {
  CheckResultBuilder,
  DomainResultBuilder,
  ExitCode,
  ViolationBuilder,
} from "./core/index.js";

// Config
export {
  type Config,
  ConfigError,
  configSchema,
  defaultConfig,
  findConfigFile,
  getProjectRoot,
  loadConfig,
} from "./core/index.js";

// Code domain
export {
  auditCodeConfig,
  BaseToolRunner,
  ESLintRunner,
  KnipRunner,
  NamingRunner,
  RuffRunner,
  runCodeChecks,
  TscRunner,
  TyRunner,
  VultureRunner,
} from "./code/index.js";

// Process domain
export {
  auditProcessConfig,
  HooksRunner,
  runProcessChecks,
} from "./process/index.js";

// Process scan (remote validation)
export {
  type RemoteRepoInfo,
  type ScanOptions,
  scanRepository,
  type ScanResult,
  validateProcess,
  type ValidateProcessOptions,
  type ValidateProcessResult,
} from "./process/scan/index.js";

// Output
export { formatJson, formatOutput, formatText, type OutputFormat } from "./output/index.js";

// Dependencies
export {
  type DependenciesOptions,
  type DependenciesResult,
  getDependencies,
} from "./dependencies/index.js";

// Validate
export {
  formatTierResultJson,
  formatTierResultText,
  type Tier,
  type TierSourceDetail,
  VALID_TIERS,
  type ValidateTierOptions,
  type ValidateTierResult,
  validateTierRuleset,
} from "./validate/index.js";

// MCP Server
export {
  createServer as createMcpServer,
  startServer as startMcpServer,
  type Guideline,
  type GuidelineFrontmatter,
  type GuidelineListItem,
  type Ruleset,
} from "./mcp/index.js";

// Infra scan - Types
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
  GenerateManifestOptions,
} from "./infra/index.js";

// Infra scan - Zod schemas
export {
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
} from "./infra/index.js";

// Infra scan - Validation functions
export {
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
} from "./infra/index.js";

// Infra scan - Manifest utilities
export {
  ManifestError,
  isMultiAccountManifest,
  isLegacyManifest,
  parseAccountKey,
  formatAccountKey,
  normalizeManifest,
  detectAccountFromResource,
  getAllResources,
} from "./infra/index.js";

// Infra scan - ARN/GCP parsing
export {
  parseArn,
  isValidArn,
  parseGcpResource,
  isValidGcpResource,
} from "./infra/index.js";

// Infra scan - Service constants
export {
  SUPPORTED_SERVICES,
  isSupportedService,
  SUPPORTED_GCP_SERVICES,
  isSupportedGcpService,
} from "./infra/index.js";

// Infra scan - Generate functions
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
} from "./infra/index.js";

// Infra scan - Main API
export { scanInfra } from "./infra/index.js";
