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
import { VultureRunner } from "../../../../src/code/tools/vulture.js";

const mockExeca = vi.mocked(execa);
const mockExistsSync = vi.mocked(fs.existsSync);

describe("VultureRunner", () => {
  let runner: VultureRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new VultureRunner();
  });

  describe("run", () => {
    it("skips when no Python files found", async () => {
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

    it("returns pass when vulture finds no dead code (exit 0)", async () => {
      // find returns Python files
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      // vulture returns clean
      mockExeca.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("parses vulture output into violations (exit 3 = dead code)", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const vultureOutput = [
        "main.py:10: unused function 'old_handler' (60% confidence)",
        "utils.py:25: unused import 'os' (90% confidence)",
      ].join("\n");

      mockExeca.mockResolvedValueOnce({
        stdout: vultureOutput,
        stderr: "",
        exitCode: 3,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].file).toBe("main.py");
      expect(result.violations[0].line).toBe(10);
      expect(result.violations[0].message).toContain("unused function 'old_handler'");
      expect(result.violations[0].message).toContain("60% confidence");
      expect(result.violations[0].code).toBe("unused-function");
      expect(result.violations[0].severity).toBe("warning");
      expect(result.violations[1].code).toBe("unused-import");
    });

    it("returns error for exit code 1 (invalid input)", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: "",
        stderr: "Error: invalid input file",
        exitCode: 1,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Vulture error");
    });

    it("returns error for exit code 2 (invalid arguments)", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: "",
        stderr: "Error: invalid arguments",
        exitCode: 2,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Vulture error");
    });

    it("returns skip when vulture binary is not found (ENOENT)", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExeca.mockRejectedValueOnce(new Error("spawn vulture ENOENT"));

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("not installed");
    });

    it("returns skip when binary not found via result code", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 127,
        failed: true,
        code: "ENOENT",
      } as any);

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
    });

    it("returns error violation on unexpected thrown errors", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExeca.mockRejectedValueOnce(new Error("timeout exceeded"));

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Vulture error");
    });

    it("classifies different vulture message types correctly", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const vultureOutput = [
        "main.py:1: unused class 'OldClass' (70% confidence)",
        "main.py:5: unused variable 'tmp' (80% confidence)",
        "main.py:10: unreachable code after 'return' (100% confidence)",
      ].join("\n");

      mockExeca.mockResolvedValueOnce({
        stdout: vultureOutput,
        stderr: "",
        exitCode: 3,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.violations[0].code).toBe("unused-class");
      expect(result.violations[1].code).toBe("unused-variable");
      expect(result.violations[2].code).toBe("unreachable-code");
    });
  });

  describe("audit", () => {
    it("skips when no Python files found", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.audit("/project");

      expect(result.skipped).toBe(true);
    });

    it("passes when Python project files exist", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pyproject.toml")
      );

      const result = await runner.audit("/project");

      expect(result.passed).toBe(true);
    });

    it("fails when no Python project file exists", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "./main.py",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExistsSync.mockReturnValue(false);

      const result = await runner.audit("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("No Python project file found");
    });
  });
});
