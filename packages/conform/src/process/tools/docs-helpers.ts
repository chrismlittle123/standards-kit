import matter from "gray-matter";

/** Enforcement mode for documentation checks */
export type EnforcementMode = "block" | "warn";

/** Doc type configuration */
export interface DocTypeConfig {
  required_sections?: string[];
  frontmatter?: string[];
}

/** Documentation configuration from standards.toml */
export interface DocsConfig {
  enabled?: boolean;
  path?: string;
  enforcement?: EnforcementMode;
  allowlist?: string[];
  max_files?: number;
  max_file_lines?: number;
  max_total_kb?: number;
  staleness_days?: number;
  stale_mappings?: Record<string, string>;
  min_coverage?: number;
  coverage_paths?: string[];
  exclude_patterns?: string[];
  types?: Record<string, DocTypeConfig>;
}

/** Parsed frontmatter from a markdown file */
export interface ParsedDoc {
  filePath: string;
  frontmatter: Record<string, unknown>;
  content: string;
  headings: string[];
}

/** Export info from TypeScript file */
export interface ExportInfo {
  name: string;
  file: string;
  line: number;
}

/** Escape special regex characters in a string */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract heading text from markdown content */
function extractHeadings(content: string): string[] {
  const headingRegex = /^#{1,6}\s+(.+)$/gm;
  const headings: string[] = [];
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push(match[1].trim());
  }
  return headings;
}

/** Parse named export from a line */
function parseNamedExport(line: string): string | null {
  const match = /^export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/.exec(line);
  return match ? match[1] : null;
}

/** Parse default export from a line */
function parseDefaultExport(line: string): string | null {
  const match = /^export\s+default\s+(\w+)/.exec(line);
  if (match && !["function", "class", "async"].includes(match[1])) {
    return match[1];
  }
  return null;
}

/** Parse re-exports from a line */
function parseReExports(line: string): string[] {
  const match = /^export\s*\{\s*([^}]+)\s*\}/.exec(line);
  if (!match) {
    return [];
  }
  return match[1]
    .split(",")
    .map((n) => {
      const parts = n.trim().split(/\s+as\s+/);
      return parts[parts.length - 1].trim();
    })
    .filter((name) => name && !/^(type|interface)$/.test(name));
}

/** Parse a markdown file and extract frontmatter, content, headings */
export function parseMarkdownFile(content: string, filePath: string): ParsedDoc {
  const { data, content: mdContent } = matter(content);
  return {
    filePath,
    frontmatter: data,
    content: mdContent,
    headings: extractHeadings(mdContent),
  };
}

/** Process a single line and extract any exports */
function processLine(line: string, file: string, lineNumber: number): ExportInfo[] {
  const named = parseNamedExport(line);
  if (named) {
    return [{ name: named, file, line: lineNumber }];
  }

  const defaultExp = parseDefaultExport(line);
  if (defaultExp) {
    return [{ name: defaultExp, file, line: lineNumber }];
  }

  return parseReExports(line).map((name) => ({ name, file, line: lineNumber }));
}

/** Extract exports from file content */
export function extractFileExports(file: string, content: string): ExportInfo[] {
  return content.split("\n").flatMap((line, i) => processLine(line, file, i + 1));
}

/** Get the source path that a doc file tracks */
export function getTrackedPath(
  docFile: string,
  frontmatter: Record<string, unknown>,
  staleMappings: Record<string, string>,
  docsPath: string
): string | null {
  if (typeof frontmatter.tracks === "string") {
    return frontmatter.tracks;
  }
  if (Array.isArray(frontmatter.tracks) && frontmatter.tracks.length > 0) {
    return frontmatter.tracks[0] as string;
  }
  if (staleMappings[docFile]) {
    return staleMappings[docFile];
  }
  if (docFile.startsWith(docsPath)) {
    const baseName = docFile.slice(docsPath.length).replace(/\.md$/, "");
    return `src/${baseName}/`;
  }
  return null;
}
