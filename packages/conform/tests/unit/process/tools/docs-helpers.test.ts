import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  escapeRegex,
  extractFileExports,
  getTrackedPath,
  parseMarkdownFile,
} from "../../../../src/process/tools/docs-helpers.js";

beforeEach(() => vi.clearAllMocks());

describe("docs-helpers", () => {
  describe("escapeRegex", () => {
    it("escapes special regex characters", () => {
      expect(escapeRegex("foo.bar")).toBe("foo\\.bar");
      expect(escapeRegex("a*b+c?")).toBe("a\\*b\\+c\\?");
      expect(escapeRegex("$100")).toBe("\\$100");
      expect(escapeRegex("test[0]")).toBe("test\\[0\\]");
    });

    it("returns plain strings unchanged", () => {
      expect(escapeRegex("foobar")).toBe("foobar");
    });
  });

  describe("parseMarkdownFile", () => {
    it("parses frontmatter and content", () => {
      const md = `---
title: Test
type: guide
---

# Heading One

Some content.

## Heading Two
`;
      const result = parseMarkdownFile(md, "docs/test.md");
      expect(result.filePath).toBe("docs/test.md");
      expect(result.frontmatter.title).toBe("Test");
      expect(result.frontmatter.type).toBe("guide");
      expect(result.headings).toContain("Heading One");
      expect(result.headings).toContain("Heading Two");
    });

    it("handles markdown without frontmatter", () => {
      const md = `# Just a heading

Some text.
`;
      const result = parseMarkdownFile(md, "README.md");
      expect(result.frontmatter).toEqual({});
      expect(result.headings).toContain("Just a heading");
    });

    it("extracts nested headings", () => {
      const md = `# H1
## H2
### H3
#### H4
`;
      const result = parseMarkdownFile(md, "test.md");
      expect(result.headings).toEqual(["H1", "H2", "H3", "H4"]);
    });
  });

  describe("extractFileExports", () => {
    it("extracts named exports", () => {
      const content = `export const foo = 1;
export function bar() {}
export class Baz {}
export interface MyInterface {}
export type MyType = string;
export enum MyEnum {}
`;
      const exports = extractFileExports("src/index.ts", content);
      const names = exports.map((e) => e.name);
      expect(names).toContain("foo");
      expect(names).toContain("bar");
      expect(names).toContain("Baz");
      expect(names).toContain("MyInterface");
      expect(names).toContain("MyType");
      expect(names).toContain("MyEnum");
    });

    it("extracts default exports", () => {
      const content = `export default MyComponent`;
      const exports = extractFileExports("src/comp.ts", content);
      expect(exports[0].name).toBe("MyComponent");
    });

    it("does not extract anonymous default exports", () => {
      const content = `export default function() {}`;
      const exports = extractFileExports("src/comp.ts", content);
      // "function" is in the skip list
      expect(exports).toHaveLength(0);
    });

    it("extracts re-exports", () => {
      const content = `export { foo, bar as baz } from './other';`;
      const exports = extractFileExports("src/index.ts", content);
      const names = exports.map((e) => e.name);
      expect(names).toContain("foo");
      expect(names).toContain("baz");
    });

    it("includes file and line info", () => {
      const content = `export const a = 1;
export const b = 2;
`;
      const exports = extractFileExports("src/index.ts", content);
      expect(exports[0].file).toBe("src/index.ts");
      expect(exports[0].line).toBe(1);
      expect(exports[1].line).toBe(2);
    });

    it("returns empty for non-export code", () => {
      const content = `const x = 1;\nfunction y() {}`;
      const exports = extractFileExports("src/internal.ts", content);
      expect(exports).toHaveLength(0);
    });
  });

  describe("getTrackedPath", () => {
    it("returns frontmatter tracks string", () => {
      const result = getTrackedPath(
        "docs/api.md",
        { tracks: "src/api/index.ts" },
        {},
        "docs/"
      );
      expect(result).toBe("src/api/index.ts");
    });

    it("returns first element of tracks array", () => {
      const result = getTrackedPath(
        "docs/api.md",
        { tracks: ["src/api/index.ts", "src/api/types.ts"] },
        {},
        "docs/"
      );
      expect(result).toBe("src/api/index.ts");
    });

    it("returns stale mapping when no frontmatter tracks", () => {
      const result = getTrackedPath(
        "docs/api.md",
        {},
        { "docs/api.md": "src/api/" },
        "docs/"
      );
      expect(result).toBe("src/api/");
    });

    it("derives path from docs path convention", () => {
      const result = getTrackedPath("docs/utils.md", {}, {}, "docs/");
      expect(result).toBe("src/utils/");
    });

    it("returns null for non-docs file with no mapping", () => {
      const result = getTrackedPath("README.md", {}, {}, "docs/");
      expect(result).toBeNull();
    });

    it("returns null for empty tracks array", () => {
      const result = getTrackedPath("docs/api.md", { tracks: [] }, {}, "docs/");
      // Falls through to stale_mappings or convention
      expect(result).toBe("src/api/");
    });
  });
});
