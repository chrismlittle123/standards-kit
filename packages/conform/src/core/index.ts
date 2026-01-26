// Types
export type {
  Severity,
  DomainStatus,
  Violation,
  CheckResult,
  DomainResult,
  FullResult,
  IToolRunner,
  ViolationOptions,
  ExitCodeType,
} from "./types.js";

export {
  ViolationBuilder,
  CheckResultBuilder,
  DomainResultBuilder,
  ExitCode,
} from "./types.js";

// Schema
export type { Config } from "./schema.js";
export { configSchema, defaultConfig, DEFAULT_FORBIDDEN_FILES_IGNORE } from "./schema.js";

// Loader
export {
  CONFIG_FILE_NAME,
  ConfigError,
  findConfigFile,
  loadConfig,
  loadConfigAsync,
  loadConfigWithOverrides,
  getProjectRoot,
} from "./loader.js";
export type { ConfigOverride } from "./loader.js";

// Registry
export {
  parseRegistryUrl,
  fetchRegistry,
  loadRuleset,
  mergeConfigs,
  resolveExtends,
} from "./registry.js";
