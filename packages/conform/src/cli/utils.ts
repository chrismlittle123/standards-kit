import chalk from "chalk";
import { Command, type CommanderError } from "commander";

import { auditCodeConfig, runCodeChecks } from "../code/index.js";
import {
  ConfigError,
  getProjectRoot,
  loadConfigAsync,
} from "../core/index.js";
import { formatOutput, type OutputFormat } from "../output/index.js";
import { auditProcessConfig, runProcessChecks } from "../process/index.js";
import { type DomainResult, ExitCode, type FullResult } from "../core/index.js";

/**
 * Configure exitOverride for a Command to return proper exit codes.
 * Must be called on parent commands that have subcommands with options.
 */
export function configureExitOverride(cmd: Command): Command {
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

export type DomainFilter = "code" | "process" | undefined;

export function shouldRunDomain(filter: DomainFilter, domain: "code" | "process"): boolean {
  return !filter || filter === domain;
}

export function buildResult(
  version: string,
  configPath: string,
  domains: Record<string, DomainResult>
): FullResult {
  const totalViolations = Object.values(domains).reduce((sum, d) => sum + d.violationCount, 0);
  return {
    version,
    configPath,
    domains,
    summary: {
      totalViolations,
      exitCode: totalViolations > 0 ? ExitCode.VIOLATIONS_FOUND : ExitCode.SUCCESS,
    },
  };
}

export function handleError(error: unknown): never {
  if (error instanceof ConfigError) {
    console.error(chalk.red(`Config error: ${error.message}`));
    process.exit(ExitCode.CONFIG_ERROR);
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(chalk.red(`Error: ${message}`));
  process.exit(ExitCode.RUNTIME_ERROR);
}

export async function runCheck(
  version: string,
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

    const result = buildResult(version, configPath, domains);
    process.stdout.write(`${formatOutput(result, options.format as OutputFormat)}\n`);
    process.exit(result.summary.exitCode);
  } catch (error) {
    handleError(error);
  }
}

export async function runAudit(
  version: string,
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

    const result = buildResult(version, configPath, domains);
    process.stdout.write(`${formatOutput(result, options.format as OutputFormat)}\n`);
    process.exit(result.summary.exitCode);
  } catch (error) {
    handleError(error);
  }
}
