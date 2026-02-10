import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("glob", () => ({
  glob: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { glob } from "glob";
import * as fs from "node:fs";
import { DisableCommentsRunner } from "../../../../src/code/tools/disable-comments.js";

const mockGlob = vi.mocked(glob);
const mockReadFileSync = vi.mocked(fs.readFileSync);

describe("DisableCommentsRunner", () => {
  let runner: DisableCommentsRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new DisableCommentsRunner();
  });

  describe("run", () => {
    it("passes when no files are found", async () => {
      mockGlob.mockResolvedValue([]);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("passes when files have no disable comments", async () => {
      mockGlob.mockResolvedValue(["src/clean.ts"]);
      mockReadFileSync.mockReturnValue('const x = 1;\nconst y = "hello";\n');

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
    });

    it("detects eslint-disable comments", async () => {
      mockGlob.mockResolvedValue(["src/bad.ts"]);
      mockReadFileSync.mockReturnValue(
        '// eslint-disable-next-line no-unused-vars\nconst x = 1;\n'
      );

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("eslint-disable-next-line");
      expect(result.violations[0].line).toBe(1);
    });

    it("detects @ts-ignore comments", async () => {
      mockGlob.mockResolvedValue(["src/bad.ts"]);
      mockReadFileSync.mockReturnValue(
        '// @ts-ignore\nconst x: number = "not a number";\n'
      );

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("@ts-ignore");
    });

    it("detects Python noqa comments", async () => {
      mockGlob.mockResolvedValue(["src/bad.py"]);
      mockReadFileSync.mockReturnValue("import os  # noqa\n");

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("# noqa");
    });

    it("detects @ts-expect-error comments", async () => {
      mockGlob.mockResolvedValue(["src/bad.ts"]);
      mockReadFileSync.mockReturnValue("// @ts-expect-error\nconst x = bad;\n");

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("@ts-expect-error");
    });

    it("uses custom patterns from config", async () => {
      runner.setConfig({ patterns: ["FIXME"] });
      mockGlob.mockResolvedValue(["src/file.ts"]);
      mockReadFileSync.mockReturnValue("// FIXME: this is broken\n");

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("FIXME");
    });

    it("handles file read errors gracefully", async () => {
      mockGlob.mockResolvedValue(["src/unreadable.ts"]);
      mockReadFileSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = await runner.run("/project");

      // Unreadable files are silently skipped
      expect(result.passed).toBe(true);
    });

    it("returns error violation on glob failure", async () => {
      mockGlob.mockRejectedValue(new Error("glob error"));

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Disable comments check error");
    });

    it("detects multiple violations in a single file", async () => {
      mockGlob.mockResolvedValue(["src/messy.ts"]);
      mockReadFileSync.mockReturnValue(
        [
          "// eslint-disable-next-line",
          "const a = 1;",
          "// @ts-ignore",
          "const b = bad;",
        ].join("\n")
      );

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });
  });
});
