import { Command, Option } from "commander";

import { checkBranchCommand, checkCommitCommand } from "../process/commands/index.js";
import { configureExitOverride, handleError, runAudit, runCheck } from "./utils.js";

export function createProcessCommand(version: string): Command {
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
    .action((options) => runCheck(version, options, "process"));

  // conform process audit
  processCommand
    .command("audit")
    .description("Verify workflow configs exist")
    .option("-c, --config <path>", "Path to standards.toml config file")
    .addOption(
      new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
    )
    .action((options) => runAudit(version, options, "process"));

  // conform process diff
  processCommand
    .command("diff")
    .description("Show repository setting differences (current vs. config)")
    .option("-c, --config <path>", "Path to standards.toml config file")
    .addOption(
      new Option("-f, --format <format>", "Output format").choices(["text", "json"]).default("text")
    )
    .action(async (options: { config?: string; format: string }) => {
      const { runDiff } = await import("../process/sync/index.js");
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
        const { runSync } = await import("../process/sync/index.js");
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
      const { runTagDiff } = await import("../process/sync/index.js");
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
      const { runTagSync } = await import("../process/sync/index.js");
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
      const { runScan } = await import("../process/scan/index.js");
      await runScan({
        repo: options.repo,
        config: options.config,
        format: options.format as "text" | "json",
      });
    });

  return processCommand;
}
