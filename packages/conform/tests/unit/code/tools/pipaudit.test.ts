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
import { PipAuditRunner } from "../../../../src/code/tools/pipaudit.js";

const mockExeca = vi.mocked(execa);
const mockExistsSync = vi.mocked(fs.existsSync);

describe("PipAuditRunner", () => {
  let runner: PipAuditRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new PipAuditRunner();
  });

  describe("run", () => {
    it("returns failNoConfig when no Python dependency files exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Config not found");
    });

    it("returns pass when pip-audit finds no vulnerabilities", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("requirements.txt")
      );

      const pipAuditOutput = JSON.stringify([]);

      mockExeca.mockResolvedValue({
        stdout: pipAuditOutput,
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("parses pip-audit vulnerabilities into violations", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("requirements.txt")
      );

      const pipAuditOutput = JSON.stringify([
        {
          name: "requests",
          version: "2.25.0",
          vulns: [
            {
              id: "PYSEC-2023-001",
              fix_versions: ["2.31.0"],
              aliases: ["CVE-2023-32681"],
              description: "Unintended leak of Proxy-Authorization header",
            },
          ],
        },
        {
          name: "flask",
          version: "1.0",
          vulns: [
            {
              id: "PYSEC-2023-002",
              fix_versions: [],
              aliases: ["CVE-2023-99999"],
              description: "Hypothetical issue with no fix",
            },
          ],
        },
      ]);

      mockExeca.mockResolvedValue({
        stdout: pipAuditOutput,
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].message).toContain("requests@2.25.0");
      expect(result.violations[0].message).toContain("CVE-2023-32681");
      expect(result.violations[0].message).toContain("fix: 2.31.0");
      expect(result.violations[0].severity).toBe("error"); // fix available
      expect(result.violations[0].code).toBe("PYSEC-2023-001");
      expect(result.violations[1].severity).toBe("warning"); // no fix
      expect(result.violations[1].message).toContain("no fix available");
    });

    it("returns pass when output is not parseable JSON and exit code is 0", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("requirements.txt")
      );

      mockExeca.mockResolvedValue({
        stdout: "not json output",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
    });

    it("returns error when output is not JSON and exit code is > 1", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("requirements.txt")
      );

      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "pip-audit internal error",
        exitCode: 2,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("pip-audit error");
    });

    it("returns skip when pip-audit is not installed (ENOENT)", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("requirements.txt")
      );

      mockExeca.mockRejectedValue(new Error("spawn uvx ENOENT"));

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("not installed");
    });

    it("returns error violation on unexpected thrown errors", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("requirements.txt")
      );

      mockExeca.mockRejectedValue(new Error("network timeout"));

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("pip-audit error");
    });

    it("falls back to pip-audit directly when uvx fails", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("requirements.txt")
      );

      // First call (uvx) throws
      mockExeca.mockRejectedValueOnce(new Error("uvx not found"));

      // Second call (pip-audit directly) succeeds
      mockExeca.mockResolvedValueOnce({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
      expect(mockExeca).toHaveBeenCalledTimes(2);
    });

    it("uses -r requirements.txt when that file exists", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("requirements.txt")
      );

      mockExeca.mockResolvedValue({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      await runner.run("/project");

      expect(mockExeca).toHaveBeenCalledWith(
        "uvx",
        expect.arrayContaining(["-r", "requirements.txt"]),
        expect.any(Object)
      );
    });
  });

  describe("audit", () => {
    it("passes when requirements.txt exists", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("requirements.txt")
      );

      const result = await runner.audit("/project");

      expect(result.passed).toBe(true);
    });

    it("fails when no Python dependency files exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await runner.audit("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("No Python dependency file found");
    });
  });
});
