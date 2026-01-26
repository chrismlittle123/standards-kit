/**
 * MCP Server for coding standards
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfigAsync } from "../core/index.js";
import {
  createGetGuidelineHandler,
  getGuidelineInputSchema,
  createGetRulesetHandler,
  getRulesetInputSchema,
  createGetStandardsHandler,
  getStandardsInputSchema,
  createListGuidelinesHandler,
  listGuidelinesInputSchema,
} from "./tools/index.js";

/** Options for creating the MCP server */
export interface CreateServerOptions {
  /** Standards repository source (e.g., "github:owner/repo" or local path) */
  standardsSource?: string;
}

/**
 * Create and configure the MCP server with all tools registered.
 */
export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer({
    name: "cm-standards",
    version: "1.0.0",
  });

  const { standardsSource } = options;

  // Register get_standards tool - smart context matching
  server.registerTool("get_standards", {
    description:
      "Get composed coding standards matching a context string. Use this to fetch relevant guidelines for a specific technology stack or task.",
    inputSchema: getStandardsInputSchema,
  }, createGetStandardsHandler(standardsSource));

  // Register list_guidelines tool
  server.registerTool("list_guidelines", {
    description: "List all available coding guidelines with optional category filter.",
    inputSchema: listGuidelinesInputSchema,
  }, createListGuidelinesHandler(standardsSource));

  // Register get_guideline tool
  server.registerTool("get_guideline", {
    description: "Get a single coding guideline by its ID.",
    inputSchema: getGuidelineInputSchema,
  }, createGetGuidelineHandler(standardsSource));

  // Register get_ruleset tool
  server.registerTool("get_ruleset", {
    description:
      "Get a tool configuration ruleset by ID (e.g., typescript-production, python-internal).",
    inputSchema: getRulesetInputSchema,
  }, createGetRulesetHandler(standardsSource));

  return server;
}

/**
 * Start the MCP server with stdio transport.
 * Loads configuration from standards.toml to get the standards source.
 */
export async function startServer(): Promise<void> {
  let standardsSource: string | undefined;

  // Try to load config to get standards source
  try {
    const { config } = await loadConfigAsync();
    standardsSource = config.mcp?.standards?.source;
  } catch {
    // Config not found or invalid, use defaults
  }

  const server = createServer({ standardsSource });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
