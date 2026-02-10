vi.mock("execa");

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";

import { BranchesRunner } from "../../../../src/process/tools/branches.js";

const mockedExeca = vi.mocked(execa);

beforeEach(() => vi.clearAllMocks());

describe("BranchesRunner", () => {
  let runner: BranchesRunner;

  beforeEach(() => {
    runner = new BranchesRunner();
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("Branches");
    expect(runner.rule).toBe("process.branches");
    expect(runner.toolId).toBe("branches");
  });

  describe("skip cases", () => {
    it("skips when no pattern or issue requirement configured", async () => {
      runner.setConfig({ enabled: true });
      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("No branch pattern");
    });

    it("skips when not in a git repository", async () => {
      runner.setConfig({ enabled: true, pattern: "^feature/.*$" });
      mockedExeca.mockRejectedValue(new Error("not a git repo"));

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Not in a git repository");
    });

    it("skips when branch name is empty", async () => {
      runner.setConfig({ enabled: true, pattern: "^feature/.*$" });
      mockedExeca.mockResolvedValue({ stdout: "" } as never);

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
    });
  });

  describe("pattern validation", () => {
    it("passes when branch matches pattern", async () => {
      runner.setConfig({ enabled: true, pattern: "^(feature|fix)/.*$" });
      mockedExeca.mockResolvedValue({ stdout: "feature/add-login" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
      expect(result.skipped).toBe(false);
    });

    it("fails when branch does not match pattern", async () => {
      runner.setConfig({ enabled: true, pattern: "^(feature|fix)/.*$" });
      mockedExeca.mockResolvedValue({ stdout: "random-branch" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("random-branch");
      expect(result.violations[0].message).toContain("does not match pattern");
    });

    it("fails with invalid regex pattern", async () => {
      runner.setConfig({ enabled: true, pattern: "[invalid" });
      mockedExeca.mockResolvedValue({ stdout: "feature/test" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Invalid regex pattern");
    });
  });

  describe("exclude", () => {
    it("passes when branch is in exclude list", async () => {
      runner.setConfig({
        enabled: true,
        pattern: "^(feature|fix)/.*$",
        exclude: ["main", "develop"],
      });
      mockedExeca.mockResolvedValue({ stdout: "main" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
      expect(result.skipped).toBe(false);
    });
  });

  describe("require_issue", () => {
    it("passes when branch contains issue number", async () => {
      runner.setConfig({ enabled: true, require_issue: true });
      mockedExeca.mockResolvedValue({ stdout: "feature/123/add-login" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when branch lacks issue number", async () => {
      runner.setConfig({ enabled: true, require_issue: true });
      mockedExeca.mockResolvedValue({ stdout: "random-branch" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("does not contain issue number");
    });

    it("uses custom issue_pattern", async () => {
      runner.setConfig({
        enabled: true,
        require_issue: true,
        issue_pattern: "^PROJ-(\\d+)-.*$",
      });
      mockedExeca.mockResolvedValue({ stdout: "PROJ-42-add-feature" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });

  describe("combined validations", () => {
    it("reports both pattern and issue violations", async () => {
      runner.setConfig({
        enabled: true,
        pattern: "^(feature|fix)/.*$",
        require_issue: true,
      });
      mockedExeca.mockResolvedValue({ stdout: "random" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
    });
  });
});
