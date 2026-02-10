import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    lstatSync: vi.fn(),
  };
});

import { execa } from "execa";
import * as fs from "node:fs";
import { RuffRunner } from "../../../../src/code/tools/ruff.js";

const mockExeca = vi.mocked(execa);
const mockExistsSync = vi.mocked(fs.existsSync);

describe("RuffRunner", () => {
  let runner: RuffRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new RuffRunner();
  });

  describe("run", () => {
    it("skips when no Python files found", async () => {
      // First execa call is `find` for Python files
      mockExeca.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe("No Python files found");
    });

    it("returns pass when ruff finds no issues", async () => {
      // find returns Python files
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      // ruff check returns empty array
      mockExeca.mockResolvedValueOnce({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("parses ruff JSON output and returns violations", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const ruffOutput = JSON.stringify([
        {
          code: "F401",
          message: "`os` imported but unused",
          filename: "/project/main.py",
          location: { row: 1, column: 8 },
        },
        {
          code: "E501",
          message: "Line too long (120 > 88 characters)",
          filename: "/project/utils.py",
          location: { row: 15, column: 89 },
        },
      ]);

      mockExeca.mockResolvedValueOnce({
        stdout: ruffOutput,
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].code).toBe("F401");
      expect(result.violations[0].message).toBe("`os` imported but unused");
      expect(result.violations[0].file).toBe("main.py");
      expect(result.violations[0].line).toBe(1);
      expect(result.violations[0].column).toBe(8);
    });

    it("returns error when output is not JSON and exit code is non-zero", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: "not json",
        stderr: "Ruff configuration error",
        exitCode: 2,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Ruff error");
    });

    it("returns skip when ruff binary is not found (ENOENT)", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExeca.mockRejectedValueOnce(new Error("spawn ruff ENOENT"));

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("not installed");
    });

    it("returns error violation on unexpected errors", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExeca.mockRejectedValueOnce(new Error("timeout exceeded"));

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Ruff error");
    });

    it("passes empty stdout as no violations", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
    });

    it("passes CLI args from config", async () => {
      runner.setConfig({
        "line-length": 120,
        lint: {
          select: ["E", "F"],
          ignore: ["E501"],
        },
      });

      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      await runner.run("/project");

      expect(mockExeca).toHaveBeenCalledWith(
        "ruff",
        expect.arrayContaining([
          "check",
          ".",
          "--output-format",
          "json",
          "--line-length",
          "120",
          "--select",
          "E,F",
          "--ignore",
          "E501",
        ]),
        expect.any(Object)
      );
    });
  });

  describe("audit", () => {
    it("passes when ruff.toml exists", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("ruff.toml")
      );

      const result = await runner.audit("/project");

      expect(result.passed).toBe(true);
    });

    it("passes when pyproject.toml has [tool.ruff]", async () => {
      mockExistsSync.mockImplementation((p) => {
        return String(p).endsWith("pyproject.toml");
      });

      vi.mocked(fs.readFileSync).mockReturnValue(
        "[tool.ruff]\nline-length = 120\n"
      );

      const result = await runner.audit("/project");

      expect(result.passed).toBe(true);
    });

    it("fails when no ruff config found", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await runner.audit("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Ruff config not found");
    });
  });
});
