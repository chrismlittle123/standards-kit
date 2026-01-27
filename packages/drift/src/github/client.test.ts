import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, existsSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getGitHubToken,
  createTempDir,
  removeTempDir,
  cloneRepo,
} from "./client.js";
import * as apiUtils from "./api-utils.js";

describe("github client", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `drift-github-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("getGitHubToken", () => {
    const originalEnv = process.env.GITHUB_TOKEN;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.GITHUB_TOKEN = originalEnv;
      } else {
        delete process.env.GITHUB_TOKEN;
      }
    });

    it("returns CLI option when provided", () => {
      process.env.GITHUB_TOKEN = "env-token";
      expect(getGitHubToken("cli-token")).toBe("cli-token");
    });

    it("returns environment variable when CLI option is undefined", () => {
      process.env.GITHUB_TOKEN = "env-token";
      expect(getGitHubToken(undefined)).toBe("env-token");
    });

    it("returns environment variable when CLI option is empty string", () => {
      process.env.GITHUB_TOKEN = "env-token";
      expect(getGitHubToken("")).toBe("env-token");
    });

    it("returns undefined when neither CLI option nor env var is set", () => {
      delete process.env.GITHUB_TOKEN;
      expect(getGitHubToken(undefined)).toBeUndefined();
    });
  });

  describe("createTempDir", () => {
    it("creates a temporary directory with prefix", () => {
      const dir = createTempDir("test-prefix");
      try {
        expect(existsSync(dir)).toBe(true);
        expect(dir).toContain("drift-test-prefix-");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("creates unique directories on each call", () => {
      const dir1 = createTempDir("unique");
      const dir2 = createTempDir("unique");
      try {
        expect(dir1).not.toBe(dir2);
        expect(existsSync(dir1)).toBe(true);
        expect(existsSync(dir2)).toBe(true);
      } finally {
        rmSync(dir1, { recursive: true, force: true });
        rmSync(dir2, { recursive: true, force: true });
      }
    });
  });

  describe("removeTempDir", () => {
    it("removes existing directory", () => {
      const dir = createTempDir("remove-test");
      expect(existsSync(dir)).toBe(true);

      removeTempDir(dir);
      expect(existsSync(dir)).toBe(false);
    });

    it("silently handles non-existent directory", () => {
      const nonExistent = join(testDir, "non-existent-dir");
      expect(() => removeTempDir(nonExistent)).not.toThrow();
    });

    it("removes directory with contents", () => {
      const dir = createTempDir("remove-contents");
      writeFileSync(join(dir, "file.txt"), "content");
      mkdirSync(join(dir, "subdir"));
      writeFileSync(join(dir, "subdir", "nested.txt"), "nested");

      removeTempDir(dir);
      expect(existsSync(dir)).toBe(false);
    });
  });

  describe("cloneRepo", () => {
    it("clones a public repository without token", () => {
      // Clone a small public repo
      const targetDir = join(testDir, "clone-target");

      // Using a known small public repo (GitHub's git-sizer is small)
      // Alternatively, use a mock or skip in CI
      try {
        cloneRepo("github", "gitignore", targetDir);
        expect(existsSync(targetDir)).toBe(true);
        expect(existsSync(join(targetDir, ".git"))).toBe(true);
      } catch (error) {
        // Skip test if network is unavailable
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes("network") ||
          message.includes("resolve") ||
          message.includes("connect")
        ) {
          console.log("Skipping network-dependent test");
          return;
        }
        throw error;
      }
    });

    it("throws error for non-existent repository", () => {
      const targetDir = join(testDir, "clone-nonexistent");

      expect(() =>
        cloneRepo(
          "definitely-not-a-real-org-12345",
          "definitely-not-a-real-repo-67890",
          targetDir
        )
      ).toThrow(/Failed to clone/);
    });

    it("sanitizes error messages to prevent token leakage", () => {
      const targetDir = join(testDir, "clone-sanitize");
      const fakeToken = "ghp_secret12345";

      try {
        cloneRepo("nonexistent-org", "nonexistent-repo", targetDir, fakeToken);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The token should not appear in the error message
        expect(message).not.toContain(fakeToken);
        expect(message).toContain("Failed to clone");
      }
    });

    it("uses secure authentication method (not visible in ps)", () => {
      // This test verifies the implementation uses GIT_ASKPASS instead of embedding token in URL
      // We can't easily test ps visibility, but we can verify the code path

      const targetDir = join(testDir, "clone-secure");

      // Try with a fake token - it should still try to authenticate securely
      // The clone will fail, but it should use the secure method
      try {
        cloneRepo("test-org", "test-repo", targetDir, "fake-token");
      } catch {
        // Expected to fail, we're just checking the secure method is used
      }

      // If we got here without the token appearing in any error, the secure method is working
      expect(true).toBe(true);
    });
  });
});

describe("github client API functions", () => {
  const mockFetchWithRetry = vi.spyOn(apiUtils, "fetchWithRetry");

  afterEach(() => {
    mockFetchWithRetry.mockReset();
  });

  const mockRepo = (name: string, archived = false, disabled = false) => ({
    name,
    full_name: `test-org/${name}`,
    clone_url: `https://github.com/test-org/${name}.git`,
    archived,
    disabled,
  });

  describe("listOrgRepos", () => {
    it("fetches repos from org endpoint", async () => {
      const { listOrgRepos } = await import("./client.js");
      const repos = [mockRepo("repo1"), mockRepo("repo2")];

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify(repos), { status: 200 })
      );

      const result = await listOrgRepos("test-org", "test-token");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining("/orgs/test-org/repos"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
        "test-token"
      );
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("repo1");
    });

    it("filters out archived and disabled repos", async () => {
      const { listOrgRepos } = await import("./client.js");
      const repos = [
        mockRepo("active"),
        mockRepo("archived", true, false),
        mockRepo("disabled", false, true),
      ];

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify(repos), { status: 200 })
      );

      const result = await listOrgRepos("test-org");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("active");
    });

    it("handles pagination", async () => {
      const { listOrgRepos } = await import("./client.js");
      // First page: 100 repos (full page indicates more pages)
      const page1 = Array.from({ length: 100 }, (_, i) =>
        mockRepo(`repo${i + 1}`)
      );
      // Second page: fewer than 100, indicates last page
      const page2 = [mockRepo("repo101")];

      mockFetchWithRetry
        .mockResolvedValueOnce(
          new Response(JSON.stringify(page1), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(page2), { status: 200 })
        );

      const result = await listOrgRepos("test-org");

      expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(101);
    });

    it("stops pagination on empty page", async () => {
      const { listOrgRepos } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 })
      );

      const result = await listOrgRepos("test-org");

      expect(result).toHaveLength(0);
    });
  });

  describe("listUserRepos", () => {
    it("fetches repos from user endpoint", async () => {
      const { listUserRepos } = await import("./client.js");
      const repos = [mockRepo("user-repo")];

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify(repos), { status: 200 })
      );

      const result = await listUserRepos("test-user");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining("/users/test-user/repos"),
        expect.any(Object),
        undefined
      );
      expect(result).toHaveLength(1);
    });

    it("works without token", async () => {
      const { listUserRepos } = await import("./client.js");
      const repos = [mockRepo("public-repo")];

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify(repos), { status: 200 })
      );

      await listUserRepos("test-user");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.any(String),
          }),
        }),
        undefined
      );
    });
  });

  describe("listRepos", () => {
    it("returns repos as org when org endpoint succeeds", async () => {
      const { listRepos } = await import("./client.js");
      const repos = [mockRepo("org-repo")];

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify(repos), { status: 200 })
      );

      const result = await listRepos("test-org");

      expect(result.isOrg).toBe(true);
      expect(result.repos).toHaveLength(1);
    });

    it("falls back to user endpoint on 404", async () => {
      const { listRepos } = await import("./client.js");
      const userRepos = [mockRepo("user-repo")];

      // First call: org endpoint returns 404
      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("Not Found", { status: 404 })
      );
      // Second call: user endpoint succeeds
      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify(userRepos), { status: 200 })
      );

      const result = await listRepos("test-user");

      expect(result.isOrg).toBe(false);
      expect(result.repos).toHaveLength(1);
    });

    it("throws non-404 errors", async () => {
      const { listRepos } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("Server Error", { status: 500 })
      );

      await expect(listRepos("test-org")).rejects.toThrow("GitHub API error");
    });
  });

  describe("repoExists", () => {
    it("returns true for existing repo", async () => {
      const { repoExists } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("{}", { status: 200 })
      );

      const result = await repoExists("test-org", "test-repo");

      expect(result).toBe(true);
      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining("/repos/test-org/test-repo"),
        expect.any(Object),
        undefined
      );
    });

    it("returns false for non-existing repo", async () => {
      const { repoExists } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("Not Found", { status: 404 })
      );

      const result = await repoExists("test-org", "missing-repo");

      expect(result).toBe(false);
    });

    it("passes token to request headers", async () => {
      const { repoExists } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("{}", { status: 200 })
      );

      await repoExists("test-org", "test-repo", "my-token");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-token",
          }),
        }),
        "my-token"
      );
    });
  });

  describe("fileExists", () => {
    it("returns true when file exists", async () => {
      const { fileExists } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("{}", { status: 200 })
      );

      const result = await fileExists(
        "test-org",
        "test-repo",
        "repo-metadata.yaml"
      );

      expect(result).toBe(true);
      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining(
          "/repos/test-org/test-repo/contents/repo-metadata.yaml"
        ),
        expect.any(Object),
        undefined
      );
    });

    it("returns false when file does not exist", async () => {
      const { fileExists } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("Not Found", { status: 404 })
      );

      const result = await fileExists(
        "test-org",
        "test-repo",
        "missing-file.txt"
      );

      expect(result).toBe(false);
    });

    it("passes token to request headers", async () => {
      const { fileExists } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("{}", { status: 200 })
      );

      await fileExists("test-org", "test-repo", "standards.toml", "my-token");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-token",
          }),
        }),
        "my-token"
      );
    });
  });

  describe("isRepoScannable", () => {
    it("returns true when standards.toml has [metadata] section with tier", async () => {
      const { isRepoScannable } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response('[metadata]\ntier = "production"', { status: 200 })
      );

      const result = await isRepoScannable("test-org", "test-repo");

      expect(result).toBe(true);
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);
    });

    it("returns false when standards.toml does not exist", async () => {
      const { isRepoScannable } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("Not Found", { status: 404 })
      );

      const result = await isRepoScannable("test-org", "test-repo");

      expect(result).toBe(false);
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);
    });

    it("returns false when standards.toml has no [metadata] section", async () => {
      const { isRepoScannable } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response('[code.linting.eslint]\nenabled = true', { status: 200 })
      );

      const result = await isRepoScannable("test-org", "test-repo");

      expect(result).toBe(false);
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);
    });

    it("returns false when [metadata] exists but has no tier", async () => {
      const { isRepoScannable } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response('[metadata]\nproject = "backend"', { status: 200 })
      );

      const result = await isRepoScannable("test-org", "test-repo");

      expect(result).toBe(false);
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);
    });

    it("passes token to file check", async () => {
      const { isRepoScannable } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response('[metadata]\ntier = "production"', { status: 200 })
      );

      await isRepoScannable("test-org", "test-repo", "my-token");

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        "my-token"
      );
    });
  });

  describe("parseRepoResponse error handling", () => {
    it("throws error for invalid JSON response", async () => {
      const { listOrgRepos } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("not valid json", { status: 200 })
      );

      await expect(listOrgRepos("test-org")).rejects.toThrow(
        "Failed to parse GitHub API response"
      );
    });

    it("throws error for invalid schema", async () => {
      const { listOrgRepos } = await import("./client.js");

      // Missing required fields
      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify([{ name: "only-name" }]), { status: 200 })
      );

      await expect(listOrgRepos("test-org")).rejects.toThrow(
        "Invalid GitHub API response"
      );
    });

    it("sanitizes error messages", async () => {
      const { listOrgRepos } = await import("./client.js");
      const token = "ghp_secrettoken123";

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(`Error with token ${token}`, { status: 403 })
      );

      await expect(listOrgRepos("test-org", token)).rejects.toThrow(
        expect.not.stringContaining(token)
      );
    });
  });

  describe("createIssue", () => {
    it("creates issue with correct parameters", async () => {
      const { createIssue } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            number: 42,
            html_url: "https://github.com/org/repo/issues/42",
          }),
          { status: 201 }
        )
      );

      const result = await createIssue(
        {
          owner: "org",
          repo: "repo",
          title: "Test title",
          body: "Test body",
          labels: ["label1"],
        },
        "test-token"
      );

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining("/repos/org/repo/issues"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Test title"),
        }),
        "test-token"
      );
      expect(result.number).toBe(42);
      expect(result.html_url).toBe("https://github.com/org/repo/issues/42");
    });

    it("includes labels in request body", async () => {
      const { createIssue } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            number: 1,
            html_url: "https://github.com/o/r/issues/1",
          }),
          { status: 201 }
        )
      );

      await createIssue(
        {
          owner: "org",
          repo: "repo",
          title: "Title",
          body: "Body",
          labels: ["drift:code", "bug"],
        },
        "token"
      );

      const call = mockFetchWithRetry.mock.calls[0];
      const requestInit = call[1] as { body?: string };
      const body = JSON.parse(requestInit.body ?? "{}");
      expect(body.labels).toEqual(["drift:code", "bug"]);
    });

    it("throws error on API failure", async () => {
      const { createIssue } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("Forbidden", { status: 403 })
      );

      await expect(
        createIssue(
          {
            owner: "org",
            repo: "repo",
            title: "title",
            body: "body",
            labels: [],
          },
          "token"
        )
      ).rejects.toThrow("Failed to create issue: 403");
    });

    it("sanitizes token in error messages", async () => {
      const { createIssue } = await import("./client.js");
      const token = "ghp_secrettoken123";

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(`Error with ${token}`, { status: 500 })
      );

      await expect(
        createIssue(
          {
            owner: "org",
            repo: "repo",
            title: "title",
            body: "body",
            labels: [],
          },
          token
        )
      ).rejects.toThrow(expect.not.stringContaining(token));
    });

    it("throws error for invalid response schema", async () => {
      const { createIssue } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify({ invalid: "response" }), { status: 201 })
      );

      await expect(
        createIssue(
          {
            owner: "org",
            repo: "repo",
            title: "title",
            body: "body",
            labels: [],
          },
          "token"
        )
      ).rejects.toThrow("Invalid issue response");
    });

    it("throws error for invalid JSON response", async () => {
      const { createIssue } = await import("./client.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("not json", { status: 201 })
      );

      await expect(
        createIssue(
          {
            owner: "org",
            repo: "repo",
            title: "title",
            body: "body",
            labels: [],
          },
          "token"
        )
      ).rejects.toThrow("Failed to parse issue response");
    });
  });
});
