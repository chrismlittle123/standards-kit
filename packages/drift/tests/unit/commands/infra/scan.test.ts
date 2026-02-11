import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock external modules before imports
vi.mock("@standards-kit/conform", () => ({
  loadConfig: vi.fn(),
  scanInfra: vi.fn(),
}));

vi.mock("../../../../src/version.js", () => ({
  version: "1.0.0-test",
}));

vi.mock("../../../../src/utils/index.js", () => ({
  actionsOutput: {
    error: vi.fn(),
    warning: vi.fn(),
    notice: vi.fn(),
  },
  COLORS: {
    reset: "",
    bold: "",
    dim: "",
    red: "",
    green: "",
    yellow: "",
    cyan: "",
    white: "",
  },
}));

vi.mock("../../../../src/github/client.js", () => ({
  createIssue: vi.fn(),
  getGitHubToken: vi.fn(),
  cloneRepo: vi.fn(),
  createTempDir: vi.fn(),
  removeTempDir: vi.fn(),
}));

vi.mock("../../../../src/github/infra-repo-discovery.js", () => ({
  discoverInfraRepos: vi.fn(),
}));

vi.mock("../../../../src/github/infra-issue-formatter.js", () => ({
  formatInfraDriftIssueBody: vi.fn(() => "issue body"),
  getInfraDriftIssueTitle: vi.fn(
    () => "[drift:infra] Infrastructure drift detected"
  ),
  getInfraDriftIssueLabel: vi.fn(() => "drift:infra"),
}));

vi.mock("../../../../src/constants.js", () => ({
  CONCURRENCY: { maxRepoScans: 5 },
}));

import { loadConfig, scanInfra } from "@standards-kit/conform";
import {
  createIssue,
  getGitHubToken,
  cloneRepo,
  createTempDir,
  removeTempDir,
} from "../../../../src/github/client.js";
import { discoverInfraRepos } from "../../../../src/github/infra-repo-discovery.js";
import { scan } from "../../../../src/commands/infra/scan.js";

