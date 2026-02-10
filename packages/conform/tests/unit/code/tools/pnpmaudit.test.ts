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
import { PnpmAuditRunner } from "../../../../src/code/tools/pnpmaudit.js";

const mockExeca = vi.mocked(execa);
const mockExistsSync = vi.mocked(fs.existsSync);

describe("PnpmAuditRunner", () => {
  let runner: PnpmAuditRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new PnpmAuditRunner();
  });

  describe("run", () => {
    it("fails when pnpm-lock.yaml does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("No pnpm-lock.yaml found");
    });

    it("returns pass when pnpm audit finds no vulnerabilities", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pnpm-lock.yaml")
      );

      const auditOutput = JSON.stringify({
        advisories: {},
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 0,
            moderate: 0,
            high: 0,
            critical: 0,
          },
        },
      });

      mockExeca.mockResolvedValue({
        stdout: auditOutput,
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("parses pnpm audit advisories into violations", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pnpm-lock.yaml")
      );

      const auditOutput = JSON.stringify({
        advisories: {
          "1234": {
            module_name: "lodash",
            severity: "high",
            title: "Prototype Pollution",
            url: "https://npmjs.com/advisories/1234",
            findings: [{ version: "4.17.20", paths: ["lodash"] }],
          },
          "5678": {
            module_name: "minimist",
            severity: "low",
            title: "Prototype Pollution in minimist",
            url: "https://npmjs.com/advisories/5678",
            findings: [{ version: "1.2.5", paths: ["minimist"] }],
          },
        },
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 1,
            moderate: 0,
            high: 1,
            critical: 0,
          },
        },
      });

      mockExeca.mockResolvedValue({
        stdout: auditOutput,
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);

      const lodashViolation = result.violations.find((v) =>
        v.message.includes("lodash")
      );
      expect(lodashViolation).toBeDefined();
      expect(lodashViolation!.message).toContain("Prototype Pollution");
      expect(lodashViolation!.severity).toBe("error"); // high -> error
      expect(lodashViolation!.file).toBe("pnpm-lock.yaml");

      const minimistViolation = result.violations.find((v) =>
        v.message.includes("minimist")
      );
      expect(minimistViolation).toBeDefined();
      expect(minimistViolation!.severity).toBe("warning"); // low -> warning
    });

    it("maps critical severity to error", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pnpm-lock.yaml")
      );

      const auditOutput = JSON.stringify({
        advisories: {
          "9999": {
            module_name: "evil-pkg",
            severity: "critical",
            title: "Remote Code Execution",
            url: "https://example.com",
            findings: [{ version: "1.0.0", paths: ["evil-pkg"] }],
          },
        },
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 0,
            moderate: 0,
            high: 0,
            critical: 1,
          },
        },
      });

      mockExeca.mockResolvedValue({
        stdout: auditOutput,
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.violations[0].severity).toBe("error");
    });

    it("returns pass when output has no advisories key", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pnpm-lock.yaml")
      );

      const auditOutput = JSON.stringify({
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 0,
            moderate: 0,
            high: 0,
            critical: 0,
          },
        },
      });

      mockExeca.mockResolvedValue({
        stdout: auditOutput,
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
    });

    it("returns error when output is not JSON and exit code is non-zero", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pnpm-lock.yaml")
      );

      mockExeca.mockResolvedValue({
        stdout: "not json",
        stderr: "pnpm: command error",
        exitCode: 1,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("pnpm audit error");
    });

    it("returns pass when output is not JSON but exit code is 0", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pnpm-lock.yaml")
      );

      mockExeca.mockResolvedValue({
        stdout: "not json",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
    });

    it("returns skip when pnpm is not installed (ENOENT)", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pnpm-lock.yaml")
      );

      mockExeca.mockRejectedValue(new Error("spawn pnpm ENOENT"));

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("not installed");
    });

    it("returns error violation on unexpected thrown errors", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pnpm-lock.yaml")
      );

      mockExeca.mockRejectedValue(new Error("timeout"));

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("pnpm audit error");
    });

    it("passes --prod flag by default to exclude dev dependencies", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pnpm-lock.yaml")
      );

      mockExeca.mockResolvedValue({
        stdout: JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } }),
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      await runner.run("/project");

      expect(mockExeca).toHaveBeenCalledWith(
        "pnpm",
        expect.arrayContaining(["--prod"]),
        expect.any(Object)
      );
    });

    it("omits --prod flag when exclude_dev is false", async () => {
      runner.setConfig({ enabled: true, exclude_dev: false });

      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pnpm-lock.yaml")
      );

      mockExeca.mockResolvedValue({
        stdout: JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } }),
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      await runner.run("/project");

      expect(mockExeca).toHaveBeenCalledWith(
        "pnpm",
        ["audit", "--json"],
        expect.any(Object)
      );
    });
  });

  describe("audit", () => {
    it("passes when pnpm-lock.yaml exists", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pnpm-lock.yaml")
      );

      const result = await runner.audit("/project");

      expect(result.passed).toBe(true);
    });

    it("fails when pnpm-lock.yaml does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await runner.audit("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("No pnpm-lock.yaml found");
    });
  });
});
