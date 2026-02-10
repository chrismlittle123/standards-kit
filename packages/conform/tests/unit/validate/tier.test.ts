import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

vi.mock("../../../src/core/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/core/index.js")>(
    "../../../src/core/index.js"
  );
  return {
    ...actual,
    findConfigFile: vi.fn(),
  };
});

import * as fs from "node:fs";

import { findConfigFile } from "../../../src/core/index.js";
import {
  validateTierRuleset,
  formatTierResultText,
  formatTierResultJson,
} from "../../../src/validate/tier.js";
import type { ValidateTierResult } from "../../../src/validate/types.js";

const mockedFs = vi.mocked(fs);
const mockedFindConfigFile = vi.mocked(findConfigFile);

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// validateTierRuleset
// =============================================================================

describe("validateTierRuleset", () => {
  it("returns not found result when no config file", () => {
    mockedFindConfigFile.mockReturnValue(null);
    const result = validateTierRuleset();
    expect(result.valid).toBe(false);
    expect(result.error).toContain("No standards.toml found");
  });

  it("returns not found result when explicit config does not exist", () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = validateTierRuleset({ config: "/nonexistent/standards.toml" });
    expect(result.valid).toBe(false);
  });

  it("defaults tier to internal when file not found", () => {
    mockedFindConfigFile.mockReturnValue("/path/standards.toml");
    mockedFs.existsSync.mockReturnValue(false);
    const result = validateTierRuleset();
    expect(result.tier).toBe("internal");
    expect(result.tierSourceDetail).toContain("file not found");
  });

  it("defaults tier to internal when no metadata section", () => {
    mockedFindConfigFile.mockReturnValue("/path/standards.toml");
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("[code]\n");
    const result = validateTierRuleset();
    expect(result.tier).toBe("internal");
    expect(result.tierSourceDetail).toContain("no metadata");
  });

  it("defaults tier to internal when tier not specified", () => {
    mockedFindConfigFile.mockReturnValue("/path/standards.toml");
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('[metadata]\nproject = "app"\n');
    const result = validateTierRuleset();
    expect(result.tier).toBe("internal");
    expect(result.tierSourceDetail).toContain("tier not specified");
  });

  it("reads tier from standards.toml metadata", () => {
    mockedFindConfigFile.mockReturnValue("/path/standards.toml");
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('[metadata]\ntier = "production"\n');
    const result = validateTierRuleset();
    expect(result.tier).toBe("production");
    expect(result.tierSource).toBe("standards.toml");
  });

  it("validates matching rulesets", () => {
    mockedFindConfigFile.mockReturnValue("/path/standards.toml");
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      '[metadata]\ntier = "production"\n\n[extends]\nregistry = "https://example.com"\nrulesets = ["typescript-production"]\n'
    );
    const result = validateTierRuleset();
    expect(result.valid).toBe(true);
    expect(result.matchedRulesets).toContain("typescript-production");
  });

  it("fails when no rulesets match tier", () => {
    mockedFindConfigFile.mockReturnValue("/path/standards.toml");
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      '[metadata]\ntier = "production"\n\n[extends]\nregistry = "https://example.com"\nrulesets = ["typescript-internal"]\n'
    );
    const result = validateTierRuleset();
    expect(result.valid).toBe(false);
    expect(result.error).toContain("No ruleset matching");
  });

  it("valid when no extends configured", () => {
    mockedFindConfigFile.mockReturnValue("/path/standards.toml");
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('[metadata]\ntier = "production"\n');
    const result = validateTierRuleset();
    expect(result.valid).toBe(true);
    expect(result.rulesets).toHaveLength(0);
  });

  it("warns for invalid tier value", () => {
    mockedFindConfigFile.mockReturnValue("/path/standards.toml");
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('[metadata]\ntier = "invalid-tier"\n');
    const result = validateTierRuleset();
    expect(result.tier).toBe("internal");
    expect(result.invalidTierValue).toBe("invalid-tier");
  });

  it("warns for empty rulesets with registry configured", () => {
    mockedFindConfigFile.mockReturnValue("/path/standards.toml");
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      '[metadata]\ntier = "production"\n\n[extends]\nregistry = "https://example.com"\nrulesets = []\n'
    );
    const result = validateTierRuleset();
    expect(result.hasEmptyRulesets).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => w.includes("rulesets is empty"))).toBe(true);
  });

  it("handles parse error gracefully", () => {
    mockedFindConfigFile.mockReturnValue("/path/standards.toml");
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error("read error");
    });
    const result = validateTierRuleset();
    expect(result.tier).toBe("internal");
  });

  it("uses explicit config path", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('[metadata]\ntier = "prototype"\n');
    const result = validateTierRuleset({ config: "/custom/standards.toml" });
    expect(result.tier).toBe("prototype");
  });
});

// =============================================================================
// formatTierResultText
// =============================================================================

describe("formatTierResultText", () => {
  function makeResult(overrides: Partial<ValidateTierResult> = {}): ValidateTierResult {
    return {
      valid: true,
      tier: "production",
      tierSource: "standards.toml",
      tierSourceDetail: "standards.toml",
      rulesets: ["typescript-production"],
      expectedPattern: "*-production",
      matchedRulesets: ["typescript-production"],
      ...overrides,
    };
  }

  it("shows passed for valid result", () => {
    const output = formatTierResultText(makeResult());
    expect(output).toContain("Tier validation passed");
  });

  it("shows tier and source", () => {
    const output = formatTierResultText(makeResult());
    expect(output).toContain("production");
    expect(output).toContain("standards.toml");
  });

  it("shows matched rulesets", () => {
    const output = formatTierResultText(makeResult());
    expect(output).toContain("typescript-production");
  });

  it("shows failed for invalid result", () => {
    const output = formatTierResultText(
      makeResult({
        valid: false,
        matchedRulesets: [],
        error: "No ruleset matching pattern '*-production' found",
      })
    );
    expect(output).toContain("Tier validation failed");
  });

  it("shows error message on failure", () => {
    const output = formatTierResultText(
      makeResult({
        valid: false,
        error: "Some error",
      })
    );
    expect(output).toContain("Some error");
  });

  it("shows hint for invalid tier value", () => {
    const output = formatTierResultText(
      makeResult({
        valid: false,
        invalidTierValue: "bad-tier",
      })
    );
    expect(output).toContain("Hint");
  });

  it("shows warnings when present", () => {
    const output = formatTierResultText(
      makeResult({
        warnings: ["This is a warning"],
      })
    );
    expect(output).toContain("This is a warning");
  });

  it("shows no rulesets message for empty rulesets with extends", () => {
    const output = formatTierResultText(
      makeResult({
        matchedRulesets: [],
        hasEmptyRulesets: true,
        rulesets: [],
      })
    );
    expect(output).toContain("No rulesets specified");
  });

  it("shows no extends configured when no rulesets and no extends", () => {
    const output = formatTierResultText(
      makeResult({
        matchedRulesets: [],
        hasEmptyRulesets: false,
        rulesets: [],
      })
    );
    expect(output).toContain("No extends configured");
  });
});

// =============================================================================
// formatTierResultJson
// =============================================================================

describe("formatTierResultJson", () => {
  it("returns valid JSON", () => {
    const result: ValidateTierResult = {
      valid: true,
      tier: "production",
      tierSource: "standards.toml",
      rulesets: [],
      expectedPattern: "*-production",
      matchedRulesets: [],
    };
    const parsed = JSON.parse(formatTierResultJson(result));
    expect(parsed.valid).toBe(true);
    expect(parsed.tier).toBe("production");
  });
});
