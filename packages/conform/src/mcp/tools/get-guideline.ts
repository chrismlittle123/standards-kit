/**
 * MCP tool: get_guideline
 * Gets a single coding guideline by ID
 */
import { z } from "zod";

import {
  fetchStandardsRepo,
  fetchStandardsRepoFromSource,
  getGuidelinesDir,
  loadGuideline,
} from "../standards/index.js";

/** Input schema for get_guideline tool */
export const getGuidelineInputSchema = {
  id: z.string().describe('Guideline ID (e.g., "auth", "database", "typescript")'),
};

/** Handler result type - must have index signature for MCP SDK */
interface HandlerResult {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/**
 * Create a get_guideline handler with optional custom source.
 * @param source - Optional standards source (e.g., "github:owner/repo" or local path)
 */
export function createGetGuidelineHandler(
  source?: string
): (args: { id: string }) => Promise<HandlerResult> {
  return async (args) => {
    const repoPath = source
      ? await fetchStandardsRepoFromSource(source)
      : await fetchStandardsRepo();
    const guidelinesDir = getGuidelinesDir(repoPath);
    const guideline = loadGuideline(guidelinesDir, args.id);

    if (!guideline) {
      return {
        content: [
          {
            type: "text",
            text: `Guideline not found: ${args.id}`,
          },
        ],
        isError: true,
      };
    }

    // Return full markdown content with frontmatter info
    const header = `# ${guideline.title}\n\n**Category:** ${guideline.category} | **Priority:** ${guideline.priority}\n**Tags:** ${guideline.tags.join(", ")}\n\n---\n\n`;

    return {
      content: [
        {
          type: "text",
          text: header + guideline.content,
        },
      ],
    };
  };
}
