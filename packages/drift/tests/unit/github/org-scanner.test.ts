import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock external modules before imports
vi.mock("minimatch", () => ({
  minimatch: vi.fn(),
}));

vi.mock("../../../src/github/client.js", () => ({
  listRepos: vi.fn(),
  cloneRepo: vi.fn(),
  createTempDir: vi.fn(),
  removeTempDir: vi.fn(),
  getGitHubToken: vi.fn(),
  repoExists: vi.fn(),
  createIssue: vi.fn(),
  isRepoScannable: vi.fn(),
}));

vi.mock("../../../src/github/repo-checks.js", () => ({
  hasRecentCommits: vi.fn(),
}));

vi.mock("../../../src/github/issue-formatter.js", () => ({
  formatMissingProjectsIssueBody: vi.fn(() => "missing projects body"),
  getMissingProjectsIssueTitle: vi.fn(() => "Missing projects title"),
  getMissingProjectsIssueLabel: vi.fn(() => "drift:code"),
  formatTierMismatchIssueBody: vi.fn(() => "tier mismatch body"),
  getTierMismatchIssueTitle: vi.fn(() => "Tier mismatch title"),
  getTierMismatchIssueLabel: vi.fn(() => "drift:code"),
  formatDependencyChangesIssueBody: vi.fn(() => "dependency changes body"),
  getDependencyChangesIssueTitle: vi.fn(() => "Dependency changes title"),
  getDependencyChangesIssueLabel: vi.fn(() => "drift:code"),
}));

vi.mock("../../../src/repo/project-detection.js", () => ({
  detectMissingProjects: vi.fn(),
}));

vi.mock("../../../src/repo/tier-validation.js", () => ({
  validateTierRuleset: vi.fn(),
  hasTierMismatch: vi.fn(),
}));

vi.mock("../../../src/repo/dependency-changes.js", () => ({
  detectDependencyChanges: vi.fn(),
}));

vi.mock("../../../src/repo/diff.js", () => ({
  generateFileDiff: vi.fn(),
}));

vi.mock("../../../src/repo/changes.js", () => ({
  getHeadCommit: vi.fn(),
}));

vi.mock("../../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/version.js", () => ({
  version: "1.0.0-test",
}));

vi.mock("../../../src/constants.js", () => ({
  CONCURRENCY: { maxRepoScans: 5 },
  DEFAULTS: { configRepo: "drift-config", commitWindowHours: 24 },
}));

vi.mock("../../../src/utils/index.js", () => ({
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
  createEmptyResults: vi.fn((path: string) => ({
    path,
    timestamp: "2024-01-01T00:00:00.000Z",
  })),
  createEmptyOrgSummary: vi.fn(() => ({
    reposScanned: 0,
    reposWithIssues: 0,
    reposSkipped: 0,
  })),
  getErrorMessage: vi.fn(
    (e: unknown) => (e instanceof Error ? e.message : "Unknown error")
  ),
  actionsOutput: {
    error: vi.fn(),
    warning: vi.fn(),
    notice: vi.fn(),
  },
}));

import {
  listRepos,
  cloneRepo,
  createTempDir,
  removeTempDir,
  getGitHubToken,
  repoExists,
  createIssue,
  isRepoScannable,
} from "../../../src/github/client.js";
import { hasRecentCommits } from "../../../src/github/repo-checks.js";
import { detectMissingProjects } from "../../../src/repo/project-detection.js";
import {
  validateTierRuleset,
  hasTierMismatch,
} from "../../../src/repo/tier-validation.js";
import { detectDependencyChanges } from "../../../src/repo/dependency-changes.js";
import { generateFileDiff } from "../../../src/repo/diff.js";
import { getHeadCommit } from "../../../src/repo/changes.js";
import { loadConfig } from "../../../src/config/loader.js";
import { scanOrg } from "../../../src/github/org-scanner.js";

