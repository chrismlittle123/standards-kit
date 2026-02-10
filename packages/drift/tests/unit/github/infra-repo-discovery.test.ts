import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import * as client from "../../../src/github/client.js";
import * as repoChecks from "../../../src/github/repo-checks.js";

describe("infra-repo-discovery", () => {
  const mockListRepos = vi.spyOn(client, "listRepos");
  const mockHasRemoteInfraConfig = vi.spyOn(repoChecks, "hasRemoteInfraConfig");
  const mockHasRecentCommits = vi.spyOn(repoChecks, "hasRecentCommits");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockListRepos.mockReset();
    mockHasRemoteInfraConfig.mockReset();
    mockHasRecentCommits.mockReset();
  });

  describe("discoverInfraRepos", () => {
    it("returns repos that have infra config enabled", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

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

      // repo-a has infra config, repo-b doesn't, repo-c has infra config
      mockHasRemoteInfraConfig
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const result = await discoverInfraRepos({
        org: "test-org",
        token: "test-token",
        includeAll: true,
      });

      expect(result.repos).toHaveLength(2);
      expect(result.repos.map((r) => r.name)).toEqual(["repo-a", "repo-c"]);
      expect(result.totalRepos).toBe(3);
      expect(result.reposWithInfra).toBe(2);
      expect(result.isOrg).toBe(true);
      expect(result.filteredByActivity).toBe(false);
    });

    it("returns empty array when no repos have infra config", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

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

      mockHasRemoteInfraConfig.mockResolvedValueOnce(false);

      const result = await discoverInfraRepos({
        org: "test-org",
        token: "test-token",
        includeAll: true,
      });

      expect(result.repos).toHaveLength(0);
      expect(result.totalRepos).toBe(1);
      expect(result.reposWithInfra).toBe(0);
    });

    it("returns empty result when org has no repos", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [],
        isOrg: true,
      });

      const result = await discoverInfraRepos({
        org: "empty-org",
        token: "test-token",
        includeAll: true,
      });

      expect(result.repos).toHaveLength(0);
      expect(result.totalRepos).toBe(0);
      expect(result.reposWithInfra).toBe(0);
      expect(result.isOrg).toBe(true);
    });

    it("works with user accounts (not orgs)", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

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

      mockHasRemoteInfraConfig.mockResolvedValueOnce(true);

      const result = await discoverInfraRepos({
        org: "test-user",
        token: "test-token",
        includeAll: true,
      });

      expect(result.repos).toHaveLength(1);
      expect(result.isOrg).toBe(false);
    });

    it("calls onProgress callback during infra config discovery", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

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

      mockHasRemoteInfraConfig.mockResolvedValue(true);

      const progressCalls: Array<{ checked: number; total: number }> = [];
      await discoverInfraRepos({
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
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

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

      let currentConcurrent = 0;
      let maxConcurrent = 0;

      mockHasRemoteInfraConfig.mockImplementation(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await Promise.resolve();
        currentConcurrent--;
        return true;
      });

      await discoverInfraRepos({
        org: "test-org",
        token: "test-token",
        concurrency: 3,
        includeAll: true,
      });

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it("filters repos by recent commit activity by default", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

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

      // Both repos have infra config
      mockHasRemoteInfraConfig.mockResolvedValue(true);

      // Only active-repo has recent commits
      mockHasRecentCommits
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const result = await discoverInfraRepos({
        org: "test-org",
        token: "test-token",
        sinceHours: 24,
      });

      expect(result.repos).toHaveLength(1);
      expect(result.repos[0].name).toBe("active-repo");
      expect(result.reposWithInfra).toBe(2);
      expect(result.filteredByActivity).toBe(true);
      expect(result.activityWindowHours).toBe(24);
    });

    it("respects custom sinceHours parameter", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

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

      mockHasRemoteInfraConfig.mockResolvedValue(true);
      mockHasRecentCommits.mockResolvedValue(true);

      const result = await discoverInfraRepos({
        org: "test-org",
        token: "test-token",
        sinceHours: 48,
      });

      expect(mockHasRecentCommits).toHaveBeenCalledWith(
        "test-org",
        "repo-a",
        48,
        "test-token"
      );
      expect(result.activityWindowHours).toBe(48);
    });

    it("calls onActivityProgress callback during activity filtering", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

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

      mockHasRemoteInfraConfig.mockResolvedValue(true);
      mockHasRecentCommits.mockResolvedValue(true);

      const activityProgressCalls: Array<{ checked: number; total: number }> =
        [];
      await discoverInfraRepos({
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

    it("returns empty result with filteredByActivity true when no repos have infra config and includeAll is false", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

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

      mockHasRemoteInfraConfig.mockResolvedValueOnce(false);

      const result = await discoverInfraRepos({
        org: "test-org",
        token: "test-token",
        sinceHours: 12,
        // includeAll defaults to false
      });

      expect(result.repos).toHaveLength(0);
      expect(result.reposWithInfra).toBe(0);
      expect(result.filteredByActivity).toBe(true);
      expect(result.activityWindowHours).toBe(12);
    });

    it("returns empty result for empty org without includeAll, with filteredByActivity true", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [],
        isOrg: true,
      });

      const result = await discoverInfraRepos({
        org: "empty-org",
        token: "test-token",
        sinceHours: 48,
        // includeAll defaults to false
      });

      expect(result.repos).toHaveLength(0);
      expect(result.totalRepos).toBe(0);
      expect(result.filteredByActivity).toBe(true);
      expect(result.activityWindowHours).toBe(48);
    });

    it("returns empty result for empty org with includeAll true, with filteredByActivity false", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [],
        isOrg: false,
      });

      const result = await discoverInfraRepos({
        org: "empty-user",
        token: "test-token",
        includeAll: true,
      });

      expect(result.repos).toHaveLength(0);
      expect(result.totalRepos).toBe(0);
      expect(result.filteredByActivity).toBe(false);
      expect(result.activityWindowHours).toBeUndefined();
      expect(result.isOrg).toBe(false);
    });

    it("uses default concurrency and sinceHours when not provided", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

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

      mockHasRemoteInfraConfig.mockResolvedValue(true);
      mockHasRecentCommits.mockResolvedValue(true);

      const result = await discoverInfraRepos({
        org: "test-org",
        token: "test-token",
        // concurrency and sinceHours default from constants
      });

      // hasRecentCommits should be called with default 24 hours
      expect(mockHasRecentCommits).toHaveBeenCalledWith(
        "test-org",
        "repo-a",
        24, // DEFAULTS.commitWindowHours
        "test-token"
      );
      expect(result.activityWindowHours).toBe(24);
    });

    it("works without token (public repos)", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "public-repo",
            full_name: "test-org/public-repo",
            clone_url: "https://github.com/test-org/public-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });

      mockHasRemoteInfraConfig.mockResolvedValue(true);

      const result = await discoverInfraRepos({
        org: "test-org",
        includeAll: true,
        // no token
      });

      expect(result.repos).toHaveLength(1);
      expect(mockHasRemoteInfraConfig).toHaveBeenCalledWith(
        "test-org",
        "public-repo",
        undefined
      );
    });

    it("returns all infra repos with no activity filtering when all have no recent activity but includeAll is true", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

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

      mockHasRemoteInfraConfig.mockResolvedValue(true);
      // hasRecentCommits should NOT be called when includeAll is true

      const result = await discoverInfraRepos({
        org: "test-org",
        token: "test-token",
        includeAll: true,
      });

      expect(result.repos).toHaveLength(2);
      expect(result.filteredByActivity).toBe(false);
      expect(result.activityWindowHours).toBeUndefined();
      expect(mockHasRecentCommits).not.toHaveBeenCalled();
    });

    it("returns empty repos when all infra repos have no recent activity", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "stale-repo-a",
            full_name: "test-org/stale-repo-a",
            clone_url: "https://github.com/test-org/stale-repo-a.git",
            archived: false,
            disabled: false,
          },
          {
            name: "stale-repo-b",
            full_name: "test-org/stale-repo-b",
            clone_url: "https://github.com/test-org/stale-repo-b.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });

      // Both repos have infra config
      mockHasRemoteInfraConfig.mockResolvedValue(true);
      // But neither has recent commits
      mockHasRecentCommits.mockResolvedValue(false);

      const result = await discoverInfraRepos({
        org: "test-org",
        token: "test-token",
        sinceHours: 24,
      });

      expect(result.repos).toHaveLength(0);
      expect(result.reposWithInfra).toBe(2);
      expect(result.filteredByActivity).toBe(true);
      expect(result.activityWindowHours).toBe(24);
    });

    it("passes org and repo name correctly to hasRemoteInfraConfig", async () => {
      const { discoverInfraRepos } =
        await import("../../../src/github/infra-repo-discovery.js");

      mockListRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "my-repo",
            full_name: "my-org/my-repo",
            clone_url: "https://github.com/my-org/my-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });

      mockHasRemoteInfraConfig.mockResolvedValueOnce(true);

      await discoverInfraRepos({
        org: "my-org",
        token: "my-token",
        includeAll: true,
      });

      expect(mockHasRemoteInfraConfig).toHaveBeenCalledWith(
        "my-org",
        "my-repo",
        "my-token"
      );
    });
  });
});
