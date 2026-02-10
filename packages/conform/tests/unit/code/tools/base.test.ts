import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

import * as fs from "node:fs";
import { BaseToolRunner } from "../../../../src/code/tools/base.js";
import type { CheckResult } from "../../../../src/core/index.js";

/** Concrete subclass for testing the abstract BaseToolRunner */
class TestToolRunner extends BaseToolRunner {
  readonly name = "TestTool";
  readonly rule = "code.test";
  readonly toolId = "test-tool";
  readonly configFiles = ["test.config.js", "test.config.json"];

  async run(_projectRoot: string): Promise<CheckResult> {
    return this.pass(0);
  }

  // Expose protected methods for testing
  publicHasConfig(projectRoot: string): boolean {
    return this.hasConfig(projectRoot);
  }

  publicFindConfig(projectRoot: string): string | null {
    return this.findConfig(projectRoot);
  }

  publicIsNotInstalledError(error: unknown): boolean {
    return this.isNotInstalledError(error);
  }

  publicFailNoConfig(duration: number): CheckResult {
    return this.failNoConfig(duration);
  }

  publicSkipNotInstalled(duration: number): CheckResult {
    return this.skipNotInstalled(duration);
  }

  publicPass(duration: number): CheckResult {
    return this.pass(duration);
  }

  publicFail(violations: { rule: string; tool: string; message: string; severity: "error" | "warning" }[], duration: number): CheckResult {
    return this.fail(violations, duration);
  }

  publicFromViolations(violations: { rule: string; tool: string; message: string; severity: "error" | "warning" }[], duration: number): CheckResult {
    return this.fromViolations(violations, duration);
  }
}

const mockExistsSync = vi.mocked(fs.existsSync);

describe("BaseToolRunner", () => {
  let runner: TestToolRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new TestToolRunner();
  });

  describe("hasConfig", () => {
    it("returns true when config file exists in projectRoot", () => {
      mockExistsSync.mockImplementation((p) => {
        return String(p).endsWith("test.config.js");
      });

      expect(runner.publicHasConfig("/project")).toBe(true);
    });

    it("returns false when no config file exists", () => {
      mockExistsSync.mockReturnValue(false);

      expect(runner.publicHasConfig("/project")).toBe(false);
    });

    it("returns true when config file exists in parent directory", () => {
      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        // Only exists in parent, not in project root
        if (s === "/parent/test.config.js") return true;
        return false;
      });

      expect(runner.publicHasConfig("/parent/project")).toBe(true);
    });
  });

  describe("findConfig", () => {
    it("returns config filename when found in projectRoot", () => {
      mockExistsSync.mockImplementation((p) => {
        return String(p).endsWith("/project/test.config.json");
      });

      expect(runner.publicFindConfig("/project")).toBe("test.config.json");
    });

    it("returns null when no config found", () => {
      mockExistsSync.mockReturnValue(false);

      expect(runner.publicFindConfig("/project")).toBeNull();
    });
  });

  describe("isNotInstalledError", () => {
    it("returns true for ENOENT errors", () => {
      const error = new Error("spawn test ENOENT");
      expect(runner.publicIsNotInstalledError(error)).toBe(true);
    });

    it("returns true for not found errors", () => {
      const error = new Error("command not found");
      expect(runner.publicIsNotInstalledError(error)).toBe(true);
    });

    it("returns false for other errors", () => {
      const error = new Error("some other error");
      expect(runner.publicIsNotInstalledError(error)).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(runner.publicIsNotInstalledError("string")).toBe(false);
      expect(runner.publicIsNotInstalledError(42)).toBe(false);
      expect(runner.publicIsNotInstalledError(null)).toBe(false);
    });
  });

  describe("failNoConfig", () => {
    it("returns a fail result with config not found message", () => {
      const result = runner.publicFailNoConfig(10);

      expect(result.passed).toBe(false);
      expect(result.name).toBe("TestTool");
      expect(result.rule).toBe("code.test");
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("Config not found");
      expect(result.violations[0].message).toContain("test.config.js");
      expect(result.violations[0].message).toContain("test.config.json");
    });
  });

  describe("skipNotInstalled", () => {
    it("returns a skip result", () => {
      const result = runner.publicSkipNotInstalled(5);

      expect(result.passed).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("not installed");
    });
  });

  describe("pass", () => {
    it("returns a passing result", () => {
      const result = runner.publicPass(3);

      expect(result.passed).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("fail", () => {
    it("returns a failing result with violations", () => {
      const violations = [
        { rule: "code.test", tool: "test-tool", message: "bad", severity: "error" as const },
      ];
      const result = runner.publicFail(violations, 7);

      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(violations);
    });
  });

  describe("fromViolations", () => {
    it("returns pass when violations array is empty", () => {
      const result = runner.publicFromViolations([], 2);

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("returns fail when violations exist", () => {
      const violations = [
        { rule: "code.test", tool: "test-tool", message: "issue", severity: "warning" as const },
      ];
      const result = runner.publicFromViolations(violations, 2);

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
    });
  });

  describe("audit", () => {
    it("passes when config exists", async () => {
      mockExistsSync.mockImplementation((p) => {
        return String(p).endsWith("test.config.js");
      });

      const result = await runner.audit("/project");

      expect(result.passed).toBe(true);
      expect(result.name).toBe("TestTool Config");
    });

    it("fails when config is missing", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await runner.audit("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("config not found");
    });
  });
});
