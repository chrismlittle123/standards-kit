vi.mock("execa");

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";

import { CommitsRunner } from "../../../../src/process/tools/commits.js";

const mockedExeca = vi.mocked(execa);

beforeEach(() => vi.clearAllMocks());

describe("CommitsRunner", () => {
  let runner: CommitsRunner;

  beforeEach(() => {
    runner = new CommitsRunner();
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("Commits");
    expect(runner.rule).toBe("process.commits");
    expect(runner.toolId).toBe("commits");
  });

  describe("auto-generated commits", () => {
    it.each([
      ["Merge pull request #1 from owner/branch", "merge"],
      ["Merge branch 'feature' into main", "merge"],
      ["Revert \"feat: add feature\"", "revert"],
      ["fixup! feat: add feature", "fixup"],
      ["squash! feat: add feature", "squash"],
      ["amend! feat: add feature", "amend"],
    ])("skips auto-generated commit: %s (%s)", async (subject) => {
      runner.setConfig({ enabled: true, types: ["feat", "fix"] });
      mockedExeca.mockResolvedValue({ stdout: subject } as never);

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Auto-generated commit message");
    });
  });

  describe("skip cases", () => {
    it("skips when no pattern or types configured", async () => {
      runner.setConfig({ enabled: true });
      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("No pattern or types configured");
    });

    it("skips with invalid regex pattern", async () => {
      runner.setConfig({ enabled: true, pattern: "[invalid" });
      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Invalid regex pattern");
    });

    it("skips when not in a git repo", async () => {
      runner.setConfig({ enabled: true, types: ["feat", "fix"] });
      mockedExeca.mockRejectedValue(new Error("not a git repo"));

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Not in a git repository");
    });

    it("skips when commit subject is empty", async () => {
      runner.setConfig({ enabled: true, types: ["feat", "fix"] });
      mockedExeca.mockResolvedValue({ stdout: "" } as never);

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
    });
  });

  describe("conventional commit types", () => {
    it("passes with valid conventional commit", async () => {
      runner.setConfig({ enabled: true, types: ["feat", "fix", "chore"] });
      mockedExeca.mockResolvedValue({ stdout: "feat: add new feature" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
      expect(result.skipped).toBe(false);
    });

    it("passes with scoped conventional commit", async () => {
      runner.setConfig({ enabled: true, types: ["feat", "fix"] });
      mockedExeca.mockResolvedValue({ stdout: "feat(api): add endpoint" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails with invalid type", async () => {
      runner.setConfig({ enabled: true, types: ["feat", "fix"] });
      mockedExeca.mockResolvedValue({ stdout: "invalid: bad commit" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].rule).toBe("process.commits.pattern");
    });

    it("fails with no colon separator", async () => {
      runner.setConfig({ enabled: true, types: ["feat", "fix"] });
      mockedExeca.mockResolvedValue({ stdout: "just a message" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
    });
  });

  describe("require_scope", () => {
    it("passes when scope is present and required", async () => {
      runner.setConfig({ enabled: true, types: ["feat"], require_scope: true });
      mockedExeca.mockResolvedValue({ stdout: "feat(core): add feature" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when scope is missing but required", async () => {
      runner.setConfig({ enabled: true, types: ["feat"], require_scope: true });
      mockedExeca.mockResolvedValue({ stdout: "feat: add feature" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
    });
  });

  describe("max_subject_length", () => {
    it("passes when subject is under max length", async () => {
      runner.setConfig({ enabled: true, types: ["feat"], max_subject_length: 72 });
      mockedExeca.mockResolvedValue({ stdout: "feat: short message" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when subject exceeds max length", async () => {
      runner.setConfig({ enabled: true, types: ["feat"], max_subject_length: 20 });
      mockedExeca.mockResolvedValue({
        stdout: "feat: this is a very long commit message that exceeds the maximum length",
      } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === "process.commits.max_subject_length")).toBe(
        true
      );
    });
  });

  describe("custom pattern", () => {
    it("passes when commit matches custom pattern", async () => {
      runner.setConfig({ enabled: true, pattern: "^PROJ-\\d+: .+" });
      mockedExeca.mockResolvedValue({ stdout: "PROJ-123: fix bug" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when commit does not match custom pattern", async () => {
      runner.setConfig({ enabled: true, pattern: "^PROJ-\\d+: .+" });
      mockedExeca.mockResolvedValue({ stdout: "fix a bug" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
    });
  });
});
