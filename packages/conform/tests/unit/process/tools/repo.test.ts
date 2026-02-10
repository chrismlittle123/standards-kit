vi.mock("execa");
vi.mock("node:fs");

import * as fs from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";

import { RepoRunner } from "../../../../src/process/tools/repo.js";

const mockedExeca = vi.mocked(execa);
const mockedFs = vi.mocked(fs);

beforeEach(() => vi.clearAllMocks());

/** Helper to set up gh CLI as available and configure repo info */
function setupGhAvailable(owner = "myorg", repo = "myrepo"): void {
  mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
    if (cmd === "gh" && args[0] === "--version") {
      return Promise.resolve({ stdout: "gh version 2.0.0" });
    }
    if (cmd === "gh" && args[0] === "repo" && args[1] === "view") {
      return Promise.resolve({
        stdout: JSON.stringify({ owner: { login: owner }, name: repo }),
      });
    }
    if (cmd === "gh" && args[0] === "api") {
      return Promise.resolve({ stdout: "[]" });
    }
    return Promise.reject(new Error("unexpected call"));
  }) as typeof execa);
}

describe("RepoRunner", () => {
  let runner: RepoRunner;

  beforeEach(() => {
    runner = new RepoRunner();
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("Repository");
    expect(runner.rule).toBe("process.repo");
    expect(runner.toolId).toBe("repo");
  });

  describe("skip cases", () => {
    it("skips when gh CLI is not available", async () => {
      runner.setConfig({ enabled: true });
      mockedExeca.mockRejectedValue(new Error("command not found"));

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("GitHub CLI (gh) not available");
    });

    it("skips when repo info cannot be determined", async () => {
      runner.setConfig({ enabled: true });
      mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "--version") {
          return Promise.resolve({ stdout: "gh version 2.0.0" });
        }
        return Promise.reject(new Error("not a repo"));
      }) as typeof execa);

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Could not determine GitHub repository");
    });
  });

  describe("codeowners check", () => {
    it("passes when CODEOWNERS exists in .github/", async () => {
      runner.setConfig({ enabled: true, require_codeowners: true });
      setupGhAvailable();
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({ isFile: () => true } as fs.Stats);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when CODEOWNERS is missing everywhere", async () => {
      runner.setConfig({ enabled: true, require_codeowners: true });
      setupGhAvailable();
      mockedFs.existsSync.mockReturnValue(false);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("codeowners"))).toBe(true);
    });
  });

  describe("branch protection", () => {
    it("passes when branch has active ruleset matching main", async () => {
      runner.setConfig({
        enabled: true,
        require_branch_protection: true,
      });
      mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "--version") {
          return Promise.resolve({ stdout: "gh version 2.0.0" });
        }
        if (cmd === "gh" && args[0] === "repo") {
          return Promise.resolve({
            stdout: JSON.stringify({ owner: { login: "org" }, name: "repo" }),
          });
        }
        if (cmd === "gh" && args[0] === "api") {
          return Promise.resolve({
            stdout: JSON.stringify([
              {
                id: 1,
                name: "Branch Protection",
                target: "branch",
                enforcement: "active",
                conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
                rules: [],
              },
            ]),
          });
        }
        return Promise.reject(new Error("unexpected"));
      }) as typeof execa);
      mockedFs.existsSync.mockReturnValue(false);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when no active branch ruleset found", async () => {
      runner.setConfig({
        enabled: true,
        require_branch_protection: true,
      });
      mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "--version") {
          return Promise.resolve({ stdout: "gh version 2.0.0" });
        }
        if (cmd === "gh" && args[0] === "repo") {
          return Promise.resolve({
            stdout: JSON.stringify({ owner: { login: "org" }, name: "repo" }),
          });
        }
        if (cmd === "gh" && args[0] === "api") {
          return Promise.resolve({ stdout: "[]" });
        }
        return Promise.reject(new Error("unexpected"));
      }) as typeof execa);
      mockedFs.existsSync.mockReturnValue(false);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("branch_protection"))).toBe(true);
    });

    it("handles 403 error as warning", async () => {
      runner.setConfig({
        enabled: true,
        require_branch_protection: true,
      });
      mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "--version") {
          return Promise.resolve({ stdout: "gh version 2.0.0" });
        }
        if (cmd === "gh" && args[0] === "repo") {
          return Promise.resolve({
            stdout: JSON.stringify({ owner: { login: "org" }, name: "repo" }),
          });
        }
        if (cmd === "gh" && args[0] === "api") {
          return Promise.reject(new Error("403 Forbidden"));
        }
        return Promise.reject(new Error("unexpected"));
      }) as typeof execa);
      mockedFs.existsSync.mockReturnValue(false);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.severity === "warning")).toBe(true);
    });

    it("handles 404 error for branch protection", async () => {
      runner.setConfig({
        enabled: true,
        require_branch_protection: true,
      });
      mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "--version") {
          return Promise.resolve({ stdout: "gh version 2.0.0" });
        }
        if (cmd === "gh" && args[0] === "repo") {
          return Promise.resolve({
            stdout: JSON.stringify({ owner: { login: "org" }, name: "repo" }),
          });
        }
        if (cmd === "gh" && args[0] === "api") {
          return Promise.reject(new Error("404 Not Found"));
        }
        return Promise.reject(new Error("unexpected"));
      }) as typeof execa);
      mockedFs.existsSync.mockReturnValue(false);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
    });
  });

  describe("ruleset validation", () => {
    it("validates required reviews count", async () => {
      runner.setConfig({
        enabled: true,
        ruleset: { branch: "main", required_reviews: 2 },
      });
      mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "--version") {
          return Promise.resolve({ stdout: "gh version 2.0.0" });
        }
        if (cmd === "gh" && args[0] === "repo") {
          return Promise.resolve({
            stdout: JSON.stringify({ owner: { login: "org" }, name: "repo" }),
          });
        }
        if (cmd === "gh" && args[0] === "api") {
          return Promise.resolve({
            stdout: JSON.stringify([
              {
                id: 1,
                name: "BP",
                target: "branch",
                enforcement: "active",
                conditions: { ref_name: { include: ["main"] } },
                rules: [
                  {
                    type: "pull_request",
                    parameters: { required_approving_review_count: 1 },
                  },
                ],
              },
            ]),
          });
        }
        return Promise.reject(new Error("unexpected"));
      }) as typeof execa);
      mockedFs.existsSync.mockReturnValue(false);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("required_reviews"))).toBe(true);
    });

    it("validates required signed commits", async () => {
      runner.setConfig({
        enabled: true,
        ruleset: { branch: "main", require_signed_commits: true },
      });
      mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "--version") {
          return Promise.resolve({ stdout: "gh version 2.0.0" });
        }
        if (cmd === "gh" && args[0] === "repo") {
          return Promise.resolve({
            stdout: JSON.stringify({ owner: { login: "org" }, name: "repo" }),
          });
        }
        if (cmd === "gh" && args[0] === "api") {
          return Promise.resolve({
            stdout: JSON.stringify([
              {
                id: 1,
                name: "BP",
                target: "branch",
                enforcement: "active",
                conditions: { ref_name: { include: ["main"] } },
                rules: [],
              },
            ]),
          });
        }
        return Promise.reject(new Error("unexpected"));
      }) as typeof execa);
      mockedFs.existsSync.mockReturnValue(false);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(
        result.violations.some((v) => v.rule.includes("require_signed_commits"))
      ).toBe(true);
    });
  });

  describe("tag protection", () => {
    it("fails when no tag ruleset found", async () => {
      runner.setConfig({
        enabled: true,
        tag_protection: { patterns: ["v*"] },
      });
      mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
        if (cmd === "gh" && args[0] === "--version") {
          return Promise.resolve({ stdout: "gh version 2.0.0" });
        }
        if (cmd === "gh" && args[0] === "repo") {
          return Promise.resolve({
            stdout: JSON.stringify({ owner: { login: "org" }, name: "repo" }),
          });
        }
        if (cmd === "gh" && args[0] === "api") {
          return Promise.resolve({ stdout: "[]" });
        }
        return Promise.reject(new Error("unexpected"));
      }) as typeof execa);
      mockedFs.existsSync.mockReturnValue(false);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("tag_protection"))).toBe(true);
    });
  });
});
