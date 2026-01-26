/**
 * MCP Server for coding standards
 *
 * Provides tools for Claude to fetch and compose coding standards from palindrom-ai/standards.
 */
export { createServer, startServer } from "./server.js";
export type { Guideline, GuidelineListItem, GuidelineFrontmatter, Ruleset } from "./standards/types.js";
