/**
 * Parser for guideline markdown files with YAML frontmatter
 */
import * as fs from "node:fs";
import * as path from "node:path";

import matter from "gray-matter";
import { z } from "zod";

import { type Guideline, type GuidelineListItem, type Ruleset } from "./types.js";
import { StandardsError } from "./fetcher.js";

/** Zod schema for validating guideline frontmatter */
export const frontmatterSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  priority: z.number(),
  tags: z.array(z.string()),
});

/**
 * Parse a guideline markdown file content into a Guideline object.
 */
export function parseGuideline(fileContent: string, filename: string): Guideline {
  const { data, content } = matter(fileContent);

  const result = frontmatterSchema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new StandardsError(`Invalid frontmatter in ${filename}: ${errors}`);
  }

  return {
    ...result.data,
    content: content.trim(),
  };
}

/**
 * Load all guidelines from a directory.
 */
export function loadAllGuidelines(guidelinesDir: string): Guideline[] {
  if (!fs.existsSync(guidelinesDir)) {
    throw new StandardsError(`Guidelines directory not found: ${guidelinesDir}`);
  }

  const files = fs.readdirSync(guidelinesDir).filter((f) => f.endsWith(".md"));
  const guidelines: Guideline[] = [];

  for (const file of files) {
    const filePath = path.join(guidelinesDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    try {
      guidelines.push(parseGuideline(content, file));
    } catch (error) {
      // Skip files that fail to parse, log warning
      console.warn(`Warning: Failed to parse guideline ${file}: ${error}`);
    }
  }

  return guidelines;
}

/**
 * Load a single guideline by ID.
 */
export function loadGuideline(guidelinesDir: string, id: string): Guideline | null {
  const filePath = path.join(guidelinesDir, `${id}.md`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return parseGuideline(content, `${id}.md`);
}

/**
 * Convert guidelines to list items (summary format).
 */
export function toListItems(guidelines: Guideline[]): GuidelineListItem[] {
  return guidelines.map((g) => ({
    id: g.id,
    title: g.title,
    tags: g.tags,
    category: g.category,
  }));
}

/**
 * Load a ruleset file by ID.
 */
export function loadRuleset(rulesetsDir: string, id: string): Ruleset | null {
  const filePath = path.join(rulesetsDir, `${id}.toml`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return { id, content };
}

/**
 * List all available ruleset IDs.
 */
export function listRulesets(rulesetsDir: string): string[] {
  if (!fs.existsSync(rulesetsDir)) {
    return [];
  }

  return fs
    .readdirSync(rulesetsDir)
    .filter((f) => f.endsWith(".toml"))
    .map((f) => f.replace(".toml", ""));
}
