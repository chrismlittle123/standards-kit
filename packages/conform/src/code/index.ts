import { type Config } from "../core/index.js";
import { type CheckResult, type DomainResult, DomainResultBuilder, type IToolRunner } from "../core/index.js";
import {
  CoverageRunRunner,
  DisableCommentsRunner,
  ESLintRunner,
  GitleaksRunner,
  KnipRunner,
  NamingRunner,
  PipAuditRunner,
  PnpmAuditRunner,
  RuffRunner,
  TscRunner,
  TyRunner,
  VultureRunner,
} from "./tools/index.js";

// Tool runner instances (singletons for tools that don't need per-run config)
const knip = new KnipRunner();
const pipaudit = new PipAuditRunner();
const ty = new TyRunner();
const vulture = new VultureRunner();

// Note: RuffRunner and TscRunner are created per-run to support config from standards.toml

// Export tool runners for direct access
export {
  BaseToolRunner,
  ESLintRunner,
  KnipRunner,
  NamingRunner,
  RuffRunner,
  TscRunner,
  TyRunner,
  VultureRunner,
} from "./tools/index.js";

/** Tool configuration entry mapping config getter to runner or runner factory */
interface ToolEntry {
  isEnabled: (config: Config) => boolean;
  runner: IToolRunner | ((config: Config) => IToolRunner);
}

/** Check if a tool is enabled in config */
function isEnabled(toolConfig: { enabled?: boolean } | undefined): boolean {
  return toolConfig?.enabled === true;
}

/** Create a configured ESLintRunner */
function createEslintRunner(config: Config): ESLintRunner {
  const runner = new ESLintRunner();
  const eslintConfig = config.code?.linting?.eslint;
  if (eslintConfig) {
    runner.setConfig({
      enabled: eslintConfig.enabled,
      files: eslintConfig.files,
      ignore: eslintConfig.ignore,
      "max-warnings": eslintConfig["max-warnings"],
      rules: eslintConfig.rules,
    });
  }
  return runner;
}

/** Create a configured CoverageRunRunner */
function createCoverageRunRunner(config: Config): CoverageRunRunner {
  const runner = new CoverageRunRunner();
  const coverageConfig = config.code?.coverage_run;
  if (coverageConfig) {
    runner.setConfig({
      enabled: coverageConfig.enabled,
      min_threshold: coverageConfig.min_threshold,
      runner: coverageConfig.runner,
      command: coverageConfig.command,
    });
  }
  return runner;
}

/** Create a configured RuffRunner */
function createRuffRunner(config: Config): RuffRunner {
  const runner = new RuffRunner();
  const ruffConfig = config.code?.linting?.ruff;
  if (ruffConfig) {
    runner.setConfig({
      enabled: ruffConfig.enabled,
      "line-length": ruffConfig["line-length"],
      lint: ruffConfig.lint,
    });
  }
  return runner;
}

/** Create a configured TscRunner */
function createTscRunner(config: Config): TscRunner {
  const runner = new TscRunner();
  const tscConfig = config.code?.types?.tsc;
  if (tscConfig?.require) {
    runner.setRequiredOptions(tscConfig.require);
  }
  return runner;
}

/** Create a configured NamingRunner */
function createNamingRunner(config: Config): NamingRunner {
  const runner = new NamingRunner();
  const namingConfig = config.code?.naming;
  if (namingConfig) {
    runner.setConfig({
      enabled: namingConfig.enabled,
      rules: namingConfig.rules,
    });
  }
  return runner;
}

/** Create a configured DisableCommentsRunner */
function createDisableCommentsRunner(config: Config): DisableCommentsRunner {
  const runner = new DisableCommentsRunner();
  const disableCommentsConfig = config.code?.quality?.["disable-comments"];
  if (disableCommentsConfig) {
    runner.setConfig({
      enabled: disableCommentsConfig.enabled,
      patterns: disableCommentsConfig.patterns,
      extensions: disableCommentsConfig.extensions,
      exclude: disableCommentsConfig.exclude,
    });
  }
  return runner;
}

