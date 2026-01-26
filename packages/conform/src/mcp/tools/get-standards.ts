/**
 * MCP tool: get_standards
 * Gets composed coding standards matching a context string
 */
import { z } from "zod";

import {
  fetchStandardsRepo,
  fetchStandardsRepoFromSource,
  getGuidelinesDir,
  loadAllGuidelines,
  matchGuidelines,
  composeGuidelines,
} from "../standards/index.js";

/** Input schema for get_standards tool */
export const getStandardsInputSchema = {
  context: z
    .string()
    .describe(
      'Context string describing the task or technology stack (e.g., "python fastapi llm postgresql")'
    ),
  limit: z.number().optional().describe("Maximum number of guidelines to return (default: 5)"),
};

/** Handler result type - must have index signature for MCP SDK */
interface HandlerResult {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
}

/**
 * Create a get_standards handler with optional custom source.
 * @param source - Optional standards source (e.g., "github:owner/repo" or local path)
 */
export function createGetStandardsHandler(
  source?: string
): (args: { context: string; limit?: number }) => Promise<HandlerResult> {
  return async (args) => {
    const repoPath = source
      ? await fetchStandardsRepoFromSource(source)
      : await fetchStandardsRepo();
    const guidelinesDir = getGuidelinesDir(repoPath);
    const guidelines = loadAllGuidelines(guidelinesDir);

    const limit = args.limit ?? 5;
    const matches = matchGuidelines(guidelines, args.context, limit);

    const composed = composeGuidelines(matches);

    // Add summary header
    const summary =
      matches.length > 0
        ? `Found ${matches.length} matching guideline(s) for context: "${args.context}"\n\nMatched guidelines (by relevance):\n${matches.map((m) => `- ${m.guideline.title} (score: ${m.score.toFixed(1)})`).join("\n")}\n\n---\n\n`
        : "";

    return {
      content: [
        {
          type: "text",
          text: summary + composed,
        },
      ],
    };
  };
}
