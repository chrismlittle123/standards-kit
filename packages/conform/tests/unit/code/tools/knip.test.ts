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
import { KnipRunner } from "../../../../src/code/tools/knip.js";

const mockExeca = vi.mocked(execa);
const mockExistsSync = vi.mocked(fs.existsSync);

describe("KnipRunner", () => {
  let runner: KnipRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new KnipRunner();
  });

  describe("run", () => {
    it("returns pass when knip finds no issues", async () => {
      const knipOutput = JSON.stringify({
        files: [],
        issues: [],
      });

      mockExeca.mockResolvedValue({
        stdout: knipOutput,
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("reports unused files as violations", async () => {
      const knipOutput = JSON.stringify({
        files: ["src/unused-module.ts", "src/dead-code.ts"],
        issues: [],
      });

      mockExeca.mockResolvedValue({
        stdout: knipOutput,
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].message).toBe("Unused file");
      expect(result.violations[0].code).toBe("unused-file");
      expect(result.violations[0].severity).toBe("warning");
      expect(result.violations[0].file).toBe("src/unused-module.ts");
    });

    it("reports unused dependencies", async () => {
      const knipOutput = JSON.stringify({
        files: [],
        issues: [
          {
            file: "package.json",
            dependencies: [{ name: "lodash", line: 5, col: 3 }],
          },
        ],
      });

      mockExeca.mockResolvedValue({
        stdout: knipOutput,
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toBe("Unused dependency: lodash");
      expect(result.violations[0].code).toBe("unused-dependency");
    });

    it("reports unused exports", async () => {
      const knipOutput = JSON.stringify({
        files: [],
        issues: [
          {
            file: "src/utils.ts",
            exports: [{ name: "unusedHelper", line: 10, col: 1 }],
          },
        ],
      });

      mockExeca.mockResolvedValue({
        stdout: knipOutput,
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toBe("Unused export: unusedHelper");
      expect(result.violations[0].code).toBe("unused-export");
    });

    it("reports unlisted dependencies as errors", async () => {
      const knipOutput = JSON.stringify({
        files: [],
        issues: [
          {
            file: "src/index.ts",
            unlisted: [{ name: "missing-pkg", line: 1, col: 1 }],
          },
        ],
      });

      mockExeca.mockResolvedValue({
        stdout: knipOutput,
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].severity).toBe("error");
      expect(result.violations[0].code).toBe("unlisted-dependency");
    });

    it("returns error when output is not JSON and exit code is non-zero", async () => {
      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "Cannot find module 'knip'",
        exitCode: 1,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Knip error");
    });

    it("returns skip when knip is not installed (ENOENT)", async () => {
      mockExeca.mockRejectedValue(new Error("spawn npx ENOENT"));

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("not installed");
    });

    it("returns error violation on unexpected thrown errors", async () => {
      mockExeca.mockRejectedValue(new Error("network error"));

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Knip error");
      expect(result.violations[0].message).toContain("network error");
    });
  });

  describe("audit", () => {
    it("passes when package.json exists", async () => {
      mockExistsSync.mockReturnValue(true);

      const result = await runner.audit("/project");

      expect(result.passed).toBe(true);
    });

    it("fails when package.json does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await runner.audit("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("package.json not found");
    });
  });
});
