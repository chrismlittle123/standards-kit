import { Command } from "commander";
import { scan } from "./scan.js";
import { DEFAULTS } from "../../constants.js";

/**
 * Register process domain commands on the given program
 */
export function registerProcessCommands(program: Command): void {
  program
    .command("scan")
    .description("Scan repository for process standard violations")
    .option("-r, --repo <owner/repo>", "Repository to scan (owner/repo format)")
    .option(
      "-o, --org <org>",
      "Organization or user to discover repos with standards.toml"
    )
    .option("-c, --config <path>", "Path to standards.toml config file")
    .option("--json", "Output results as JSON")
    .option(
      "-n, --dry-run",
      "Show what issues would be created without creating them"
    )
    .option(
      "--all",
      "Scan all repos regardless of recent commit activity (with --org)"
    )
    .option(
      "--since <hours>",
      `Only scan repos with commits in the last N hours (default: ${DEFAULTS.commitWindowHours})`,
      String(DEFAULTS.commitWindowHours)
    )
    .action(scan);
}
