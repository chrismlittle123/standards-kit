import { Command } from "commander";
import { scan } from "./scan.js";
import { DEFAULTS } from "../../constants.js";

/**
 * Register infra domain commands on the given program
 */
export function registerInfraCommands(program: Command): void {
  program
    .command("scan")
    .description("Scan infrastructure for drift between manifest and AWS")
    .option("-r, --repo <owner/repo>", "Repository to scan (owner/repo format)")
    .option(
      "-o, --org <org>",
      "Organization or user to discover repos with [infra] config"
    )
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