/** Create a configured PnpmAuditRunner */
function createPnpmAuditRunner(config: Config): PnpmAuditRunner {
  const runner = new PnpmAuditRunner();
  const pnpmauditConfig = config.code?.security?.pnpmaudit;
  if (pnpmauditConfig) {
    runner.setConfig({
      enabled: pnpmauditConfig.enabled,
      exclude_dev: pnpmauditConfig.exclude_dev,
    });
  }
  return runner;
}

/** Create a configured GitleaksRunner */
function createGitleaksRunner(config: Config): GitleaksRunner {
  const runner = new GitleaksRunner();
  const secretsConfig = config.code?.security?.secrets;
  if (secretsConfig) {
    runner.setConfig({
      enabled: secretsConfig.enabled,
      scan_mode: secretsConfig.scan_mode,
      base_branch: secretsConfig.base_branch,
    });
  }
  return runner;
}

/** All available tools with their config predicates */
const toolRegistry: ToolEntry[] = [
  { isEnabled: (c) => isEnabled(c.code?.linting?.eslint), runner: createEslintRunner },
  { isEnabled: (c) => isEnabled(c.code?.linting?.ruff), runner: createRuffRunner },
  { isEnabled: (c) => isEnabled(c.code?.types?.tsc), runner: createTscRunner },
  { isEnabled: (c) => isEnabled(c.code?.types?.ty), runner: ty },
  { isEnabled: (c) => isEnabled(c.code?.unused?.knip), runner: knip },
  { isEnabled: (c) => isEnabled(c.code?.unused?.vulture), runner: vulture },
  { isEnabled: (c) => isEnabled(c.code?.security?.secrets), runner: createGitleaksRunner },
  { isEnabled: (c) => isEnabled(c.code?.security?.pnpmaudit), runner: createPnpmAuditRunner },
  { isEnabled: (c) => isEnabled(c.code?.security?.pipaudit), runner: pipaudit },
  { isEnabled: (c) => isEnabled(c.code?.coverage_run), runner: createCoverageRunRunner },
  { isEnabled: (c) => isEnabled(c.code?.naming), runner: createNamingRunner },
  {
    isEnabled: (c) => isEnabled(c.code?.quality?.["disable-comments"]),
    runner: createDisableCommentsRunner,
  },
];

/**
 * Get enabled tools based on configuration
 */
function getEnabledTools(config: Config): IToolRunner[] {
  return toolRegistry
    .filter((entry) => entry.isEnabled(config))
    .map((entry) => (typeof entry.runner === "function" ? entry.runner(config) : entry.runner));
}

/**
 * Run all code checks based on configuration
 */
export async function runCodeChecks(projectRoot: string, config: Config): Promise<DomainResult> {
  const tools = getEnabledTools(config);
  const checks = await runTools(tools, projectRoot, "run");
  return DomainResultBuilder.fromChecks("code", checks);
}

/**
 * Audit code configuration (check that configs exist without running tools)
 */
export async function auditCodeConfig(projectRoot: string, config: Config): Promise<DomainResult> {
  const tools = getEnabledTools(config);
  const checks = await runTools(tools, projectRoot, "audit");
  return DomainResultBuilder.fromChecks("code", checks);
}

/**
 * Run tools in parallel with error isolation
 * Uses Promise.allSettled to ensure one failing tool doesn't lose all results
 */
async function runTools(
  tools: IToolRunner[],
  projectRoot: string,
  mode: "run" | "audit"
): Promise<CheckResult[]> {
  const promises = tools.map((tool) =>
    mode === "run" ? tool.run(projectRoot) : tool.audit(projectRoot)
  );

  const results = await Promise.allSettled(promises);

  return results.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    // Handle rejected promise - create error result for the tool
    const tool = tools[index];
    const errorMessage = result.reason instanceof Error ? result.reason.message : "Unknown error";

    return {
      name: tool.name,
      rule: tool.rule,
      passed: false,
      violations: [
        {
          rule: tool.rule,
          tool: tool.toolId,
          message: `Tool error: ${errorMessage}`,
          severity: "error" as const,
        },
      ],
      skipped: false,
      duration: 0,
    };
  });
}