describe("commands/infra/scan", () => {
  const mockLoadConfig = vi.mocked(loadConfig);
  const mockScanInfra = vi.mocked(scanInfra);
  const mockCreateIssue = vi.mocked(createIssue);
  const mockGetGitHubToken = vi.mocked(getGitHubToken);
  const mockCloneRepo = vi.mocked(cloneRepo);
  const mockCreateTempDir = vi.mocked(createTempDir);
  const mockRemoveTempDir = vi.mocked(removeTempDir);
  const mockDiscoverInfraRepos = vi.mocked(discoverInfraRepos);

  let mockExit: ReturnType<typeof vi.spyOn>;

  /** Helper to mock loadConfig returning an enabled infra config */
  function mockInfraConfig(manifest?: string) {
    mockLoadConfig.mockReturnValue({
      config: {
        infra: {
          enabled: true,
          manifest: manifest ?? "infra-manifest.json",
        },
      },
      configPath: "/tmp/drift-infra-test/standards.toml",
    } as any);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    // Default mocks
    mockCreateTempDir.mockReturnValue("/tmp/drift-infra-test");
    mockGetGitHubToken.mockReturnValue("test-token");
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  describe("validation", () => {
    it("exits with error when neither --repo nor --org is specified", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await scan({});

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Either --repo or --org must be specified")
      );
      consoleSpy.mockRestore();
    });

    it("exits with error when no GitHub token is available", async () => {
      mockGetGitHubToken.mockReturnValue(undefined);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await scan({ repo: "owner/repo" });

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("GitHub token required")
      );
      consoleSpy.mockRestore();
    });

    it("exits with error when repo format is invalid (no slash)", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await scan({ repo: "invalid-repo" });

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("owner/repo format")
      );
      consoleSpy.mockRestore();
    });
  });

  describe("single repo scanning", () => {
    it("scans a single repo and reports no drift", async () => {
      mockInfraConfig();
      mockScanInfra.mockResolvedValueOnce({
        manifest: "/tmp/drift-infra-test/infra-manifest.json",
        summary: { total: 2, found: 2, missing: 0, errors: 0 },
        results: [
          {
            arn: "arn:aws:s3:::bucket-1",
            exists: true,
            service: "s3",
            resourceType: "bucket",
            resourceId: "bucket-1",
          },
          {
            arn: "arn:aws:s3:::bucket-2",
            exists: true,
            service: "s3",
            resourceType: "bucket",
            resourceId: "bucket-2",
          },
        ],
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ repo: "my-org/my-repo", json: true });

      expect(mockCloneRepo).toHaveBeenCalledWith(
        "my-org",
        "my-repo",
        "/tmp/drift-infra-test",
        "test-token"
      );
      expect(mockScanInfra).toHaveBeenCalled();
      expect(mockRemoveTempDir).toHaveBeenCalledWith("/tmp/drift-infra-test");
      expect(mockExit).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("creates an issue when drift is detected", async () => {
      mockInfraConfig();
      mockScanInfra.mockResolvedValueOnce({
        manifest: "/tmp/drift-infra-test/infra-manifest.json",
        summary: { total: 2, found: 1, missing: 1, errors: 0 },
        results: [
          {
            arn: "arn:aws:s3:::bucket-1",
            exists: true,
            service: "s3",
            resourceType: "bucket",
            resourceId: "bucket-1",
          },
          {
            arn: "arn:aws:s3:::bucket-2",
            exists: false,
            service: "s3",
            resourceType: "bucket",
            resourceId: "bucket-2",
          },
        ],
      });
      mockCreateIssue.mockResolvedValueOnce({
        number: 10,
        html_url: "https://github.com/my-org/my-repo/issues/10",
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ repo: "my-org/my-repo", json: true });

      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "my-org",
          repo: "my-repo",
          title: "[drift:infra] Infrastructure drift detected",
        }),
        "test-token"
      );
      expect(mockExit).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
    });

    it("does not create issue in dry-run mode", async () => {
      mockInfraConfig();
      mockScanInfra.mockResolvedValueOnce({
        manifest: "/tmp/drift-infra-test/infra-manifest.json",
        summary: { total: 1, found: 0, missing: 1, errors: 0 },
        results: [
          {
            arn: "arn:aws:s3:::bucket-1",
            exists: false,
            service: "s3",
            resourceType: "bucket",
            resourceId: "bucket-1",
          },
        ],
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ repo: "my-org/my-repo", dryRun: true });

      expect(mockCreateIssue).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("exits with error when drift has errors", async () => {
      mockInfraConfig();
      mockScanInfra.mockResolvedValueOnce({
        manifest: "/tmp/drift-infra-test/infra-manifest.json",
        summary: { total: 1, found: 0, missing: 0, errors: 1 },
        results: [
          {
            arn: "arn:aws:s3:::bucket-1",
            exists: false,
            error: "Access denied",
            service: "s3",
            resourceType: "bucket",
            resourceId: "bucket-1",
          },
        ],
      });
      mockCreateIssue.mockResolvedValueOnce({
        number: 5,
        html_url: "https://github.com/my-org/my-repo/issues/5",
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ repo: "my-org/my-repo", json: true });

      expect(mockExit).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
    });

    it("cleans up temp dir even when scan throws", async () => {
      mockLoadConfig.mockImplementation(() => {
        throw new Error("File not found");
      });

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      await scan({ repo: "my-org/my-repo", json: true });

      expect(mockRemoveTempDir).toHaveBeenCalledWith("/tmp/drift-infra-test");
      expect(mockExit).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
    });

    it("uses default manifest filename when not specified in config", async () => {
      mockInfraConfig();
      mockScanInfra.mockResolvedValueOnce({
        manifest: "/tmp/drift-infra-test/infra-manifest.json",
        summary: { total: 0, found: 0, missing: 0, errors: 0 },
        results: [],
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ repo: "my-org/my-repo", json: true });

      // scanInfra should be called with the default manifest path
      expect(mockScanInfra).toHaveBeenCalledWith(
        expect.objectContaining({
          manifestPath: expect.stringContaining("infra-manifest.json"),
        })
      );
      consoleSpy.mockRestore();
    });
  });

  describe("org-wide scanning", () => {
    it("scans all discovered repos in an org", async () => {
      mockDiscoverInfraRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "infra-repo-a",
            full_name: "my-org/infra-repo-a",
            clone_url: "https://github.com/my-org/infra-repo-a.git",
            archived: false,
            disabled: false,
          },
        ],
        totalRepos: 5,
        reposWithInfra: 1,
        isOrg: true,
        filteredByActivity: false,
      });

      mockInfraConfig();
      mockScanInfra.mockResolvedValueOnce({
        manifest: "/tmp/drift-infra-test/infra-manifest.json",
        summary: { total: 1, found: 1, missing: 0, errors: 0 },
        results: [
          {
            arn: "arn:aws:s3:::bucket-1",
            exists: true,
            service: "s3",
            resourceType: "bucket",
            resourceId: "bucket-1",
          },
        ],
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ org: "my-org", json: true });

      expect(mockDiscoverInfraRepos).toHaveBeenCalledWith(
        expect.objectContaining({ org: "my-org" })
      );
      expect(mockExit).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("returns early when no repos are discovered", async () => {
      mockDiscoverInfraRepos.mockResolvedValueOnce({
        repos: [],
        totalRepos: 5,
        reposWithInfra: 0,
        isOrg: true,
        filteredByActivity: false,
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ org: "my-org", json: true });

      expect(mockScanInfra).not.toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("exits with error code when drift found in org scan", async () => {
      mockDiscoverInfraRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "drift-repo",
            full_name: "my-org/drift-repo",
            clone_url: "https://github.com/my-org/drift-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        totalRepos: 1,
        reposWithInfra: 1,
        isOrg: true,
        filteredByActivity: false,
      });

      mockInfraConfig();
      mockScanInfra.mockResolvedValueOnce({
        manifest: "/tmp/drift-infra-test/infra-manifest.json",
        summary: { total: 1, found: 0, missing: 1, errors: 0 },
        results: [
          {
            arn: "arn:aws:s3:::bucket-1",
            exists: false,
            service: "s3",
            resourceType: "bucket",
            resourceId: "bucket-1",
          },
        ],
      });

      mockCreateIssue.mockResolvedValueOnce({
        number: 7,
        html_url: "https://github.com/my-org/drift-repo/issues/7",
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ org: "my-org", json: true });

      expect(mockExit).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
    });

    it("handles scan errors for individual repos gracefully", async () => {
      mockDiscoverInfraRepos.mockResolvedValueOnce({
        repos: [
          {
            name: "bad-repo",
            full_name: "my-org/bad-repo",
            clone_url: "https://github.com/my-org/bad-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        totalRepos: 1,
        reposWithInfra: 1,
        isOrg: true,
        filteredByActivity: false,
      });

      mockCloneRepo.mockImplementation(() => {
        throw new Error("Clone failed");
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ org: "my-org", json: true });

      // Should not crash; repo error is caught and counted as skipped
      expect(mockRemoveTempDir).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("parses --since option as hours", async () => {
      mockDiscoverInfraRepos.mockResolvedValueOnce({
        repos: [],
        totalRepos: 0,
        reposWithInfra: 0,
        isOrg: true,
        filteredByActivity: false,
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ org: "my-org", since: "48", json: true });

      expect(mockDiscoverInfraRepos).toHaveBeenCalledWith(
        expect.objectContaining({ sinceHours: 48 })
      );
      consoleSpy.mockRestore();
    });
  });

  describe("error handling", () => {
    it("catches top-level errors and exits with code 1", async () => {
      mockGetGitHubToken.mockReturnValue("test-token");
      mockDiscoverInfraRepos.mockRejectedValueOnce(
        new Error("Network failure")
      );

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      await scan({ org: "my-org", json: true });

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Network failure")
      );
      consoleSpy.mockRestore();
    });

    it("handles non-Error throws gracefully", async () => {
      mockGetGitHubToken.mockReturnValue("test-token");
      mockDiscoverInfraRepos.mockRejectedValueOnce("string error");

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      await scan({ org: "my-org", json: true });

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown error occurred")
      );
      consoleSpy.mockRestore();
    });
  });
});
