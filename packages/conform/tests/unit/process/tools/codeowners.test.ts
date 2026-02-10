vi.mock("node:fs");

import * as fs from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { CodeownersRunner } from "../../../../src/process/tools/codeowners.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => vi.clearAllMocks());

/** Helper to set up filesystem mocks */
function setupFs(files: Map<string, string>): void {
  mockedFs.existsSync.mockImplementation((p) => files.has(String(p)));
  mockedFs.statSync.mockImplementation((p) => {
    return {
      isDirectory: () => false,
      isFile: () => files.has(String(p)),
    } as fs.Stats;
  });
  mockedFs.readFileSync.mockImplementation((p) => {
    const content = files.get(String(p));
    if (content === undefined) {
      throw new Error("ENOENT");
    }
    return content;
  });
}

describe("CodeownersRunner", () => {
  let runner: CodeownersRunner;

  beforeEach(() => {
    runner = new CodeownersRunner();
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("CODEOWNERS");
    expect(runner.rule).toBe("process.codeowners");
    expect(runner.toolId).toBe("codeowners");
  });

  describe("run", () => {
    it("fails when CODEOWNERS file not found", async () => {
      runner.setConfig({ enabled: true });
      setupFs(new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("CODEOWNERS file not found");
    });

    it("finds CODEOWNERS in .github/ location", async () => {
      runner.setConfig({ enabled: true, rules: [{ pattern: "*", owners: ["@team"] }] });
      setupFs(new Map([["/root/.github/CODEOWNERS", "* @team"]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("finds CODEOWNERS in root location", async () => {
      runner.setConfig({ enabled: true, rules: [{ pattern: "*", owners: ["@team"] }] });
      setupFs(new Map([["/root/CODEOWNERS", "* @team"]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("finds CODEOWNERS in docs/ location", async () => {
      runner.setConfig({ enabled: true, rules: [{ pattern: "*", owners: ["@team"] }] });
      setupFs(new Map([["/root/docs/CODEOWNERS", "* @team"]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when CODEOWNERS cannot be read", async () => {
      runner.setConfig({ enabled: true });
      // File exists but readFileSync throws
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({ isFile: () => true, isDirectory: () => false } as fs.Stats);
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error("permission denied");
      });

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Could not read CODEOWNERS");
    });

    it("reports malformed lines (pattern without owners)", async () => {
      runner.setConfig({ enabled: true });
      const content = "* @team\n/src/broken\n/docs @docs-team";
      setupFs(new Map([["/root/.github/CODEOWNERS", content]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("malformed"))).toBe(true);
    });

    it("skips comment lines and empty lines", async () => {
      runner.setConfig({ enabled: true });
      const content = "# This is a comment\n\n* @team";
      setupFs(new Map([["/root/.github/CODEOWNERS", content]]));

      const result = await runner.run("/root");
      // No malformed violations for comments and empty lines
      expect(result.violations.filter((v) => v.rule.includes("malformed"))).toHaveLength(0);
    });
  });

  describe("rule validation", () => {
    it("passes when all configured rules are present", async () => {
      runner.setConfig({
        enabled: true,
        rules: [
          { pattern: "*", owners: ["@team"] },
          { pattern: "/docs", owners: ["@docs-team"] },
        ],
      });
      const content = "* @team\n/docs @docs-team";
      setupFs(new Map([["/root/.github/CODEOWNERS", content]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when configured rule is missing from CODEOWNERS", async () => {
      runner.setConfig({
        enabled: true,
        rules: [
          { pattern: "*", owners: ["@team"] },
          { pattern: "/src", owners: ["@dev-team"] },
        ],
      });
      const content = "* @team";
      setupFs(new Map([["/root/.github/CODEOWNERS", content]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("missing"))).toBe(true);
    });

    it("fails when owner mismatch", async () => {
      runner.setConfig({
        enabled: true,
        rules: [{ pattern: "*", owners: ["@correct-team"] }],
      });
      const content = "* @wrong-team";
      setupFs(new Map([["/root/.github/CODEOWNERS", content]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("owners"))).toBe(true);
      expect(result.violations[0].message).toContain("Owner mismatch");
    });

    it("detects extra rules not in config", async () => {
      runner.setConfig({
        enabled: true,
        rules: [{ pattern: "*", owners: ["@team"] }],
      });
      const content = "* @team\n/extra @extra-team";
      setupFs(new Map([["/root/.github/CODEOWNERS", content]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("extra"))).toBe(true);
    });
  });

  describe("audit", () => {
    it("passes when CODEOWNERS exists", async () => {
      runner.setConfig({ enabled: true });
      setupFs(new Map([["/root/.github/CODEOWNERS", "* @team"]]));

      const result = await runner.audit("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when CODEOWNERS does not exist", async () => {
      runner.setConfig({ enabled: true });
      setupFs(new Map());

      const result = await runner.audit("/root");
      expect(result.passed).toBe(false);
    });
  });
});
