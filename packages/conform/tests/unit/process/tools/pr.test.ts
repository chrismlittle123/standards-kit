vi.mock("node:fs");

import * as fs from "node:fs";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

import { PrRunner } from "../../../../src/process/tools/pr.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => vi.clearAllMocks());

describe("PrRunner", () => {
  let runner: PrRunner;
  const originalEnv = process.env;

  beforeEach(() => {
    runner = new PrRunner();
    process.env = { ...originalEnv };
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.GITHUB_TOKEN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("PR");
    expect(runner.rule).toBe("process.pr");
    expect(runner.toolId).toBe("pr");
  });

  describe("skip cases", () => {
    it("skips when no validation configured", async () => {
      runner.setConfig({ enabled: true });
      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("No PR validation configured");
    });

    it("skips when GITHUB_EVENT_PATH is not set", async () => {
      runner.setConfig({ enabled: true, max_files: 10 });
      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Not in a PR context");
    });

    it("skips when event payload has no PR data", async () => {
      runner.setConfig({ enabled: true, max_files: 10 });
      process.env.GITHUB_EVENT_PATH = "/tmp/event.json";
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({ action: "opened" }));

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
    });

    it("skips when event payload cannot be read", async () => {
      runner.setConfig({ enabled: true, max_files: 10 });
      process.env.GITHUB_EVENT_PATH = "/tmp/event.json";
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
    });
  });

  describe("max_files", () => {
    it("passes when file count is within limit", async () => {
      runner.setConfig({ enabled: true, max_files: 20 });
      process.env.GITHUB_EVENT_PATH = "/tmp/event.json";
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          pull_request: { changed_files: 5, additions: 10, deletions: 5 },
        })
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when file count exceeds limit", async () => {
      runner.setConfig({ enabled: true, max_files: 10 });
      process.env.GITHUB_EVENT_PATH = "/tmp/event.json";
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          pull_request: { changed_files: 25, additions: 100, deletions: 50 },
        })
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].rule).toBe("process.pr.max_files");
      expect(result.violations[0].message).toContain("25 files");
    });
  });

  describe("max_lines", () => {
    it("passes when line count is within limit", async () => {
      runner.setConfig({ enabled: true, max_lines: 500 });
      process.env.GITHUB_EVENT_PATH = "/tmp/event.json";
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          pull_request: { changed_files: 5, additions: 100, deletions: 50 },
        })
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when line count exceeds limit", async () => {
      runner.setConfig({ enabled: true, max_lines: 100 });
      process.env.GITHUB_EVENT_PATH = "/tmp/event.json";
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          pull_request: { changed_files: 5, additions: 200, deletions: 100 },
        })
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].rule).toBe("process.pr.max_lines");
      expect(result.violations[0].message).toContain("300 lines");
    });
  });

  describe("require_issue", () => {
    it("passes when PR body contains issue reference", async () => {
      runner.setConfig({ enabled: true, require_issue: true });
      process.env.GITHUB_EVENT_PATH = "/tmp/event.json";
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          pull_request: {
            changed_files: 1,
            additions: 10,
            deletions: 5,
            title: "Add feature",
            body: "Closes #42",
          },
        })
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("passes when PR title contains issue reference", async () => {
      runner.setConfig({ enabled: true, require_issue: true });
      process.env.GITHUB_EVENT_PATH = "/tmp/event.json";
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          pull_request: {
            changed_files: 1,
            additions: 10,
            deletions: 5,
            title: "Fixes #99 - bug fix",
            body: "Some description",
          },
        })
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when no issue reference found", async () => {
      runner.setConfig({ enabled: true, require_issue: true });
      process.env.GITHUB_EVENT_PATH = "/tmp/event.json";
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          pull_request: {
            changed_files: 1,
            additions: 10,
            deletions: 5,
            title: "Add feature",
            body: "Just some changes",
          },
        })
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === "process.pr.require_issue")).toBe(true);
    });

    it("uses custom issue keywords", async () => {
      runner.setConfig({
        enabled: true,
        require_issue: true,
        issue_keywords: ["Implements"],
      });
      process.env.GITHUB_EVENT_PATH = "/tmp/event.json";
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          pull_request: {
            changed_files: 1,
            additions: 10,
            deletions: 5,
            title: "Add feature",
            body: "Implements #42",
          },
        })
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });

  describe("combined validations", () => {
    it("reports both size and issue violations", async () => {
      runner.setConfig({
        enabled: true,
        max_files: 5,
        require_issue: true,
      });
      process.env.GITHUB_EVENT_PATH = "/tmp/event.json";
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          pull_request: {
            changed_files: 20,
            additions: 100,
            deletions: 50,
            title: "Big PR",
            body: "No issue ref",
          },
        })
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });
  });
});
