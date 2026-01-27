import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { validateTierRuleset, hasTierMismatch } from "../../../src/repo/tier-validation.js";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

describe("tier-validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("validateTierRuleset", () => {
    it("returns null when cm command fails completely", () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("Command not found");
      });

      const result = validateTierRuleset("/path/to/repo");
      expect(result).toBeNull();
    });

    it("returns valid result when tier matches rulesets", () => {
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          valid: true,
          tier: "production",
          tierSource: "repo-metadata.yaml",
          rulesets: ["typescript-production"],
          expectedPattern: "*-production",
          matchedRulesets: ["typescript-production"],
        })
      );

      const result = validateTierRuleset("/path/to/repo");
      expect(result).toEqual({
        valid: true,
        tier: "production",
        rulesets: ["typescript-production"],
        expectedPattern: "*-production",
        matchedRulesets: ["typescript-production"],
        error: undefined,
      });
    });

    it("returns invalid result when tier does not match rulesets", () => {
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          valid: false,
          tier: "production",
          tierSource: "repo-metadata.yaml",
          rulesets: ["typescript-internal"],
          expectedPattern: "*-production",
          matchedRulesets: [],
          error:
            "No ruleset matching pattern '*-production' found. Rulesets: [typescript-internal]",
        })
      );

      const result = validateTierRuleset("/path/to/repo");
      expect(result).toEqual({
        valid: false,
        tier: "production",
        rulesets: ["typescript-internal"],
        expectedPattern: "*-production",
        matchedRulesets: [],
        error:
          "No ruleset matching pattern '*-production' found. Rulesets: [typescript-internal]",
      });
    });

    it("handles command that exits non-zero but has valid JSON stdout", () => {
      const execError = new Error("Command failed") as Error & {
        stdout: string;
        stderr: string;
      };
      execError.stdout = JSON.stringify({
        valid: false,
        tier: "internal",
        tierSource: "repo-metadata.yaml",
        rulesets: [],
        expectedPattern: "*-internal",
        matchedRulesets: [],
        error: "No rulesets found",
      });
      execError.stderr = "";

      mockExecSync.mockImplementationOnce(() => {
        throw execError;
      });

      const result = validateTierRuleset("/path/to/repo");
      expect(result).toEqual({
        valid: false,
        tier: "internal",
        rulesets: [],
        expectedPattern: "*-internal",
        matchedRulesets: [],
        error: "No rulesets found",
      });
    });

    it("returns null when command fails with invalid JSON stdout", () => {
      const execError = new Error("Command failed") as Error & {
        stdout: string;
      };
      execError.stdout = "not valid json";

      mockExecSync.mockImplementationOnce(() => {
        throw execError;
      });

      const result = validateTierRuleset("/path/to/repo");
      expect(result).toBeNull();
    });

    it("passes correct options to execSync", () => {
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          valid: true,
          tier: "internal",
          tierSource: "repo-metadata.yaml",
          rulesets: ["typescript-internal"],
          expectedPattern: "*-internal",
          matchedRulesets: ["typescript-internal"],
        })
      );

      validateTierRuleset("/path/to/repo");

      expect(mockExecSync).toHaveBeenCalledWith(
        "conform validate tier --format json",
        {
          cwd: "/path/to/repo",
          encoding: "utf-8",
          timeout: 30000,
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
    });

    it("returns null on invalid JSON response", () => {
      mockExecSync.mockReturnValueOnce("not valid json");

      const result = validateTierRuleset("/path/to/repo");
      expect(result).toBeNull();
    });

    it("handles multiple rulesets", () => {
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          valid: true,
          tier: "production",
          tierSource: "repo-metadata.yaml",
          rulesets: ["typescript-production", "security-production"],
          expectedPattern: "*-production",
          matchedRulesets: ["typescript-production", "security-production"],
        })
      );

      const result = validateTierRuleset("/path/to/repo");
      expect(result?.rulesets).toEqual([
        "typescript-production",
        "security-production",
      ]);
      expect(result?.matchedRulesets).toEqual([
        "typescript-production",
        "security-production",
      ]);
    });
  });

  describe("hasTierMismatch", () => {
    it("returns false for null result", () => {
      expect(hasTierMismatch(null)).toBe(false);
    });

    it("returns false for valid result", () => {
      expect(
        hasTierMismatch({
          valid: true,
          tier: "production",
          rulesets: ["typescript-production"],
          expectedPattern: "*-production",
          matchedRulesets: ["typescript-production"],
        })
      ).toBe(false);
    });

    it("returns true for invalid result", () => {
      expect(
        hasTierMismatch({
          valid: false,
          tier: "production",
          rulesets: ["typescript-internal"],
          expectedPattern: "*-production",
          matchedRulesets: [],
          error: "Mismatch",
        })
      ).toBe(true);
    });
  });
});
