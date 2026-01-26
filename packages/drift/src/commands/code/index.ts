import { Command } from "commander";
import { scan } from "./scan.js";

/**
 * Register code domain commands on the given program
 */
export function registerCodeCommands(program: Command): void {
  program
    .command("scan")
    .description("Scan repositories for configuration drift")
    .option(
      "-p, --path <path>",
      "Local directory to scan (default: current directory)"
    )
    .option("-c, --config <config>", "Path to drift.config.yaml")
    .option("-o, --org <org>", "GitHub organization or username to scan")
    .option("-r, --repo <repo>", "Single repository to scan (requires --org)")
    .option("--config-repo <repo>", "Config repo name (default: drift-config)")
    .option(
      "--github-token <token>",
      "GitHub token (or set GITHUB_TOKEN env var)"
    )
    .option("--json", "Output results as JSON")
    .option(
      "-n, --dry-run",
      "Show what issues would be created without creating them"
    )
    .option(
      "-a, --all",
      "Scan all repos regardless of commit activity (org scan only)"
    )
    .option(
      "--since <hours>",
      "Hours to look back for commits (default: 24, org scan only)",
      (value) => parseInt(value, 10)
    )
    .action(scan);
}
