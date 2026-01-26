import { describe, it, expect, afterEach, vi } from "vitest";
import * as apiUtils from "./api-utils.js";

describe("repo-checks", () => {
  const mockFetchWithRetry = vi.spyOn(apiUtils, "fetchWithRetry");

  afterEach(() => {
    mockFetchWithRetry.mockReset();
  });

  describe("fileExists", () => {
    it("returns true when file exists", async () => {
      const { fileExists } = await import("./repo-checks.js");

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
      const { fileExists } = await import("./repo-checks.js");

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
  });

  describe("isRepoScannable", () => {
    it("returns true when both metadata and standards.toml exist", async () => {
      const { isRepoScannable } = await import("./repo-checks.js");

      mockFetchWithRetry
        .mockResolvedValueOnce(new Response("{}", { status: 200 })) // repo-metadata.yaml
        .mockResolvedValueOnce(new Response("{}", { status: 404 })) // repo-metadata.yml
        .mockResolvedValueOnce(new Response("{}", { status: 200 })); // standards.toml

      const result = await isRepoScannable("test-org", "test-repo");

      expect(result).toBe(true);
    });

    it("returns false when metadata file is missing", async () => {
      const { isRepoScannable } = await import("./repo-checks.js");

      mockFetchWithRetry
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

      const result = await isRepoScannable("test-org", "test-repo");

      expect(result).toBe(false);
    });
  });

  describe("hasRemoteCheckToml", () => {
    it("returns true when standards.toml exists", async () => {
      const { hasRemoteCheckToml } = await import("./repo-checks.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("{}", { status: 200 })
      );

      const result = await hasRemoteCheckToml("test-org", "test-repo");

      expect(result).toBe(true);
      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining(
          "/repos/test-org/test-repo/contents/standards.toml"
        ),
        expect.any(Object),
        undefined
      );
    });

    it("returns false when standards.toml does not exist", async () => {
      const { hasRemoteCheckToml } = await import("./repo-checks.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("Not Found", { status: 404 })
      );

      const result = await hasRemoteCheckToml("test-org", "test-repo");

      expect(result).toBe(false);
    });

    it("passes token to request headers", async () => {
      const { hasRemoteCheckToml } = await import("./repo-checks.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response("{}", { status: 200 })
      );

      await hasRemoteCheckToml("test-org", "test-repo", "my-token");

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

  describe("hasRecentCommits", () => {
    it("returns true when main branch has recent commits", async () => {
      const { hasRecentCommits } = await import("./repo-checks.js");

      // Mock response with one commit
      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify([{ sha: "abc123" }]), { status: 200 })
      );

      const result = await hasRecentCommits("test-org", "test-repo", 24);

      expect(result).toBe(true);
      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining("/repos/test-org/test-repo/commits"),
        expect.any(Object),
        undefined
      );
      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining("sha=main"),
        expect.any(Object),
        undefined
      );
    });

    it("returns false when main branch has no recent commits", async () => {
      const { hasRecentCommits } = await import("./repo-checks.js");

      // Mock response with empty array (no commits)
      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 })
      );

      const result = await hasRecentCommits("test-org", "test-repo", 24);

      expect(result).toBe(false);
    });

    it("falls back to master branch when main returns 404", async () => {
      const { hasRecentCommits } = await import("./repo-checks.js");

      // Main branch returns 404, master returns commits
      mockFetchWithRetry
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ sha: "def456" }]), { status: 200 })
        );

      const result = await hasRecentCommits("test-org", "test-repo", 24);

      expect(result).toBe(true);
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
      expect(mockFetchWithRetry).toHaveBeenLastCalledWith(
        expect.stringContaining("sha=master"),
        expect.any(Object),
        undefined
      );
    });

    it("returns false when both main and master return 404", async () => {
      const { hasRecentCommits } = await import("./repo-checks.js");

      mockFetchWithRetry
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

      const result = await hasRecentCommits("test-org", "test-repo", 24);

      expect(result).toBe(false);
    });

    it("returns false when master branch has no recent commits", async () => {
      const { hasRecentCommits } = await import("./repo-checks.js");

      // Main branch returns 404, master returns empty
      mockFetchWithRetry
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify([]), { status: 200 })
        );

      const result = await hasRecentCommits("test-org", "test-repo", 24);

      expect(result).toBe(false);
    });

    it("passes token to request headers", async () => {
      const { hasRecentCommits } = await import("./repo-checks.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify([{ sha: "abc" }]), { status: 200 })
      );

      await hasRecentCommits("test-org", "test-repo", 24, "my-token");

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

    it("includes since parameter with correct timestamp", async () => {
      const { hasRecentCommits } = await import("./repo-checks.js");

      mockFetchWithRetry.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 })
      );

      await hasRecentCommits("test-org", "test-repo", 48);

      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining("since="),
        expect.any(Object),
        undefined
      );
    });
  });
});
