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
import { GitleaksRunner } from "../../../../src/code/tools/gitleaks.js";

const mockExeca = vi.mocked(execa);
const mockExistsSync = vi.mocked(fs.existsSync);

describe("GitleaksRunner", () => {
  let runner: GitleaksRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new GitleaksRunner();
    mockExistsSync.mockReturnValue(false);
  });

  describe("run", () => {
    it("returns pass when gitleaks finds no leaks (exit 0)", async () => {
      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("parses gitleaks findings when leaks detected (exit 1)", async () => {
      const findings = JSON.stringify([
        {
          Description: "AWS Access Key",
          StartLine: 10,
          EndLine: 10,
          StartColumn: 5,
          EndColumn: 25,
          Match: "AKIAIOSFODNN7EXAMPLE",
          Secret: "AKIAIOSFODNN7EXAMPLE",
          File: "config.py",
          Commit: "abc123",
          Entropy: 3.5,
          Author: "dev",
          Email: "dev@example.com",
          Date: "2024-01-01",
          Message: "add config",
          Tags: [],
          RuleID: "aws-access-key",
          Fingerprint: "fp123",
        },
      ]);

      mockExeca.mockResolvedValue({
        stdout: findings,
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].code).toBe("aws-access-key");
      expect(result.violations[0].message).toContain("AWS Access Key");
      expect(result.violations[0].file).toBe("config.py");
      expect(result.violations[0].line).toBe(10);
      expect(result.violations[0].severity).toBe("error");
    });

    it("returns error for non-zero/non-one exit codes", async () => {
      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "fatal: not a git repository",
        exitCode: 2,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("gitleaks error");
    });

    it("returns skip when gitleaks binary is not found (ENOENT)", async () => {
      mockExeca.mockRejectedValue(new Error("spawn gitleaks ENOENT"));

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("not installed");
    });

    it("returns skip when binary not found via result code", async () => {
      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 127,
        failed: true,
        code: "ENOENT",
      } as any);

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
    });

    it("returns error on parse failure for exit code 1", async () => {
      mockExeca.mockResolvedValue({
        stdout: "not json",
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Failed to parse gitleaks output");
    });

    it("returns error violation on unexpected errors", async () => {
      mockExeca.mockRejectedValue(new Error("network timeout"));

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("gitleaks error");
    });

    it("builds correct args for branch scan mode", async () => {
      runner.setConfig({ scan_mode: "branch", base_branch: "develop" });

      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      await runner.run("/project");

      expect(mockExeca).toHaveBeenCalledWith(
        "gitleaks",
        expect.arrayContaining(["--log-opts", "develop..HEAD"]),
        expect.any(Object)
      );
    });

    it("builds correct args for files scan mode", async () => {
      runner.setConfig({ scan_mode: "files" });

      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      await runner.run("/project");

      expect(mockExeca).toHaveBeenCalledWith(
        "gitleaks",
        expect.arrayContaining(["--no-git"]),
        expect.any(Object)
      );
    });

    it("includes custom config when config file exists", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith(".gitleaks.toml")
      );

      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      await runner.run("/project");

      expect(mockExeca).toHaveBeenCalledWith(
        "gitleaks",
        expect.arrayContaining(["--config"]),
        expect.any(Object)
      );
    });
  });

  describe("audit", () => {
    it("passes when gitleaks version check succeeds", async () => {
      mockExeca.mockResolvedValue({
        stdout: "v8.18.0",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.audit("/project");

      expect(result.passed).toBe(true);
    });

    it("returns skip when gitleaks is not installed", async () => {
      mockExeca.mockRejectedValue(new Error("spawn gitleaks ENOENT"));

      const result = await runner.audit("/project");

      expect(result.skipped).toBe(true);
    });
  });
});
