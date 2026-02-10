vi.mock("node:fs");
vi.mock("execa");
vi.mock("glob");

import * as fs from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";
import { glob } from "glob";

import { DocsRunner } from "../../../../src/process/tools/docs.js";

const mockedFs = vi.mocked(fs);
const mockedExeca = vi.mocked(execa);
const mockedGlob = vi.mocked(glob);

beforeEach(() => vi.clearAllMocks());

/** Helper to set up filesystem mocks */
function setupFs(files: Map<string, string>): void {
  mockedFs.existsSync.mockImplementation((p) => files.has(String(p)));
  mockedFs.statSync.mockImplementation((p) => {
    const content = files.get(String(p));
    return {
      isDirectory: () => false,
      isFile: () => files.has(String(p)),
      size: content ? content.length : 0,
    } as fs.Stats;
  });
  mockedFs.readFileSync.mockImplementation((p) => {
    const content = files.get(String(p));
    if (content === undefined) {
      throw new Error("ENOENT");
    }
    return content;
  });
}

describe("DocsRunner", () => {
  let runner: DocsRunner;

  beforeEach(() => {
    runner = new DocsRunner();
    // Default: glob returns empty
    mockedGlob.mockResolvedValue([] as never);
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("Documentation");
    expect(runner.rule).toBe("process.docs");
    expect(runner.toolId).toBe("docs");
  });

  describe("pass cases", () => {
    it("passes when no issues found", async () => {
      runner.setConfig({ enabled: true });
      setupFs(new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });

  describe("structure validation", () => {
    it("warns when markdown file is outside docs path and not allowlisted", async () => {
      runner.setConfig({ enabled: true, path: "docs/", enforcement: "warn" });
      // First glob call for structure check returns all md files
      mockedGlob.mockResolvedValue(["stray.md", "docs/guide.md"] as never);
      setupFs(new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("not allowlisted"))).toBe(true);
      expect(result.violations[0].severity).toBe("warning");
    });

    it("passes when outside file is allowlisted", async () => {
      runner.setConfig({
        enabled: true,
        path: "docs/",
        allowlist: ["README.md"],
      });
      mockedGlob.mockResolvedValue(["README.md", "docs/guide.md"] as never);
      setupFs(new Map());

      const result = await runner.run("/root");
      // No structure violations for README.md
      expect(
        result.violations.filter(
          (v) => v.rule.includes("structure") && v.file === "README.md"
        )
      ).toHaveLength(0);
    });

    it("warns when max_files exceeded", async () => {
      runner.setConfig({ enabled: true, path: "docs/", max_files: 1 });
      mockedGlob.mockResolvedValue(["docs/a.md", "docs/b.md"] as never);
      setupFs(new Map());

      const result = await runner.run("/root");
      expect(result.violations.some((v) => v.message.includes("max allowed is 1"))).toBe(true);
    });

    it("warns when max_file_lines exceeded", async () => {
      runner.setConfig({ enabled: true, path: "docs/", max_file_lines: 10 });
      const longContent = Array(20).fill("line").join("\n");
      mockedGlob.mockResolvedValue(["docs/long.md"] as never);
      setupFs(new Map([["/root/docs/long.md", longContent]]));

      const result = await runner.run("/root");
      expect(result.violations.some((v) => v.message.includes("lines, max allowed"))).toBe(true);
    });
  });

  describe("content validation", () => {
    it("reports missing required frontmatter fields", async () => {
      runner.setConfig({
        enabled: true,
        path: "docs/",
        types: {
          guide: { frontmatter: ["title", "author"] },
        },
      });
      const md = `---
type: guide
title: Test
---

# Test
`;
      // Structure check glob - returns docs files
      mockedGlob
        .mockResolvedValueOnce(["docs/test.md"] as never)
        // Content check glob
        .mockResolvedValueOnce(["docs/test.md"] as never)
        // Freshness glob
        .mockResolvedValueOnce([] as never);
      setupFs(new Map([["/root/docs/test.md", md]]));

      const result = await runner.run("/root");
      expect(result.violations.some((v) => v.message.includes("Missing required frontmatter field: author"))).toBe(true);
    });

    it("reports missing required sections", async () => {
      runner.setConfig({
        enabled: true,
        path: "docs/",
        types: {
          guide: { required_sections: ["Getting Started", "API Reference"] },
        },
      });
      const md = `---
type: guide
---

# Guide

## Getting Started

Content here.
`;
      mockedGlob
        .mockResolvedValueOnce(["docs/test.md"] as never)
        .mockResolvedValueOnce(["docs/test.md"] as never)
        .mockResolvedValueOnce([] as never);
      setupFs(new Map([["/root/docs/test.md", md]]));

      const result = await runner.run("/root");
      expect(result.violations.some((v) => v.message.includes("Missing required section: API Reference"))).toBe(true);
    });

    it("reports broken internal links", async () => {
      runner.setConfig({
        enabled: true,
        path: "docs/",
        types: { guide: {} },
      });
      const md = `---
type: guide
---

[Broken link](./missing.md)
[External](https://example.com)
`;
      mockedGlob
        .mockResolvedValueOnce(["docs/test.md"] as never)
        .mockResolvedValueOnce(["docs/test.md"] as never)
        .mockResolvedValueOnce([] as never);
      setupFs(new Map([["/root/docs/test.md", md]]));
      // existsSync called for link check; the broken link target won't exist
      mockedFs.existsSync.mockImplementation((p) => {
        const s = String(p);
        // Only the test.md file exists
        return s === "/root/docs/test.md";
      });

      const result = await runner.run("/root");
      expect(result.violations.some((v) => v.rule.includes("links"))).toBe(true);
    });
  });

  describe("freshness", () => {
    it("reports stale documentation", async () => {
      runner.setConfig({
        enabled: true,
        path: "docs/",
        staleness_days: 30,
      });
      const md = `---
tracks: src/api/index.ts
---

# API
`;
      // Structure glob ("**/*.md"), content glob ("docs/**/*.md"), freshness glob ("docs/**/*.md")
      mockedGlob.mockImplementation(((pattern: string) => {
        if (pattern === "**/*.md") {
          return Promise.resolve(["docs/api.md"]);
        }
        if (pattern.startsWith("docs/")) {
          return Promise.resolve(["docs/api.md"]);
        }
        return Promise.resolve([]);
      }) as typeof glob);
      setupFs(new Map([["/root/docs/api.md", md]]));
      mockedFs.existsSync.mockImplementation((p) => {
        const s = String(p);
        return s === "/root/docs/api.md" || s === "/root/src/api/index.ts";
      });

      // doc modified 60 days ago, source modified 1 day ago
      const now = Math.floor(Date.now() / 1000);
      const docTimestamp = now - 60 * 24 * 60 * 60;
      const sourceTimestamp = now - 1 * 24 * 60 * 60;
      mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
        if (cmd === "git") {
          const filePath = args[args.length - 1];
          if (filePath.includes("api.md")) {
            return Promise.resolve({ stdout: String(docTimestamp) });
          }
          return Promise.resolve({ stdout: String(sourceTimestamp) });
        }
        return Promise.reject(new Error("unexpected"));
      }) as typeof execa);

      const result = await runner.run("/root");
      expect(result.violations.some((v) => v.rule.includes("freshness"))).toBe(true);
    });
  });

  describe("API coverage", () => {
    it("reports when coverage is below minimum", async () => {
      runner.setConfig({
        enabled: true,
        path: "docs/",
        min_coverage: 100,
        coverage_paths: ["src/**/*.ts"],
      });
      mockedGlob.mockImplementation(((pattern: string) => {
        if (pattern === "**/*.md") {
          return Promise.resolve([]);
        }
        if (pattern === "src/**/*.ts") {
          return Promise.resolve(["src/index.ts"]);
        }
        if (pattern.startsWith("docs/")) {
          return Promise.resolve(["docs/api.md"]);
        }
        return Promise.resolve([]);
      }) as typeof glob);

      setupFs(
        new Map([
          ["/root/src/index.ts", "export function undocumentedFn() {}"],
          ["/root/docs/api.md", "# API\n\nSome docs without mentioning exports."],
        ])
      );

      const result = await runner.run("/root");
      expect(result.violations.some((v) => v.rule.includes("coverage"))).toBe(true);
    });

    it("passes when all exports are documented", async () => {
      runner.setConfig({
        enabled: true,
        path: "docs/",
        min_coverage: 100,
        coverage_paths: ["src/**/*.ts"],
      });
      mockedGlob.mockImplementation(((pattern: string) => {
        if (pattern === "**/*.md") {
          return Promise.resolve([]);
        }
        if (pattern === "src/**/*.ts") {
          return Promise.resolve(["src/index.ts"]);
        }
        if (pattern.startsWith("docs/")) {
          return Promise.resolve(["docs/api.md"]);
        }
        return Promise.resolve([]);
      }) as typeof glob);

      setupFs(
        new Map([
          ["/root/src/index.ts", "export function myFunction() {}"],
          ["/root/docs/api.md", "# API\n\nThe myFunction does something."],
        ])
      );

      const result = await runner.run("/root");
      expect(result.violations.filter((v) => v.rule.includes("coverage"))).toHaveLength(0);
    });

    it("skips coverage check when min_coverage not set", async () => {
      runner.setConfig({ enabled: true, path: "docs/" });
      setupFs(new Map());

      const result = await runner.run("/root");
      expect(result.violations.filter((v) => v.rule.includes("coverage"))).toHaveLength(0);
    });
  });

  describe("enforcement modes", () => {
    it("uses error severity when enforcement is block", async () => {
      runner.setConfig({ enabled: true, path: "docs/", enforcement: "block" });
      mockedGlob.mockImplementation(((pattern: string) => {
        if (pattern === "**/*.md") {
          return Promise.resolve(["stray.md"]);
        }
        return Promise.resolve([]);
      }) as typeof glob);
      setupFs(new Map());

      const result = await runner.run("/root");
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].severity).toBe("error");
    });

    it("uses warning severity when enforcement is warn", async () => {
      runner.setConfig({ enabled: true, path: "docs/", enforcement: "warn" });
      mockedGlob.mockImplementation(((pattern: string) => {
        if (pattern === "**/*.md") {
          return Promise.resolve(["stray.md"]);
        }
        return Promise.resolve([]);
      }) as typeof glob);
      setupFs(new Map());

      const result = await runner.run("/root");
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].severity).toBe("warning");
    });
  });
});
