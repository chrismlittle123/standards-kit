import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock external modules before imports
vi.mock("@standards-kit/conform", () => ({
  validateProcess: vi.fn(),
}));

vi.mock("../../github/process-repo-discovery.js", () => ({
  discoverProcessRepos: vi.fn(),
}));

vi.mock("../../github/client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../github/client.js")>();
  return {
    ...actual,
    createIssue: vi.fn(),
    getGitHubToken: vi.fn(() => "test-token"),
  };
});

// Import after mocking
import { validateProcess } from "@standards-kit/conform";
import { discoverProcessRepos } from "../../github/process-repo-discovery.js";
import { createIssue, getGitHubToken } from "../../github/client.js";

// Helper to create a valid ValidateProcessResult
function createValidateResult(
  checks: Array<{
    name: string;
    passed: boolean;
    violations?: Array<{
      rule: string;
      message: string;
      severity: "error" | "warning";
    }>;
  }>
) {
  const totalChecks = checks.length;
  const passedChecks = checks.filter((c) => c.passed).length;
  const failedChecks = totalChecks - passedChecks;
  const totalViolations = checks.reduce(
    (sum, c) => sum + (c.violations?.length ?? 0),
    0
  );

  return {
    version: "1.0.0",
    repoInfo: { owner: "test-org", repo: "test-repo" },
    domain: "process" as const,
    checks: checks.map((c) => ({
      name: c.name,
      rule: c.name,
      passed: c.passed,
      skipped: false,
      violations: (c.violations ?? []).map((v) => ({
        ...v,
        tool: "@standards-kit/conform",
      })),
    })),
    summary: {
      totalChecks,
      passedChecks,
      failedChecks,
      totalViolations,
      exitCode: failedChecks > 0 ? 1 : 0,
    },
  };
}

