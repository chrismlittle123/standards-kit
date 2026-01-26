import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import * as client from "./client.js";
import * as repoChecks from "./repo-checks.js";

describe("process-repo-discovery", () => {
  const mockListRepos = vi.spyOn(client, "listRepos");
  const mockHasRemoteCheckToml = vi.spyOn(repoChecks, "hasRemoteCheckToml");
  const mockHasRecentCommits = vi.spyOn(repoChecks, "hasRecentCommits");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockListRepos.mockReset();
    mockHasRemoteCheckToml.mockReset();
    mockHasRecentCommits.mockReset();
  });

  describe("discoverProcessRepos", () => {
    it("returns repos that have standards.toml", async () => {
      const { discoverProcessRepos } =
        await import("./process-repo-discovery.js");

      // Mock org with 3 repos, only 2 have standards.toml
      mockListRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "repo-a",
            full_name: "test-org/repo-a",
            clone_url: "https://github.com/test-org/repo-a.git",
            archived: false,
            disabled: false,
          },
          {
            name: "repo-b",
            full_name: "test-org/repo-b",
            clone_url: "https://github.com/test-org/repo-b.git",
            archived: false,
            disabled: false,
          },
          {
            name: "repo-c",
            full_name: "test-org/repo-c",
            clone_url: "https://github.com/test-org/repo-c.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });

      // repo-a has standards.toml, repo-b doesn't, repo-c has standards.toml
      mockHasRemoteCheckToml
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const result = await discoverProcessRepos({
        org: "test-org",
        token: "test-token",
        includeAll: true, // Skip activity filtering for this test
      });

      expect(result.repos).toHaveLength(2);
      expect(result.repos.map((r) => r.name)).toEqual(["repo-a", "repo-c"]);
      expect(result.totalRepos).toBe(3);
      expect(result.reposWithCheckToml).toBe(2);
      expect(result.isOrg).toBe(true);
      expect(result.filteredByActivity).toBe(false);
    });

    it("returns empty array when no repos have standards.toml", async () => {
      const { discoverProcessRepos } =
        await import("./process-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "repo-a",
            full_name: "test-org/repo-a",
            clone_url: "https://github.com/test-org/repo-a.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });

      mockHasRemoteCheckToml.mockResolvedValueOnce(false);

      const result = await discoverProcessRepos({
        org: "test-org",
        token: "test-token",
        includeAll: true,
      });

      expect(result.repos).toHaveLength(0);
      expect(result.totalRepos).toBe(1);
      expect(result.reposWithCheckToml).toBe(0);
    });

    it("returns empty result when org has no repos", async () => {
      const { discoverProcessRepos } =
        await import("./process-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [],
        isOrg: true,
      });

      const result = await discoverProcessRepos({
        org: "empty-org",
        token: "test-token",
        includeAll: true,
      });

      expect(result.repos).toHaveLength(0);
      expect(result.totalRepos).toBe(0);
      expect(result.reposWithCheckToml).toBe(0);
      expect(result.isOrg).toBe(true);
    });

    it("works with user accounts (not orgs)", async () => {
      const { discoverProcessRepos } =
        await import("./process-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "my-repo",
            full_name: "test-user/my-repo",
            clone_url: "https://github.com/test-user/my-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: false,
      });

      mockHasRemoteCheckToml.mockResolvedValueOnce(true);

      const result = await discoverProcessRepos({
        org: "test-user",
        token: "test-token",
        includeAll: true,
      });

      expect(result.repos).toHaveLength(1);
      expect(result.isOrg).toBe(false);
    });

    it("calls onProgress callback during discovery", async () => {
      const { discoverProcessRepos } =
        await import("./process-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "repo-a",
            full_name: "test-org/repo-a",
            clone_url: "https://github.com/test-org/repo-a.git",
            archived: false,
            disabled: false,
          },
          {
            name: "repo-b",
            full_name: "test-org/repo-b",
            clone_url: "https://github.com/test-org/repo-b.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });

      mockHasRemoteCheckToml.mockResolvedValue(true);

      const progressCalls: Array<{ checked: number; total: number }> = [];
      await discoverProcessRepos({
        org: "test-org",
        token: "test-token",
        includeAll: true,
        onProgress: (checked, total) => {
          progressCalls.push({ checked, total });
        },
      });

      expect(progressCalls).toHaveLength(2);
      expect(progressCalls[0]).toEqual({ checked: 1, total: 2 });
      expect(progressCalls[1]).toEqual({ checked: 2, total: 2 });
    });

    it("respects concurrency limit", async () => {
      const { discoverProcessRepos } =
        await import("./process-repo-discovery.js");

      // Create 10 repos to test concurrency limiting
      const repos = Array.from({ length: 10 }, (_, i) => ({
        name: `repo-${i}`,
        full_name: `test-org/repo-${i}`,
        clone_url: `https://github.com/test-org/repo-${i}.git`,
        archived: false,
        disabled: false,
      }));

      mockListRepos.mockResolvedValueOnce({
        repos,
        isOrg: true,
      });

      // Track concurrent executions
      let currentConcurrent = 0;
      let maxConcurrent = 0;

      mockHasRemoteCheckToml.mockImplementation(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        // Yield to allow other promises to start
        await Promise.resolve();
        currentConcurrent--;
        return true;
      });

      await discoverProcessRepos({
        org: "test-org",
        token: "test-token",
        concurrency: 3,
        includeAll: true,
      });

      // Max concurrent should not exceed the concurrency limit
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it("filters repos by recent commit activity by default", async () => {
      const { discoverProcessRepos } =
        await import("./process-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "active-repo",
            full_name: "test-org/active-repo",
            clone_url: "https://github.com/test-org/active-repo.git",
            archived: false,
            disabled: false,
          },
          {
            name: "inactive-repo",
            full_name: "test-org/inactive-repo",
            clone_url: "https://github.com/test-org/inactive-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });

      // Both repos have standards.toml
      mockHasRemoteCheckToml.mockResolvedValue(true);

      // Only active-repo has recent commits
      mockHasRecentCommits
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const result = await discoverProcessRepos({
        org: "test-org",
        token: "test-token",
        sinceHours: 24,
      });

      expect(result.repos).toHaveLength(1);
      expect(result.repos[0].name).toBe("active-repo");
      expect(result.reposWithCheckToml).toBe(2);
      expect(result.filteredByActivity).toBe(true);
      expect(result.activityWindowHours).toBe(24);
    });

    it("respects custom sinceHours parameter", async () => {
      const { discoverProcessRepos } =
        await import("./process-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "repo-a",
            full_name: "test-org/repo-a",
            clone_url: "https://github.com/test-org/repo-a.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });

      mockHasRemoteCheckToml.mockResolvedValue(true);
      mockHasRecentCommits.mockResolvedValue(true);

      const result = await discoverProcessRepos({
        org: "test-org",
        token: "test-token",
        sinceHours: 48,
      });

      // Verify hasRecentCommits was called with 48 hours
      expect(mockHasRecentCommits).toHaveBeenCalledWith(
        "test-org",
        "repo-a",
        48,
        "test-token"
      );
      expect(result.activityWindowHours).toBe(48);
    });

    it("calls onActivityProgress callback during activity filtering", async () => {
      const { discoverProcessRepos } =
        await import("./process-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "repo-a",
            full_name: "test-org/repo-a",
            clone_url: "https://github.com/test-org/repo-a.git",
            archived: false,
            disabled: false,
          },
          {
            name: "repo-b",
            full_name: "test-org/repo-b",
            clone_url: "https://github.com/test-org/repo-b.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });

      mockHasRemoteCheckToml.mockResolvedValue(true);
      mockHasRecentCommits.mockResolvedValue(true);

      const activityProgressCalls: Array<{ checked: number; total: number }> =
        [];
      await discoverProcessRepos({
        org: "test-org",
        token: "test-token",
        onActivityProgress: (checked, total) => {
          activityProgressCalls.push({ checked, total });
        },
      });

      expect(activityProgressCalls).toHaveLength(2);
      expect(activityProgressCalls[0]).toEqual({ checked: 1, total: 2 });
      expect(activityProgressCalls[1]).toEqual({ checked: 2, total: 2 });
    });
  });
});
