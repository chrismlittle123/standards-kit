import * as fs from "node:fs";
import * as path from "node:path";

import chalk from "chalk";
import { Command, Option } from "commander";

import {
  ConfigError,
  type ConfigOverride,
  loadConfig,
} from "../core/index.js";
import { ExitCode } from "../core/index.js";
import { configureExitOverride, handleError } from "./utils.js";

interface RegistryError {
  file: string;
  error: string;
}

interface RegistryValidation {
  count: number;
  errors: RegistryError[];
}

interface RegistryResult {
  valid: boolean;
  rulesetsCount: number;
  errors: RegistryError[];
}

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

export function createValidateCommand(): Command {
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
        const { loadConfigWithOverrides } = await import("../core/index.js");
        const { configPath, overrides } = await loadConfigWithOverrides(options.config);
        outputValidateResult(configPath, overrides, options);
        process.exit(ExitCode.SUCCESS);
      } catch (error) {
        handleValidateError(error, options.format);
      }
    });

  // conform validate registry - validate registry structure
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
          await import("../validate/index.js");
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
        const { runValidateGuidelines } = await import("../validate/index.js");
        await runValidateGuidelines(dirPath, options);
      } catch (error) {
        handleError(error);
      }
    });

  return validateCommand;
}
