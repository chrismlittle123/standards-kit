import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

import { execa } from "execa";
import * as fs from "node:fs";
import { ESLintRunner } from "../../../../src/code/tools/eslint.js";

const mockExeca = vi.mocked(execa);
const mockExistsSync = vi.mocked(fs.existsSync);

describe("ESLintRunner", () => {
  let runner: ESLintRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new ESLintRunner();
  });

  describe("run", () => {
    it("returns failNoConfig when no eslint config exists", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Config not found");
    });

    it("returns pass when eslint reports no issues", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("eslint.config.js")
      );
      mockExeca.mockResolvedValue({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("parses ESLint JSON output and returns violations", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("eslint.config.js")
      );

      const eslintOutput = JSON.stringify([
        {
          filePath: "/project/src/index.ts",
          messages: [
            {
              ruleId: "no-unused-vars",
              severity: 2,
              message: "x is defined but never used",
              line: 5,
              column: 7,
            },
            {
              ruleId: "semi",
              severity: 1,
              message: "Missing semicolon",
              line: 10,
              column: 1,
            },
          ],
        },
      ]);

      mockExeca.mockResolvedValue({
        stdout: eslintOutput,
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].message).toBe("x is defined but never used");
      expect(result.violations[0].code).toBe("no-unused-vars");
      expect(result.violations[0].severity).toBe("error");
      expect(result.violations[0].file).toBe("src/index.ts");
      expect(result.violations[0].line).toBe(5);
      expect(result.violations[1].severity).toBe("warning");
    });

    it("returns error violation when output is not JSON and exit code is non-zero", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("eslint.config.js")
      );
      mockExeca.mockResolvedValue({
        stdout: "not json",
        stderr: "Configuration error",
        exitCode: 2,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("ESLint error");
    });

    it("returns skip when eslint is not installed (ENOENT)", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("eslint.config.js")
      );
      mockExeca.mockRejectedValue(new Error("spawn npx ENOENT"));

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("not installed");
    });

    it("returns error violation on unexpected errors", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("eslint.config.js")
      );
      mockExeca.mockRejectedValue(new Error("timeout exceeded"));

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("ESLint error");
      expect(result.violations[0].message).toContain("timeout exceeded");
    });

    it("passes configured files and ignore patterns to eslint", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("eslint.config.js")
      );
      runner.setConfig({
        files: ["src/**/*.ts"],
        ignore: ["**/*.test.ts"],
        "max-warnings": 0,
      });
      mockExeca.mockResolvedValue({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      await runner.run("/project");

      expect(mockExeca).toHaveBeenCalledWith(
        "npx",
        expect.arrayContaining([
          "eslint",
          "src/**/*.ts",
          "--format",
          "json",
          "--ignore-pattern",
          "**/*.test.ts",
          "--max-warnings",
          "0",
        ]),
        expect.any(Object)
      );
    });

    it("handles null ruleId in ESLint messages", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("eslint.config.js")
      );

      const eslintOutput = JSON.stringify([
        {
          filePath: "/project/src/bad.ts",
          messages: [
            {
              ruleId: null,
              severity: 2,
              message: "Parsing error: Unexpected token",
              line: 1,
              column: 1,
            },
          ],
        },
      ]);

      mockExeca.mockResolvedValue({
        stdout: eslintOutput,
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.violations[0].code).toBeUndefined();
    });
  });
});
