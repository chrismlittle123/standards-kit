/**
 * MCP tool: list_guidelines
 * Lists all available coding guidelines with optional category filter
 */
import { z } from "zod";

import {
  fetchStandardsRepo,
  fetchStandardsRepoFromSource,
  getGuidelinesDir,
  loadAllGuidelines,
  toListItems,
} from "../standards/index.js";

/** Input schema for list_guidelines tool */
export const listGuidelinesInputSchema = {
  category: z.string().optional().describe("Optional category filter (e.g., 'security', 'infrastructure')"),
};

/** Handler result type - must have index signature for MCP SDK */
interface HandlerResult {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
}

/**
 * Create a list_guidelines handler with optional custom source.
 * @param source - Optional standards source (e.g., "github:owner/repo" or local path)
 */
export function createListGuidelinesHandler(
  source?: string
): (args: { category?: string }) => Promise<HandlerResult> {
  return async (args) => {
    const repoPath = source
      ? await fetchStandardsRepoFromSource(source)
      : await fetchStandardsRepo();
    const guidelinesDir = getGuidelinesDir(repoPath);
    let guidelines = loadAllGuidelines(guidelinesDir);

    // Filter by category if provided
    if (args.category) {
      const categoryLower = args.category.toLowerCase();
      guidelines = guidelines.filter((g) => g.category.toLowerCase() === categoryLower);
    }

    const items = toListItems(guidelines);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(items, null, 2),
        },
      ],
    };
  };
}
