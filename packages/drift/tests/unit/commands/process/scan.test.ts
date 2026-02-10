import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock external modules before imports
vi.mock("@standards-kit/conform", () => ({
  validateProcess: vi.fn(),
}));

vi.mock("../../../../src/github/process-repo-discovery.js", () => ({
  discoverProcessRepos: vi.fn(),
}));

vi.mock("../../../../src/github/client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/github/client.js")>();
  return {
    ...actual,
    createIssue: vi.fn(),
    getGitHubToken: vi.fn(() => "test-token"),
  };
});

// Import after mocking
import { validateProcess } from "@standards-kit/conform";
import { discoverProcessRepos } from "../../../../src/github/process-repo-discovery.js";
import { createIssue, getGitHubToken } from "../../../../src/github/client.js";

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

      const { scan } = await import("../../../../src/commands/process/scan.js");

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

      const { scan } = await import("../../../../src/commands/process/scan.js");

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

      const { scan } = await import("../../../../src/commands/process/scan.js");

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

      const { scan } = await import("../../../../src/commands/process/scan.js");

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

      const { scan } = await import("../../../../src/commands/process/scan.js");

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

      const { scan } = await import("../../../../src/commands/process/scan.js");

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

      const { scan } = await import("../../../../src/commands/process/scan.js");

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

    it("reports filtered-by-activity info when not includeAll", async () => {
      const repos = [
        {
          name: "active-repo",
          full_name: "test-org/active-repo",
          clone_url: "https://github.com/test-org/active-repo.git",
          archived: false,
          disabled: false,
        },
      ];

      mockDiscoverProcessRepos.mockResolvedValueOnce({
        repos,
        totalRepos: 5,
        reposWithCheckToml: 3,
        isOrg: true,
        filteredByActivity: true,
        activityWindowHours: 48,
      });

      mockValidateProcess.mockResolvedValueOnce(createValidateResult([]));

      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      await scan({
        org: "test-org",
        json: true,
        since: "48",
      });

      mockExit.mockRestore();

      expect(mockValidateProcess).toHaveBeenCalledTimes(1);
    });

    it("increments issuesCreated counter when issue is created", async () => {
      const repos = [
        {
          name: "repo-a",
          full_name: "test-org/repo-a",
          clone_url: "https://github.com/test-org/repo-a.git",
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
            name: "ci.checks",
            passed: false,
            violations: [
              {
                rule: "required_checks",
                message: "Missing required CI checks",
                severity: "error",
              },
            ],
          },
        ])
      );

      mockCreateIssue.mockResolvedValueOnce({
        number: 99,
        html_url: "https://github.com/test-org/repo-a/issues/99",
      });

      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      await scan({
        org: "test-org",
        json: true,
        all: true,
      });

      mockExit.mockRestore();

      expect(mockCreateIssue).toHaveBeenCalledTimes(1);
    });

    it("handles non-json mode with console output", async () => {
      const repos = [
        {
          name: "repo-a",
          full_name: "test-org/repo-a",
          clone_url: "https://github.com/test-org/repo-a.git",
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

      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      await scan({
        org: "test-org",
        json: false,
        all: true,
      });

      mockExit.mockRestore();
      consoleSpy.mockRestore();
      stdoutSpy.mockRestore();

      // Should complete without errors
      expect(mockValidateProcess).toHaveBeenCalledTimes(1);
    });
  });

  describe("validation and error handling", () => {
    it("exits with error when neither --repo nor --org is specified", async () => {
      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await scan({});

      expect(mockExit).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
      mockExit.mockRestore();
    });

    it("exits with error when no GitHub token is available", async () => {
      mockGetGitHubToken.mockReturnValue(undefined);

      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await scan({ org: "test-org" });

      expect(mockExit).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
      mockExit.mockRestore();
    });

    it("exits with error when repo format is invalid (no slash)", async () => {
      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await scan({ repo: "no-slash" });

      expect(mockExit).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
      mockExit.mockRestore();
    });

    it("catches top-level errors and exits with code 1", async () => {
      mockDiscoverProcessRepos.mockRejectedValueOnce(
        new Error("Network timeout")
      );

      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await scan({ org: "test-org", json: true, all: true });

      expect(mockExit).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
      mockExit.mockRestore();
    });

    it("handles non-Error throws gracefully", async () => {
      mockDiscoverProcessRepos.mockRejectedValueOnce("string error");

      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await scan({ org: "test-org", json: true, all: true });

      expect(mockExit).toHaveBeenCalledWith(1);
      consoleSpy.mockRestore();
      mockExit.mockRestore();
    });
  });

  describe("single repo scanning", () => {
    it("scans a single repo with no violations", async () => {
      mockValidateProcess.mockResolvedValueOnce(
        createValidateResult([
          { name: "branches.protection", passed: true },
        ])
      );

      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      await scan({
        repo: "test-org/test-repo",
        json: true,
      });

      expect(mockValidateProcess).toHaveBeenCalledWith({
        repo: "test-org/test-repo",
        config: undefined,
      });
      expect(mockExit).not.toHaveBeenCalled();
      mockExit.mockRestore();
    });

    it("scans a single repo with custom config", async () => {
      mockValidateProcess.mockResolvedValueOnce(createValidateResult([]));

      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      await scan({
        repo: "test-org/test-repo",
        config: "custom-config.yaml",
        json: true,
      });

      expect(mockValidateProcess).toHaveBeenCalledWith({
        repo: "test-org/test-repo",
        config: "custom-config.yaml",
      });
      mockExit.mockRestore();
    });

    it("creates an issue for single repo with violations", async () => {
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
        html_url: "https://github.com/test-org/test-repo/issues/42",
      });

      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      await scan({
        repo: "test-org/test-repo",
        json: true,
      });

      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "test-org",
          repo: "test-repo",
        }),
        "test-token"
      );
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });

    it("does not create issue for single repo in dry-run mode", async () => {
      mockValidateProcess.mockResolvedValueOnce(
        createValidateResult([
          {
            name: "branches.protection",
            passed: false,
            violations: [
              {
                rule: "require_review",
                message: "Not configured",
                severity: "error",
              },
            ],
          },
        ])
      );

      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({
        repo: "test-org/test-repo",
        dryRun: true,
      });

      expect(mockCreateIssue).not.toHaveBeenCalled();
      mockExit.mockRestore();
      consoleSpy.mockRestore();
    });

    it("maps violations with file field correctly", async () => {
      mockValidateProcess.mockResolvedValueOnce(
        createValidateResult([
          {
            name: "required_files.codeowners",
            passed: false,
            violations: [
              {
                rule: "codeowners_exists",
                message: "CODEOWNERS file is missing",
                severity: "warning",
              },
            ],
          },
        ])
      );

      const { scan } = await import("../../../../src/commands/process/scan.js");

      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({
        repo: "test-org/test-repo",
        json: true,
      });

      // Parse the JSON output to verify mapping
      const jsonCalls = consoleSpy.mock.calls.filter((call) => {
        try {
          const parsed = JSON.parse(call[0] as string);
          return parsed.violations !== undefined;
        } catch {
          return false;
        }
      });

      expect(jsonCalls.length).toBe(1);
      const detection = JSON.parse(jsonCalls[0][0] as string);
      expect(detection.violations[0].category).toBe("required_files");
      expect(detection.violations[0].check).toBe("required_files.codeowners");

      mockExit.mockRestore();
      consoleSpy.mockRestore();
    });
  });
});
