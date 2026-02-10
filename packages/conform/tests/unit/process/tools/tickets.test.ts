vi.mock("execa");

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";

import { TicketsRunner } from "../../../../src/process/tools/tickets.js";

const mockedExeca = vi.mocked(execa);

beforeEach(() => vi.clearAllMocks());

describe("TicketsRunner", () => {
  let runner: TicketsRunner;

  beforeEach(() => {
    runner = new TicketsRunner();
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("Tickets");
    expect(runner.rule).toBe("process.tickets");
    expect(runner.toolId).toBe("tickets");
  });

  describe("skip cases", () => {
    it("skips when no pattern configured", async () => {
      runner.setConfig({ enabled: true });
      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("No ticket pattern");
    });

    it("skips with invalid regex pattern", async () => {
      runner.setConfig({ enabled: true, pattern: "[invalid", require_in_commits: true });
      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Invalid regex pattern");
    });

    it("skips when neither require_in_commits nor require_in_branch enabled", async () => {
      runner.setConfig({
        enabled: true,
        pattern: "PROJ-\\d+",
        require_in_commits: false,
        require_in_branch: false,
      });
      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Neither require_in_commits nor require_in_branch");
    });
  });

  describe("require_in_commits", () => {
    it("passes when commit message contains ticket reference", async () => {
      runner.setConfig({
        enabled: true,
        pattern: "PROJ-\\d+",
        require_in_commits: true,
        require_in_branch: false,
      });
      mockedExeca.mockResolvedValue({ stdout: "feat: PROJ-123 add feature" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when commit message lacks ticket reference", async () => {
      runner.setConfig({
        enabled: true,
        pattern: "PROJ-\\d+",
        require_in_commits: true,
        require_in_branch: false,
      });
      mockedExeca.mockResolvedValue({ stdout: "feat: add feature" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].rule).toBe("process.tickets.commits");
    });

    it("skips when not in a git repo (commits)", async () => {
      runner.setConfig({
        enabled: true,
        pattern: "PROJ-\\d+",
        require_in_commits: true,
        require_in_branch: false,
      });
      mockedExeca.mockRejectedValue(new Error("not a git repo"));

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
    });
  });

  describe("require_in_branch", () => {
    it("passes when branch contains ticket reference", async () => {
      runner.setConfig({
        enabled: true,
        pattern: "PROJ-\\d+",
        require_in_branch: true,
        require_in_commits: false,
      });
      mockedExeca.mockResolvedValue({ stdout: "feature/PROJ-42-login" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when branch lacks ticket reference", async () => {
      runner.setConfig({
        enabled: true,
        pattern: "PROJ-\\d+",
        require_in_branch: true,
        require_in_commits: false,
      });
      mockedExeca.mockResolvedValue({ stdout: "feature/login" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].rule).toBe("process.tickets.branch");
    });

    it("skips when not in a git repo (branch)", async () => {
      runner.setConfig({
        enabled: true,
        pattern: "PROJ-\\d+",
        require_in_branch: true,
        require_in_commits: false,
      });
      mockedExeca.mockRejectedValue(new Error("not a git repo"));

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
    });
  });

  describe("both validations", () => {
    it("reports violations from both branch and commits", async () => {
      runner.setConfig({
        enabled: true,
        pattern: "PROJ-\\d+",
        require_in_branch: true,
        require_in_commits: true,
      });
      // First call for branch, second for commit
      mockedExeca
        .mockResolvedValueOnce({ stdout: "feature/no-ticket" } as never)
        .mockResolvedValueOnce({ stdout: "feat: no ticket here" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
    });

    it("passes when both contain ticket reference", async () => {
      runner.setConfig({
        enabled: true,
        pattern: "PROJ-\\d+",
        require_in_branch: true,
        require_in_commits: true,
      });
      mockedExeca
        .mockResolvedValueOnce({ stdout: "feature/PROJ-42-login" } as never)
        .mockResolvedValueOnce({ stdout: "feat: PROJ-42 add login" } as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });
});
