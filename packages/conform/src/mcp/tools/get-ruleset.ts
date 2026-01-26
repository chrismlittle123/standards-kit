/**
 * MCP tool: get_ruleset
 * Gets a tool configuration ruleset by ID
 */
import { z } from "zod";

import {
  fetchStandardsRepo,
  fetchStandardsRepoFromSource,
  getRulesetsDir,
  loadRuleset,
  listRulesets,
} from "../standards/index.js";

/** Input schema for get_ruleset tool */
export const getRulesetInputSchema = {
  id: z.string().describe('Ruleset ID (e.g., "typescript-production", "python-internal")'),
};

/** Handler result type - must have index signature for MCP SDK */
interface HandlerResult {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/**
 * Create a get_ruleset handler with optional custom source.
 * @param source - Optional standards source (e.g., "github:owner/repo" or local path)
 */
export function createGetRulesetHandler(
  source?: string
): (args: { id: string }) => Promise<HandlerResult> {
  return async (args) => {
    const repoPath = source
      ? await fetchStandardsRepoFromSource(source)
      : await fetchStandardsRepo();
    const rulesetsDir = getRulesetsDir(repoPath);
    const ruleset = loadRuleset(rulesetsDir, args.id);

    if (!ruleset) {
      const available = listRulesets(rulesetsDir);
      return {
        content: [
          {
            type: "text",
            text: `Ruleset not found: ${args.id}\n\nAvailable rulesets:\n${available.map((r) => `- ${r}`).join("\n")}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `# Ruleset: ${ruleset.id}\n\n\`\`\`toml\n${ruleset.content}\n\`\`\``,
        },
      ],
    };
  };
}
