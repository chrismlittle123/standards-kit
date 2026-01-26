#!/usr/bin/env node
/* eslint-disable max-lines -- CLI entry point grows with commands */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import chalk from "chalk";
import { Command, type CommanderError, Option } from "commander";
import { zodToJsonSchema } from "zod-to-json-schema";

import { auditCodeConfig, runCodeChecks } from "./code/index.js";
import {
  ConfigError,
  type ConfigOverride,
  getProjectRoot,
  loadConfig,
  loadConfigAsync,
} from "./core/index.js";
import { configSchema } from "./core/index.js";
import { type DependenciesOptions, runDependencies } from "./dependencies/index.js";
import { formatOutput, type OutputFormat } from "./output/index.js";
import { checkBranchCommand, checkCommitCommand } from "./process/commands/index.js";
import { auditProcessConfig, runProcessChecks } from "./process/index.js";
import { type DetectOptions, runDetect } from "./projects/index.js";
import { type DomainResult, ExitCode, type FullResult } from "./core/index.js";

// Read version from package.json to avoid hardcoding
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(__dirname, "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { version: string };
const VERSION = packageJson.version;

/**
 * Configure exitOverride for a Command to return proper exit codes.
 * Must be called on parent commands that have subcommands with options.
 */
function configureExitOverride(cmd: Command): Command {
  return cmd.exitOverride((err: CommanderError) => {
    // Commander uses exit code 1 for all errors by default
    // We want to use exit code 2 (CONFIG_ERROR) for argument/option errors
    if (
      err.code === "commander.invalidArgument" ||
      err.code === "commander.optionMissingArgument"
    ) {
      process.exit(ExitCode.CONFIG_ERROR);
    }
    // For other Commander errors (help, version), use the default exit code
    process.exit(err.exitCode);
  });
}

const program = new Command();

configureExitOverride(program)
  .name("conform")
  .description("Unified project health checks for code quality")
  .version(VERSION)
  .configureOutput({
    writeErr: (str: string) => {
      // Write errors to stderr without the default "error:" prefix duplication
      process.stderr.write(str);
    },
  });

// =============================================================================
// Shared action handlers
// =============================================================================

type DomainFilter = "code" | "process" | undefined;

function shouldRunDomain(filter: DomainFilter, domain: "code" | "process"): boolean {
  return !filter || filter === domain;
}

function buildResult(configPath: string, domains: Record<string, DomainResult>): FullResult {
  const totalViolations = Object.values(domains).reduce((sum, d) => sum + d.violationCount, 0);
  return {
    version: VERSION,
    configPath,
    domains,
    summary: {
      totalViolations,
      exitCode: totalViolations > 0 ? ExitCode.VIOLATIONS_FOUND : ExitCode.SUCCESS,
    },
  };
}

function handleError(error: unknown): never {
  if (error instanceof ConfigError) {
    console.error(chalk.red(`Config error: ${error.message}`));
    process.exit(ExitCode.CONFIG_ERROR);
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(chalk.red(`Error: ${message}`));
  process.exit(ExitCode.RUNTIME_ERROR);
}

async function runCheck(
  options: { config?: string; format: string },
  domain?: DomainFilter
): Promise<void> {
  try {
    const { config, configPath } = await loadConfigAsync(options.config);
    const projectRoot = getProjectRoot(configPath);

    const domains: Record<string, DomainResult> = {};
    if (shouldRunDomain(domain, "code")) {
      domains.code = await runCodeChecks(projectRoot, config);
    }
    if (shouldRunDomain(domain, "process")) {
      domains.process = await runProcessChecks(projectRoot, config);
    }

    const result = buildResult(configPath, domains);
    process.stdout.write(`${formatOutput(result, options.format as OutputFormat)}\n`);
    process.exit(result.summary.exitCode);
  } catch (error) {
    handleError(error);
  }
}

async function runAudit(
  options: { config?: string; format: string },
  domain?: DomainFilter
): Promise<void> {
  try {
    const { config, configPath } = await loadConfigAsync(options.config);
    const projectRoot = getProjectRoot(configPath);

    const domains: Record<string, DomainResult> = {};
    if (shouldRunDomain(domain, "code")) {
      domains.code = await auditCodeConfig(projectRoot, config);
    }
    if (shouldRunDomain(domain, "process")) {
      domains.process = await auditProcessConfig(projectRoot, config);
    }

    const result = buildResult(configPath, domains);
    process.stdout.write(`${formatOutput(result, options.format as OutputFormat)}\n`);
    process.exit(result.summary.exitCode);
  } catch (error) {
    handleError(error);
  }
}

// =============================================================================
// Validate subcommand
// =============================================================================

const validateCommand = configureExitOverride(
  new Command("validate").description("Validate configuration files")
);

// conform validate config - validate standards.toml
validateCommand
  .command("config")
  .description("Validate standards.toml configuration file")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .option("-v, --verbose", "Show detailed information including config overrides")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action(async (options: { config?: string; format: string; verbose?: boolean }) => {
    try {
      const { loadConfigWithOverrides } = await import("./core/index.js");
      const { configPath, overrides } = await loadConfigWithOverrides(options.config);
      outputValidateResult(configPath, overrides, options);
      process.exit(ExitCode.SUCCESS);
    } catch (error) {
      handleValidateError(error, options.format);
    }
  });

function outputValidateResult(
  configPath: string,
  overrides: ConfigOverride[],
  options: { format: string; verbose?: boolean }
): void {
  const showOverrides = options.verbose && overrides.length > 0;
  if (options.format === "json") {
    const result: Record<string, unknown> = { valid: true, configPath };
    if (showOverrides) {
      result.overrides = overrides;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(chalk.green(`✓ Valid: ${configPath}\n`));
  if (showOverrides) {
    process.stdout.write(chalk.yellow("\nConfig overrides detected:\n"));
    for (const o of overrides) {
      process.stdout.write(
        chalk.yellow(`  ℹ Pattern "${o.key}": ${o.projectValue} replaces ${o.registryValue}\n`)
      );
    }
  }
}

function handleValidateError(error: unknown, format: string): never {
  if (error instanceof ConfigError) {
    if (format === "json") {
      process.stdout.write(`${JSON.stringify({ valid: false, error: error.message }, null, 2)}\n`);
    } else {
      console.error(chalk.red(`✗ Invalid: ${error.message}`));
    }
    process.exit(ExitCode.CONFIG_ERROR);
  }
  console.error(chalk.red(`Error: ${error instanceof Error ? error.message : "Unknown error"}`));
  process.exit(ExitCode.RUNTIME_ERROR);
}

// conform validate registry - validate registry structure
interface RegistryError {
  file: string;
  error: string;
}
interface RegistryValidation {
  count: number;
  errors: RegistryError[];
}

function validateRulesets(cwd: string): RegistryValidation {
  const dir = path.join(cwd, "rulesets");
  if (!fs.existsSync(dir)) {
    return { count: 0, errors: [{ file: "rulesets/", error: "Directory does not exist" }] };
  }
  const errors: RegistryError[] = [];
  let count = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".toml"))) {
    try {
      loadConfig(path.join(dir, file));
      count++;
    } catch (error) {
      errors.push({
        file: `rulesets/${file}`,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  return { count, errors };
}

interface RegistryResult {
  valid: boolean;
  rulesetsCount: number;
  errors: RegistryError[];
}

function outputRegistryResult(result: RegistryResult, format: string): void {
  const { valid, rulesetsCount, errors } = result;
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({ valid, rulesetsCount, errors }, null, 2)}\n`);
  } else if (valid) {
    process.stdout.write(chalk.green(`✓ Registry valid\n`));
    process.stdout.write(`  Rulesets: ${rulesetsCount} valid\n`);
  } else {
    console.error(chalk.red(`✗ Registry invalid\n`));
    errors.forEach(({ file, error }) => console.error(chalk.red(`  ${file}: ${error}`)));
  }
}

validateCommand
  .command("registry")
  .description("Validate registry structure (rulesets/*.toml)")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action(async (options: { format: string }) => {
    const rulesets = validateRulesets(process.cwd());
    const { count: rulesetsCount, errors } = rulesets;
    const valid = errors.length === 0;
    outputRegistryResult({ valid, rulesetsCount, errors }, options.format);
    process.exit(valid ? ExitCode.SUCCESS : ExitCode.CONFIG_ERROR);
  });

// conform validate tier - validate tier-ruleset alignment
validateCommand
  .command("tier")
  .description("Validate tier-ruleset alignment (repo-metadata.yaml vs standards.toml)")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action(async (options: { config?: string; format: string }) => {
    try {
      const { validateTierRuleset, formatTierResultText, formatTierResultJson } =
        await import("./validate/index.js");
      const result = validateTierRuleset({ config: options.config });

      const output =
        options.format === "json" ? formatTierResultJson(result) : formatTierResultText(result);

      process.stdout.write(`${output}\n`);
      process.exit(result.valid ? ExitCode.SUCCESS : ExitCode.CONFIG_ERROR);
    } catch (error) {
      if (error instanceof ConfigError) {
        if (options.format === "json") {
          process.stdout.write(
            `${JSON.stringify({ valid: false, error: error.message }, null, 2)}\n`
          );
        } else {
          console.error(chalk.red(`✗ Error: ${error.message}`));
        }
        process.exit(ExitCode.CONFIG_ERROR);
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(chalk.red(`Error: ${message}`));
      process.exit(ExitCode.RUNTIME_ERROR);
    }
  });

// conform validate guidelines <path> - validate guideline markdown files
validateCommand
  .command("guidelines <path>")
  .description("Validate guideline markdown files against the frontmatter schema")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action(async (dirPath: string, options: { format: string }) => {
    try {
      const { runValidateGuidelines } = await import("./validate/index.js");
      await runValidateGuidelines(dirPath, options);
    } catch (error) {
      handleError(error);
    }
  });

program.addCommand(validateCommand);

// =============================================================================
// Schema subcommand
// =============================================================================

const schemaCommand = new Command("schema").description(
  "Output JSON schemas for configuration files"
);

// conform schema config - output standards.toml JSON schema
schemaCommand
  .command("config")
  .description("Output JSON schema for standards.toml configuration")
  .action(() => {
    const jsonSchema = zodToJsonSchema(configSchema, {
      name: "CheckTomlConfig",
      $refStrategy: "none",
    });
    process.stdout.write(`${JSON.stringify(jsonSchema, null, 2)}\n`);
  });

// conform schema guidelines - output guideline frontmatter JSON schema
schemaCommand
  .command("guidelines")
  .description("Output JSON schema for guideline frontmatter")
  .action(async () => {
    const { frontmatterSchema } = await import("./mcp/standards/index.js");
    const jsonSchema = zodToJsonSchema(frontmatterSchema, {
      name: "GuidelineFrontmatter",
      $refStrategy: "none",
    });
    process.stdout.write(`${JSON.stringify(jsonSchema, null, 2)}\n`);
  });

program.addCommand(schemaCommand);

// =============================================================================
// Code subcommand
// =============================================================================

const codeCommand = configureExitOverride(new Command("code").description("Code quality checks"));

// conform code check
codeCommand
  .command("check")
  .description("Run linting and type checking tools")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action((options) => runCheck(options, "code"));

// conform code audit
codeCommand
  .command("audit")
  .description("Verify linting and type checking configs exist")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action((options) => runAudit(options, "code"));

program.addCommand(codeCommand);

// =============================================================================
// Process subcommand
// =============================================================================

const processCommand = configureExitOverride(
  new Command("process").description("Workflow and process checks")
);

// conform process check
processCommand
  .command("check")
  .description("Run workflow validation (hooks, CI, etc.)")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action((options) => runCheck(options, "process"));

// conform process audit
processCommand
  .command("audit")
  .description("Verify workflow configs exist")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action((options) => runAudit(options, "process"));

// conform process diff
processCommand
  .command("diff")
  .description("Show repository setting differences (current vs. config)")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action(async (options: { config?: string; format: string }) => {
    const { runDiff } = await import("./process/sync/index.js");
    await runDiff({ config: options.config, format: options.format as "text" | "json" });
  });

// conform process sync
processCommand
  .command("sync")
  .description("Synchronize repository settings to match config")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .option("--apply", "Actually apply changes (required for safety)")
  .option("--validate-actors", "Validate bypass actor IDs against GitHub API before applying")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action(
    async (options: {
      config?: string;
      format: string;
      apply?: boolean;
      validateActors?: boolean;
    }) => {
      const { runSync } = await import("./process/sync/index.js");
      await runSync({
        config: options.config,
        format: options.format as "text" | "json",
        apply: options.apply,
        validateActors: options.validateActors,
      });
    }
  );

// conform process diff-tags
processCommand
  .command("diff-tags")
  .description("Show tag protection differences (current vs. config)")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action(async (options: { config?: string; format: string }) => {
    const { runTagDiff } = await import("./process/sync/index.js");
    await runTagDiff({ config: options.config, format: options.format as "text" | "json" });
  });

// conform process sync-tags
processCommand
  .command("sync-tags")
  .description("Synchronize tag protection ruleset to match config")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .option("--apply", "Actually apply changes (required for safety)")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action(async (options: { config?: string; format: string; apply?: boolean }) => {
    const { runTagSync } = await import("./process/sync/index.js");
    await runTagSync({
      config: options.config,
      format: options.format as "text" | "json",
      apply: options.apply,
    });
  });

// conform process check-branch
processCommand
  .command("check-branch")
  .description("Validate current branch name (for pre-push hook)")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .option("-q, --quiet", "Minimal output for hooks")
  .action(async (options: { config?: string; quiet?: boolean }) => {
    try {
      const exitCode = await checkBranchCommand(options);
      process.exit(exitCode);
    } catch (error) {
      handleError(error);
    }
  });

// conform process check-commit <file>
processCommand
  .command("check-commit <file>")
  .description("Validate commit message (for commit-msg hook)")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .option("-q, --quiet", "Minimal output for hooks")
  .action(async (file: string, options: { config?: string; quiet?: boolean }) => {
    try {
      const exitCode = await checkCommitCommand(file, options);
      process.exit(exitCode);
    } catch (error) {
      handleError(error);
    }
  });

// conform process scan --repo owner/repo
processCommand
  .command("scan")
  .description("Scan remote repository settings via GitHub API")
  .addOption(
    new Option(
      "-r, --repo <owner/repo>",
      "Remote repository in owner/repo format"
    ).makeOptionMandatory()
  )
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action(async (options: { repo: string; config?: string; format: string }) => {
    const { runScan } = await import("./process/scan/index.js");
    await runScan({
      repo: options.repo,
      config: options.config,
      format: options.format as "text" | "json",
    });
  });

program.addCommand(processCommand);

// =============================================================================
// Dependencies command
// =============================================================================

// conform dependencies - list config files tracked by enabled checks
program
  .command("dependencies")
  .description("List config files tracked by enabled checks (for drift-toolkit)")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .option("--check <name>", "Filter to specific check (e.g., eslint)")
  .option("--project <path>", "Monorepo project path")
  .action(
    async (options: { config?: string; format: string; check?: string; project?: string }) => {
      try {
        await runDependencies(options as DependenciesOptions);
        process.exit(ExitCode.SUCCESS);
      } catch (error) {
        handleError(error);
      }
    }
  );

// =============================================================================
// Projects subcommand
// =============================================================================

const projectsCommand = configureExitOverride(
  new Command("projects").description("Project management utilities")
);

// conform projects detect
projectsCommand
  .command("detect")
  .description("Discover projects and show which have/don't have standards.toml")
  .option("--fix", "Create missing standards.toml files")
  .option("--dry-run", "Show what would be created without creating")
  .option("--registry <path>", "Create shared registry and extend from it")
  .option("--show-status", "Show tier from repo-metadata.yaml")
  .option("--missing-config", "Filter to projects without standards.toml")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action(async (options) => {
    try {
      await runDetect(options as DetectOptions);
      process.exit(ExitCode.SUCCESS);
    } catch (error) {
      handleError(error);
    }
  });

program.addCommand(projectsCommand);

// =============================================================================
// Infra subcommand
// =============================================================================

const infraCommand = configureExitOverride(
  new Command("infra").description("Infrastructure resource verification")
);

// conform infra scan
infraCommand
  .command("scan")
  .description("Verify AWS resources declared in manifest exist")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .option("-m, --manifest <path>", "Path to manifest file (overrides config)")
  .option("-a, --account <name>", "Filter to specific account (by alias or account key like 'aws:123')")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action(async (options: { config?: string; manifest?: string; account?: string; format: string }) => {
    const { runInfraScan } = await import("./infra/index.js");
    await runInfraScan({
      configPath: options.config,
      manifestPath: options.manifest,
      account: options.account,
      format: options.format as "text" | "json",
    });
  });

// conform infra generate
infraCommand
  .command("generate")
  .description("Generate infra-manifest.json from Pulumi stack export")
  .option("-i, --input <path>", "Input file (reads from stdin if not provided)")
  .option("-o, --output <path>", "Output file path (default: infra-manifest.json)")
  .option("-p, --project <name>", "Project name (extracted from stack if not provided)")
  .option("-a, --account <alias>", "Account alias (e.g., 'prod-aws')")
  .option("--account-id <id>", "Explicit account ID (e.g., 'aws:111111111111')")
  .option("--merge", "Merge into existing manifest instead of overwriting")
  .option("--stdout", "Output to stdout instead of file")
  .action(
    async (options: {
      input?: string;
      output?: string;
      project?: string;
      account?: string;
      accountId?: string;
      merge?: boolean;
      stdout?: boolean;
    }) => {
      const { runInfraGenerate } = await import("./infra/index.js");
      await runInfraGenerate(options);
    }
  );

program.addCommand(infraCommand);

// =============================================================================
// Top-level aliases (run all domains)
// =============================================================================

// conform check - run all domain checks
program
  .command("check")
  .description("Run all checks (code + process)")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action((options: { config?: string; format: string }) => runCheck(options));

// conform audit - run all domain audits
program
  .command("audit")
  .description("Verify all configs exist (code + process)")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action((options) => runAudit(options));

// =============================================================================
// MCP Server
// =============================================================================

// conform mcp - start MCP server for coding standards
program
  .command("mcp")
  .description("Start MCP server for coding standards (for Claude Desktop integration)")
  .action(async () => {
    try {
      const { startServer } = await import("./mcp/index.js");
      await startServer();
    } catch (error) {
      handleError(error);
    }
  });

program.parse();