describe("org-scanner", () => {
  const mockListRepos = vi.mocked(listRepos);
  const mockCloneRepo = vi.mocked(cloneRepo);
  const mockCreateTempDir = vi.mocked(createTempDir);
  const mockRemoveTempDir = vi.mocked(removeTempDir);
  const mockGetGitHubToken = vi.mocked(getGitHubToken);
  const mockRepoExists = vi.mocked(repoExists);
  const mockCreateIssue = vi.mocked(createIssue);
  const mockIsRepoScannable = vi.mocked(isRepoScannable);
  const mockHasRecentCommits = vi.mocked(hasRecentCommits);
  const mockDetectMissingProjects = vi.mocked(detectMissingProjects);
  const mockValidateTierRuleset = vi.mocked(validateTierRuleset);
  const mockHasTierMismatch = vi.mocked(hasTierMismatch);
  const mockDetectDependencyChanges = vi.mocked(detectDependencyChanges);
  const mockGenerateFileDiff = vi.mocked(generateFileDiff);
  const mockGetHeadCommit = vi.mocked(getHeadCommit);
  const mockLoadConfig = vi.mocked(loadConfig);

  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  /**
   * Helper: Set up mocks for a complete successful org scan.
   * This ensures that all the "happy path" mocks are in place,
   * since process.exit is mocked and doesn't stop execution.
   */
  function setupDefaultOrgMocks() {
    mockGetGitHubToken.mockReturnValue("test-token");
    mockCreateTempDir.mockReturnValue("/tmp/drift-test");
    mockRepoExists.mockResolvedValue(true);
    mockIsRepoScannable.mockResolvedValue(true);
    mockHasRecentCommits.mockResolvedValue(true);
    mockDetectMissingProjects.mockReturnValue([]);
    mockValidateTierRuleset.mockReturnValue(null);
    mockHasTierMismatch.mockReturnValue(false);
    mockDetectDependencyChanges.mockReturnValue({
      hasChanges: false,
      changes: [],
      byCheck: {},
    });
    mockLoadConfig.mockReturnValue({ schema: { tiers: ["production"] } });
    // Provide a safe default for listRepos so code won't crash
    // if it continues past a mocked process.exit
    mockListRepos.mockResolvedValue({ repos: [], isOrg: true });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    setupDefaultOrgMocks();
  });

  afterEach(() => {
    mockExit.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("config repo validation", () => {
    it("exits when config repo does not exist", async () => {
      // Override repoExists: first call (config repo) returns false
      mockRepoExists.mockResolvedValue(false);

      await scanOrg({ org: "my-org", json: true });

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Config repo")
      );
    });

    it("exits when config cannot be loaded from config repo", async () => {
      mockLoadConfig.mockReturnValue(null);

      await scanOrg({ org: "my-org", json: true });

      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("uses custom config repo name", async () => {
      await scanOrg({
        org: "my-org",
        configRepo: "custom-config",
        json: true,
      });

      // repoExists should be called with the custom config repo name
      expect(mockRepoExists).toHaveBeenCalledWith(
        "my-org",
        "custom-config",
        "test-token"
      );
    });
  });

  describe("single repo mode", () => {
    it("scans a single specified repo", async () => {
      await scanOrg({ org: "my-org", repo: "target-repo", json: true });

      expect(mockIsRepoScannable).toHaveBeenCalledWith(
        "my-org",
        "target-repo",
        "test-token"
      );
    });

    it("reports error when specified repo does not exist", async () => {
      mockRepoExists
        .mockResolvedValueOnce(true) // config repo exists
        .mockResolvedValueOnce(false); // target repo does not exist

      const result = await scanOrg({
        org: "my-org",
        repo: "missing-repo",
        json: true,
      });

      expect(result.repos[0].error).toBe("repo not found");
    });

    it("skips repo when it is not scannable", async () => {
      mockIsRepoScannable.mockResolvedValue(false);

      const result = await scanOrg({
        org: "my-org",
        repo: "unscannable",
        json: true,
      });

      expect(result.repos[0].error).toBe("missing required files");
    });
  });

  describe("org-wide scanning", () => {
    it("lists and scans all repos in the org", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "repo-a",
            full_name: "my-org/repo-a",
            clone_url: "https://github.com/my-org/repo-a.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });

      const result = await scanOrg({
        org: "my-org",
        json: true,
        all: true,
      });

      // cloneRepo is called twice: once for config repo, once for repo-a
      expect(mockCloneRepo).toHaveBeenCalledWith(
        "my-org",
        "repo-a",
        "/tmp/drift-test",
        "test-token"
      );
      expect(result.summary.reposScanned).toBe(1);
    });

    it("excludes the config repo from scanning", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "drift-config",
            full_name: "my-org/drift-config",
            clone_url: "https://github.com/my-org/drift-config.git",
            archived: false,
            disabled: false,
          },
          {
            name: "app-repo",
            full_name: "my-org/app-repo",
            clone_url: "https://github.com/my-org/app-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });

      const result = await scanOrg({
        org: "my-org",
        json: true,
        all: true,
      });

      // Only app-repo should be scanned (drift-config excluded)
      expect(result.repos).toHaveLength(1);
      expect(result.repos[0].repo).toBe("app-repo");
    });

    it("skips repos with no recent activity when --all is not set", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "stale-repo",
            full_name: "my-org/stale-repo",
            clone_url: "https://github.com/my-org/stale-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockHasRecentCommits.mockResolvedValue(false);

      const result = await scanOrg({ org: "my-org", json: true });

      expect(result.repos[0].error).toBe("no recent activity");
      expect(result.summary.reposSkipped).toBe(1);
    });

    it("scans all repos when --all is set (skips activity check)", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "repo-a",
            full_name: "my-org/repo-a",
            clone_url: "https://github.com/my-org/repo-a.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });

      await scanOrg({ org: "my-org", json: true, all: true });

      expect(mockHasRecentCommits).not.toHaveBeenCalled();
    });

    it("handles clone errors gracefully", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "broken-repo",
            full_name: "my-org/broken-repo",
            clone_url: "https://github.com/my-org/broken-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      // First clone call is for config repo (succeeds)
      // Second clone call is for the actual repo (fails)
      mockCloneRepo
        .mockImplementationOnce(() => {}) // config repo clone
        .mockImplementationOnce(() => {
          throw new Error("Clone failed");
        });

      const result = await scanOrg({
        org: "my-org",
        json: true,
        all: true,
      });

      expect(result.repos[0].error).toBe("Clone failed");
      expect(result.summary.reposSkipped).toBe(1);
      expect(mockRemoveTempDir).toHaveBeenCalled();
    });
  });

  describe("issue detection and creation", () => {
    it("detects missing projects and creates issue", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "mono-repo",
            full_name: "my-org/mono-repo",
            clone_url: "https://github.com/my-org/mono-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([
        { path: "packages/new-pkg", type: "typescript" },
      ]);
      mockCreateIssue.mockResolvedValue({
        number: 15,
        html_url: "https://github.com/my-org/mono-repo/issues/15",
      });

      const result = await scanOrg({
        org: "my-org",
        json: true,
        all: true,
      });

      expect(result.repos[0].missingProjects).toHaveLength(1);
      expect(mockCreateIssue).toHaveBeenCalled();
    });

    it("does not create issues in dry-run mode", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "repo-a",
            full_name: "my-org/repo-a",
            clone_url: "https://github.com/my-org/repo-a.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([
        { path: "apps/new-app", type: "typescript" },
      ]);

      await scanOrg({
        org: "my-org",
        json: true,
        all: true,
        dryRun: true,
      });

      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it("exits with error code when issues are found", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "bad-repo",
            full_name: "my-org/bad-repo",
            clone_url: "https://github.com/my-org/bad-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([
        { path: "src/new-module", type: "python" },
      ]);
      mockCreateIssue.mockResolvedValue({
        number: 1,
        html_url: "https://github.com/my-org/bad-repo/issues/1",
      });

      await scanOrg({ org: "my-org", json: true, all: true });

      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("does not exit with error when all repos pass", async () => {
      // No issues found: empty missing projects, no tier mismatch, no dep changes
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "good-repo",
            full_name: "my-org/good-repo",
            clone_url: "https://github.com/my-org/good-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue(null);
      mockHasTierMismatch.mockReturnValue(false);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: false,
        changes: [],
        byCheck: {},
      });

      await scanOrg({ org: "my-org", json: true, all: true });

      // process.exit should not have been called at all
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe("tier mismatch issue creation", () => {
    it("creates tier mismatch issue when tier validation fails", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "tier-repo",
            full_name: "my-org/tier-repo",
            clone_url: "https://github.com/my-org/tier-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue({
        valid: false,
        tier: "production",
        rulesets: ["internal"],
        expectedPattern: "production-*",
        matchedRulesets: [],
        error: "Tier 'production' expects rulesets matching 'production-*', but found: internal",
      });
      mockHasTierMismatch.mockReturnValue(true);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: false,
        changes: [],
        byCheck: {},
        alwaysTrackedChanges: [],
        totalTrackedFiles: 0,
      });
      mockCreateIssue.mockResolvedValue({
        number: 42,
        html_url: "https://github.com/my-org/tier-repo/issues/42",
      });

      const result = await scanOrg({
        org: "my-org",
        json: true,
        all: true,
      });

      expect(result.repos[0].tierValidation).toBeDefined();
      expect(result.repos[0].tierValidation?.valid).toBe(false);
      expect(mockCreateIssue).toHaveBeenCalled();
      expect(result.summary.reposWithIssues).toBe(1);
    });

    it("does not create tier mismatch issue when tier validation passes", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "good-tier-repo",
            full_name: "my-org/good-tier-repo",
            clone_url: "https://github.com/my-org/good-tier-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue({
        valid: true,
        tier: "production",
        rulesets: ["production-strict"],
        expectedPattern: "production-*",
        matchedRulesets: ["production-strict"],
      });
      mockHasTierMismatch.mockReturnValue(false);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: false,
        changes: [],
        byCheck: {},
        alwaysTrackedChanges: [],
        totalTrackedFiles: 0,
      });

      await scanOrg({
        org: "my-org",
        json: true,
        all: true,
      });

      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it("does not create tier mismatch issue in dry-run mode", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "tier-repo",
            full_name: "my-org/tier-repo",
            clone_url: "https://github.com/my-org/tier-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue({
        valid: false,
        tier: "production",
        rulesets: ["internal"],
        expectedPattern: "production-*",
        matchedRulesets: [],
        error: "Tier mismatch",
      });
      mockHasTierMismatch.mockReturnValue(true);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: false,
        changes: [],
        byCheck: {},
        alwaysTrackedChanges: [],
        totalTrackedFiles: 0,
      });

      await scanOrg({
        org: "my-org",
        json: true,
        all: true,
        dryRun: true,
      });

      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it("handles tier mismatch issue creation failure gracefully", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "tier-repo",
            full_name: "my-org/tier-repo",
            clone_url: "https://github.com/my-org/tier-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue({
        valid: false,
        tier: "production",
        rulesets: ["internal"],
        expectedPattern: "production-*",
        matchedRulesets: [],
        error: "Tier mismatch",
      });
      mockHasTierMismatch.mockReturnValue(true);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: false,
        changes: [],
        byCheck: {},
        alwaysTrackedChanges: [],
        totalTrackedFiles: 0,
      });
      mockCreateIssue.mockRejectedValue(new Error("API rate limit exceeded"));

      // Should not throw; error is handled internally
      const result = await scanOrg({
        org: "my-org",
        json: true,
        all: true,
      });

      expect(result.repos[0].tierValidation?.valid).toBe(false);
    });
  });

  describe("dependency changes detection and issue creation", () => {
    it("detects dependency changes and creates issue", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "dep-repo",
            full_name: "my-org/dep-repo",
            clone_url: "https://github.com/my-org/dep-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue(null);
      mockHasTierMismatch.mockReturnValue(false);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: true,
        changes: [
          {
            file: "package.json",
            status: "modified",
            checkType: "npm",
            alwaysTracked: false,
          },
        ],
        byCheck: {
          npm: [
            {
              file: "package.json",
              status: "modified",
              checkType: "npm",
              alwaysTracked: false,
            },
          ],
        },
        alwaysTrackedChanges: [],
        totalTrackedFiles: 1,
      });
      mockGetHeadCommit.mockReturnValue("abc123def");
      mockGenerateFileDiff.mockReturnValue({
        diff: "--- a/package.json\n+++ b/package.json",
        truncated: false,
      });
      mockCreateIssue.mockResolvedValue({
        number: 99,
        html_url: "https://github.com/my-org/dep-repo/issues/99",
      });

      const result = await scanOrg({
        org: "my-org",
        json: true,
        all: true,
      });

      expect(result.repos[0].dependencyChanges).toBeDefined();
      expect(result.repos[0].dependencyChanges?.changes).toHaveLength(1);
      expect(mockCreateIssue).toHaveBeenCalled();
      expect(result.summary.reposWithIssues).toBe(1);
    });

    it("does not create dependency changes issue when no changes detected", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "clean-repo",
            full_name: "my-org/clean-repo",
            clone_url: "https://github.com/my-org/clean-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue(null);
      mockHasTierMismatch.mockReturnValue(false);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: false,
        changes: [],
        byCheck: {},
        alwaysTrackedChanges: [],
        totalTrackedFiles: 0,
      });

      await scanOrg({
        org: "my-org",
        json: true,
        all: true,
      });

      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it("does not create dependency changes issue in dry-run mode", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "dep-repo",
            full_name: "my-org/dep-repo",
            clone_url: "https://github.com/my-org/dep-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue(null);
      mockHasTierMismatch.mockReturnValue(false);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: true,
        changes: [
          {
            file: "yarn.lock",
            status: "modified",
            checkType: "npm",
            alwaysTracked: false,
          },
        ],
        byCheck: {
          npm: [
            {
              file: "yarn.lock",
              status: "modified",
              checkType: "npm",
              alwaysTracked: false,
            },
          ],
        },
        alwaysTrackedChanges: [],
        totalTrackedFiles: 1,
      });
      mockGetHeadCommit.mockReturnValue("abc123");
      mockGenerateFileDiff.mockReturnValue({ diff: "diff content", truncated: false });

      await scanOrg({
        org: "my-org",
        json: true,
        all: true,
        dryRun: true,
      });

      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it("uses HEAD when getHeadCommit returns null", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "dep-repo",
            full_name: "my-org/dep-repo",
            clone_url: "https://github.com/my-org/dep-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue(null);
      mockHasTierMismatch.mockReturnValue(false);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: true,
        changes: [
          {
            file: "pnpm-lock.yaml",
            status: "modified",
            checkType: "npm",
            alwaysTracked: false,
          },
        ],
        byCheck: {
          npm: [
            {
              file: "pnpm-lock.yaml",
              status: "modified",
              checkType: "npm",
              alwaysTracked: false,
            },
          ],
        },
        alwaysTrackedChanges: [],
        totalTrackedFiles: 1,
      });
      mockGetHeadCommit.mockReturnValue(null);
      mockGenerateFileDiff.mockReturnValue({ diff: null, truncated: false });
      mockCreateIssue.mockResolvedValue({
        number: 100,
        html_url: "https://github.com/my-org/dep-repo/issues/100",
      });

      const result = await scanOrg({
        org: "my-org",
        json: true,
        all: true,
      });

      expect(result.repos[0].dependencyChanges).toBeDefined();
      expect(result.repos[0].dependencyChanges?.commit).toBe("HEAD");
    });

    it("handles dependency changes issue creation failure gracefully", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "dep-repo",
            full_name: "my-org/dep-repo",
            clone_url: "https://github.com/my-org/dep-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue(null);
      mockHasTierMismatch.mockReturnValue(false);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: true,
        changes: [
          {
            file: "go.sum",
            status: "modified",
            checkType: "go",
            alwaysTracked: false,
          },
        ],
        byCheck: {
          go: [
            {
              file: "go.sum",
              status: "modified",
              checkType: "go",
              alwaysTracked: false,
            },
          ],
        },
        alwaysTrackedChanges: [],
        totalTrackedFiles: 1,
      });
      mockGetHeadCommit.mockReturnValue("abc123");
      mockGenerateFileDiff.mockReturnValue({ diff: "some diff", truncated: false });
      mockCreateIssue.mockRejectedValue(new Error("Permission denied"));

      // Should not throw
      const result = await scanOrg({
        org: "my-org",
        json: true,
        all: true,
      });

      expect(result.repos[0].dependencyChanges).toBeDefined();
    });
  });

  describe("printOrgResults", () => {
    it("prints results to console when json is false", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "good-repo",
            full_name: "my-org/good-repo",
            clone_url: "https://github.com/my-org/good-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue(null);
      mockHasTierMismatch.mockReturnValue(false);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: false,
        changes: [],
        byCheck: {},
        alwaysTrackedChanges: [],
        totalTrackedFiles: 0,
      });

      await scanOrg({ org: "my-org", json: false, all: true });

      // printOrgResults is called when json is false; verify console output
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("RESULTS BY REPOSITORY")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("SUMMARY")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Organization: my-org")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All repos passed")
      );
    });

    it("prints repo errors in results output", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "broken-repo",
            full_name: "my-org/broken-repo",
            clone_url: "https://github.com/my-org/broken-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockIsRepoScannable.mockResolvedValue(false);

      await scanOrg({ org: "my-org", json: false, all: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("RESULTS BY REPOSITORY")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Skipped")
      );
    });

    it("prints missing projects in results output", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "mono-repo",
            full_name: "my-org/mono-repo",
            clone_url: "https://github.com/my-org/mono-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([
        { path: "packages/new-pkg", type: "typescript" },
      ]);
      mockCreateIssue.mockResolvedValue({
        number: 10,
        html_url: "https://github.com/my-org/mono-repo/issues/10",
      });

      await scanOrg({ org: "my-org", json: false, all: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Missing projects")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("ISSUES DETECTED")
      );
    });

    it("prints tier mismatch in results output", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "tier-repo",
            full_name: "my-org/tier-repo",
            clone_url: "https://github.com/my-org/tier-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue({
        valid: false,
        tier: "production",
        rulesets: ["internal"],
        expectedPattern: "production-*",
        matchedRulesets: [],
        error: "Tier mismatch detected",
      });
      mockHasTierMismatch.mockReturnValue(true);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: false,
        changes: [],
        byCheck: {},
        alwaysTrackedChanges: [],
        totalTrackedFiles: 0,
      });
      mockCreateIssue.mockResolvedValue({
        number: 20,
        html_url: "https://github.com/my-org/tier-repo/issues/20",
      });

      await scanOrg({ org: "my-org", json: false, all: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tier mismatch")
      );
    });

    it("prints dependency changes in results output", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "dep-repo",
            full_name: "my-org/dep-repo",
            clone_url: "https://github.com/my-org/dep-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue(null);
      mockHasTierMismatch.mockReturnValue(false);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: true,
        changes: [
          {
            file: "package-lock.json",
            status: "modified",
            checkType: "npm",
            alwaysTracked: false,
          },
        ],
        byCheck: {
          npm: [
            {
              file: "package-lock.json",
              status: "modified",
              checkType: "npm",
              alwaysTracked: false,
            },
          ],
        },
        alwaysTrackedChanges: [],
        totalTrackedFiles: 1,
      });
      mockGetHeadCommit.mockReturnValue("xyz789");
      mockGenerateFileDiff.mockReturnValue({ diff: "diff output", truncated: false });
      mockCreateIssue.mockResolvedValue({
        number: 30,
        html_url: "https://github.com/my-org/dep-repo/issues/30",
      });

      await scanOrg({ org: "my-org", json: false, all: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Dependency changes")
      );
    });

    it("prints skipped repos count in summary", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "good-repo",
            full_name: "my-org/good-repo",
            clone_url: "https://github.com/my-org/good-repo.git",
            archived: false,
            disabled: false,
          },
          {
            name: "stale-repo",
            full_name: "my-org/stale-repo",
            clone_url: "https://github.com/my-org/stale-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue(null);
      mockHasTierMismatch.mockReturnValue(false);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: false,
        changes: [],
        byCheck: {},
        alwaysTrackedChanges: [],
        totalTrackedFiles: 0,
      });

      // First repo is scannable, second is not
      mockIsRepoScannable
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await scanOrg({ org: "my-org", json: false, all: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("skipped")
      );
    });
  });

  describe("missing projects issue creation failure", () => {
    it("handles missing projects issue creation failure gracefully", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "mono-repo",
            full_name: "my-org/mono-repo",
            clone_url: "https://github.com/my-org/mono-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([
        { path: "packages/new-pkg", type: "typescript" },
      ]);
      mockCreateIssue.mockRejectedValue(new Error("GitHub API error"));

      // Should not throw
      const result = await scanOrg({
        org: "my-org",
        json: true,
        all: true,
      });

      expect(result.repos[0].missingProjects).toHaveLength(1);
    });
  });

  describe("non-json console output during scanning", () => {
    it("prints dry-run messages for missing projects when not json", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "repo-a",
            full_name: "my-org/repo-a",
            clone_url: "https://github.com/my-org/repo-a.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([
        { path: "apps/new-app", type: "typescript" },
      ]);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: false,
        changes: [],
        byCheck: {},
        alwaysTrackedChanges: [],
        totalTrackedFiles: 0,
      });

      await scanOrg({
        org: "my-org",
        json: false,
        all: true,
        dryRun: true,
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[DRY-RUN]")
      );
    });

    it("prints dry-run messages for tier mismatch when not json", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "tier-repo",
            full_name: "my-org/tier-repo",
            clone_url: "https://github.com/my-org/tier-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue({
        valid: false,
        tier: "production",
        rulesets: ["internal"],
        expectedPattern: "production-*",
        matchedRulesets: [],
        error: "Tier mismatch",
      });
      mockHasTierMismatch.mockReturnValue(true);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: false,
        changes: [],
        byCheck: {},
        alwaysTrackedChanges: [],
        totalTrackedFiles: 0,
      });

      await scanOrg({
        org: "my-org",
        json: false,
        all: true,
        dryRun: true,
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[DRY-RUN]")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tier")
      );
    });

    it("prints dry-run messages for dependency changes when not json", async () => {
      mockListRepos.mockResolvedValue({
        repos: [
          {
            name: "dep-repo",
            full_name: "my-org/dep-repo",
            clone_url: "https://github.com/my-org/dep-repo.git",
            archived: false,
            disabled: false,
          },
        ],
        isOrg: true,
      });
      mockDetectMissingProjects.mockReturnValue([]);
      mockValidateTierRuleset.mockReturnValue(null);
      mockHasTierMismatch.mockReturnValue(false);
      mockDetectDependencyChanges.mockReturnValue({
        hasChanges: true,
        changes: [
          {
            file: "package.json",
            status: "modified",
            checkType: "npm",
            alwaysTracked: false,
          },
        ],
        byCheck: {
          npm: [
            {
              file: "package.json",
              status: "modified",
              checkType: "npm",
              alwaysTracked: false,
            },
          ],
        },
        alwaysTrackedChanges: [],
        totalTrackedFiles: 1,
      });
      mockGetHeadCommit.mockReturnValue("abc123");
      mockGenerateFileDiff.mockReturnValue({ diff: "diff content", truncated: false });

      await scanOrg({
        org: "my-org",
        json: false,
        all: true,
        dryRun: true,
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[DRY-RUN]")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("package.json")
      );
    });
  });

  describe("cleanup", () => {
    it("always cleans up config directory even on error", async () => {
      mockListRepos.mockRejectedValue(new Error("API error"));

      // The function should throw but still clean up via finally block
      await expect(
        scanOrg({ org: "my-org", json: true })
      ).rejects.toThrow("API error");

      expect(mockRemoveTempDir).toHaveBeenCalled();
    });
  });
});
