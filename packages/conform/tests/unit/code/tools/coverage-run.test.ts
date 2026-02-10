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
  };
});

import { execa } from "execa";
import * as fs from "node:fs";
import { CoverageRunRunner } from "../../../../src/code/tools/coverage-run.js";

const mockExeca = vi.mocked(execa);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

describe("CoverageRunRunner", () => {
  let runner: CoverageRunRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new CoverageRunRunner();
  });

  describe("run", () => {
    it("fails when no test runner can be detected", async () => {
      runner.setConfig({ enabled: true });
      mockExistsSync.mockReturnValue(false);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Could not detect test runner");
    });

    it("passes when vitest coverage meets threshold", async () => {
      runner.setConfig({ enabled: true, runner: "vitest", min_threshold: 80 });

      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      // parseCoverageReport: coverage-summary.json
      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith("coverage/coverage-final.json")) return false;
        if (s.endsWith("coverage/coverage-summary.json")) return true;
        return false;
      });

      const summaryJson = JSON.stringify({
        total: {
          lines: { pct: 90 },
          statements: { pct: 88 },
          branches: { pct: 85 },
          functions: { pct: 92 },
        },
      });
      mockReadFileSync.mockReturnValue(summaryJson);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
    });

    it("fails when coverage is below threshold", async () => {
      runner.setConfig({ enabled: true, runner: "vitest", min_threshold: 80 });

      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith("coverage/coverage-final.json")) return false;
        if (s.endsWith("coverage/coverage-summary.json")) return true;
        return false;
      });

      const summaryJson = JSON.stringify({
        total: {
          lines: { pct: 50 },
          statements: { pct: 48 },
          branches: { pct: 45 },
          functions: { pct: 52 },
        },
      });
      mockReadFileSync.mockReturnValue(summaryJson);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("below minimum threshold");
    });

    it("fails when test command exits with error code > 1", async () => {
      runner.setConfig({ enabled: true, runner: "vitest" });

      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "Error: spawn error",
        exitCode: 2,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Test command failed");
    });

    it("skips when test runner is not installed (ENOENT)", async () => {
      runner.setConfig({ enabled: true, runner: "vitest" });

      mockExeca.mockRejectedValue(new Error("spawn npx ENOENT"));

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
    });

    it("handles custom command from config", async () => {
      runner.setConfig({ enabled: true, command: "npm run test:coverage" });

      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith("coverage/coverage-summary.json")) return true;
        return false;
      });

      const summaryJson = JSON.stringify({
        total: { lines: { pct: 95 } },
      });
      mockReadFileSync.mockReturnValue(summaryJson);

      const result = await runner.run("/project");

      expect(mockExeca).toHaveBeenCalledWith(
        "npm",
        ["run", "test:coverage"],
        expect.any(Object)
      );
      expect(result.passed).toBe(true);
    });

    it("auto-detects vitest runner when vitest config exists", async () => {
      runner.setConfig({ enabled: true, runner: "auto" });

      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith("vitest.config.ts")) return true;
        if (s.endsWith("coverage/coverage-summary.json")) return true;
        return false;
      });

      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockReadFileSync.mockReturnValue(
        JSON.stringify({ total: { lines: { pct: 90 } } })
      );

      await runner.run("/project");

      expect(mockExeca).toHaveBeenCalledWith(
        "npx",
        expect.arrayContaining(["vitest"]),
        expect.any(Object)
      );
    });

    it("fails when coverage report is not found", async () => {
      runner.setConfig({ enabled: true, runner: "vitest" });

      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      mockExistsSync.mockReturnValue(false);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Could not find or parse coverage report");
    });

    it("returns error on unexpected exception", async () => {
      runner.setConfig({ enabled: true, runner: "vitest" });

      mockExeca.mockRejectedValue(new Error("unexpected failure"));

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Coverage run error");
    });
  });
});