describe("process/scan", () => {
  const mockValidateProcess = vi.mocked(validateProcess);
  const mockDiscoverProcessRepos = vi.mocked(discoverProcessRepos);
  const mockCreateIssue = vi.mocked(createIssue);
  const mockGetGitHubToken = vi.mocked(getGitHubToken);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGitHubToken.mockReturnValue("test-token");
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("org-wide scanning", () => {
    it("scans multiple repos and aggregates results", async () => {
      const repos = [
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
      ];

      mockDiscoverProcessRepos.mockResolvedValueOnce({
        repos,
        totalRepos: 2,
        reposWithCheckToml: 2,
        isOrg: true,
        filteredByActivity: false,
      });

      // Both repos pass
      mockValidateProcess.mockResolvedValue(createValidateResult([]));

      const { scan } = await import("./scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      await scan({
        org: "test-org",
        json: true,
        all: true,
      });

      mockExit.mockRestore();

      // validateProcess should be called once per repo
      expect(mockValidateProcess).toHaveBeenCalledTimes(2);
      expect(mockValidateProcess).toHaveBeenCalledWith({
        repo: "test-org/repo-a",
      });
      expect(mockValidateProcess).toHaveBeenCalledWith({
        repo: "test-org/repo-b",
      });
    });

    it("creates issues for repos with violations", async () => {
      const repos = [
        {
          name: "repo-with-violations",
          full_name: "test-org/repo-with-violations",
          clone_url: "https://github.com/test-org/repo-with-violations.git",
          archived: false,
          disabled: false,
        },
      ];

      mockDiscoverProcessRepos.mockResolvedValueOnce({
        repos,
        totalRepos: 1,
        reposWithCheckToml: 1,
        isOrg: true,
        filteredByActivity: false,
      });

      mockValidateProcess.mockResolvedValueOnce(
        createValidateResult([
          {
            name: "branches.protection",
            passed: false,
            violations: [
              {
                rule: "require_review",
                message: "Branch protection not configured",
                severity: "error",
              },
            ],
          },
        ])
      );

      mockCreateIssue.mockResolvedValueOnce({
        number: 42,
        html_url: "https://github.com/test-org/repo-with-violations/issues/42",
      });

      const { scan } = await import("./scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      await scan({
        org: "test-org",
        json: true,
        all: true,
      });

      mockExit.mockRestore();

      // Should create an issue for the repo with violations
      expect(mockCreateIssue).toHaveBeenCalledTimes(1);
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "test-org",
          repo: "repo-with-violations",
          title: expect.stringContaining("process"),
        }),
        "test-token"
      );
    });

    it("does not create issues in dry-run mode", async () => {
      const repos = [
        {
          name: "repo-with-violations",
          full_name: "test-org/repo-with-violations",
          clone_url: "https://github.com/test-org/repo-with-violations.git",
          archived: false,
          disabled: false,
        },
      ];

      mockDiscoverProcessRepos.mockResolvedValueOnce({
        repos,
        totalRepos: 1,
        reposWithCheckToml: 1,
        isOrg: true,
        filteredByActivity: false,
      });

      mockValidateProcess.mockResolvedValueOnce(
        createValidateResult([
          {
            name: "branches.protection",
            passed: false,
            violations: [
              {
                rule: "require_review",
                message: "Branch protection not configured",
                severity: "error",
              },
            ],
          },
        ])
      );

      const { scan } = await import("./scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      await scan({
        org: "test-org",
        json: true,
        all: true,
        dryRun: true,
      });

      mockExit.mockRestore();

      // Should NOT create an issue in dry-run mode
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it("handles scan errors gracefully", async () => {
      const repos = [
        {
          name: "error-repo",
          full_name: "test-org/error-repo",
          clone_url: "https://github.com/test-org/error-repo.git",
          archived: false,
          disabled: false,
        },
        {
          name: "good-repo",
          full_name: "test-org/good-repo",
          clone_url: "https://github.com/test-org/good-repo.git",
          archived: false,
          disabled: false,
        },
      ];

      mockDiscoverProcessRepos.mockResolvedValueOnce({
        repos,
        totalRepos: 2,
        reposWithCheckToml: 2,
        isOrg: true,
        filteredByActivity: false,
      });

      // First repo throws error, second succeeds
      mockValidateProcess
        .mockRejectedValueOnce(new Error("API rate limit exceeded"))
        .mockResolvedValueOnce(createValidateResult([]));

      const { scan } = await import("./scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      await scan({
        org: "test-org",
        json: true,
        all: true,
      });

      mockExit.mockRestore();

      // Both repos should have been attempted
      expect(mockValidateProcess).toHaveBeenCalledTimes(2);
    });

    it("exits with error code when violations found", async () => {
      const repos = [
        {
          name: "failing-repo",
          full_name: "test-org/failing-repo",
          clone_url: "https://github.com/test-org/failing-repo.git",
          archived: false,
          disabled: false,
        },
      ];

      mockDiscoverProcessRepos.mockResolvedValueOnce({
        repos,
        totalRepos: 1,
        reposWithCheckToml: 1,
        isOrg: true,
        filteredByActivity: false,
      });

      mockValidateProcess.mockResolvedValueOnce(
        createValidateResult([
          {
            name: "branches.protection",
            passed: false,
            violations: [
              {
                rule: "require_review",
                message: "Branch protection not configured",
                severity: "error",
              },
            ],
          },
        ])
      );

      mockCreateIssue.mockResolvedValueOnce({
        number: 1,
        html_url: "https://github.com/test-org/failing-repo/issues/1",
      });

      const { scan } = await import("./scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      await scan({
        org: "test-org",
        json: true,
        all: true,
      });

      // Should exit with error code due to violations
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
    });

    it("does not exit with error when all repos pass", async () => {
      const repos = [
        {
          name: "passing-repo",
          full_name: "test-org/passing-repo",
          clone_url: "https://github.com/test-org/passing-repo.git",
          archived: false,
          disabled: false,
        },
      ];

      mockDiscoverProcessRepos.mockResolvedValueOnce({
        repos,
        totalRepos: 1,
        reposWithCheckToml: 1,
        isOrg: true,
        filteredByActivity: false,
      });

      mockValidateProcess.mockResolvedValueOnce(createValidateResult([]));

      const { scan } = await import("./scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      await scan({
        org: "test-org",
        json: true,
        all: true,
      });

      // Should NOT exit with error when all repos pass
      expect(mockExit).not.toHaveBeenCalled();

      mockExit.mockRestore();
    });

    it("handles empty repo list", async () => {
      mockDiscoverProcessRepos.mockResolvedValueOnce({
        repos: [],
        totalRepos: 5,
        reposWithCheckToml: 0,
        isOrg: true,
        filteredByActivity: false,
      });

      const { scan } = await import("./scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      await scan({
        org: "test-org",
        json: true,
        all: true,
      });

      mockExit.mockRestore();

      // Should not call validateProcess when no repos
      expect(mockValidateProcess).not.toHaveBeenCalled();
    });
  });
});
