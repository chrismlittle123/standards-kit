#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Command, Option } from "commander";
import { z } from "zod";

import { configSchema, ExitCode } from "./core/index.js";
import { type DependenciesOptions, runDependencies } from "./dependencies/index.js";
import { type DetectOptions, runDetect } from "./projects/index.js";
import {
  configureExitOverride,
  createProcessCommand,
  createValidateCommand,
  handleError,
  runAudit,
  runCheck,
} from "./cli/index.js";

// Read version from package.json to avoid hardcoding
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(__dirname, "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { version: string };
const VERSION = packageJson.version;

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
// Validate subcommand
// =============================================================================

program.addCommand(createValidateCommand());

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
    const jsonSchema = z.toJSONSchema(configSchema, {
      reused: "inline",
    });
    process.stdout.write(`${JSON.stringify(jsonSchema, null, 2)}\n`);
  });

// conform schema guidelines - output guideline frontmatter JSON schema
schemaCommand
  .command("guidelines")
  .description("Output JSON schema for guideline frontmatter")
  .action(async () => {
    const { frontmatterSchema } = await import("./mcp/standards/index.js");
    const jsonSchema = z.toJSONSchema(frontmatterSchema, {
      reused: "inline",
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
  .action((options) => runCheck(VERSION, options, "code"));

// conform code audit
codeCommand
  .command("audit")
  .description("Verify linting and type checking configs exist")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action((options) => runAudit(VERSION, options, "code"));

program.addCommand(codeCommand);

// =============================================================================
// Process subcommand
// =============================================================================

program.addCommand(createProcessCommand(VERSION));

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
  .action((options: { config?: string; format: string }) => runCheck(VERSION, options));

// conform audit - run all domain audits
program
  .command("audit")
  .description("Verify all configs exist (code + process)")
  .option("-c, --config <path>", "Path to standards.toml config file")
  .addOption(
    new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
  )
  .action((options) => runAudit(VERSION, options));

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
