vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("../../../../src/process/scan/remote-fetcher.js", () => ({
  parseRepoString: vi.fn(),
  isGhAvailable: vi.fn(),
  verifyRepoAccess: vi.fn(),
  checkRemoteFiles: vi.fn(),
  RemoteFetcherError: class RemoteFetcherError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "RemoteFetcherError";
      this.code = code;
    }
  },
  standardFileChecks: [
    {
      path: "CODEOWNERS",
      alternativePaths: [".github/CODEOWNERS"],
      required: false,
      description: "CODEOWNERS file",
    },
  ],
}));

vi.mock("../../../../src/process/scan/validators.js", () => ({
  validateRulesets: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";

import { scanRepository } from "../../../../src/process/scan/scanner.js";
import {
  parseRepoString,
  isGhAvailable,
  verifyRepoAccess,
  checkRemoteFiles,
  RemoteFetcherError,
} from "../../../../src/process/scan/remote-fetcher.js";
import { validateRulesets } from "../../../../src/process/scan/validators.js";

const mockedExeca = vi.mocked(execa);
const mockedParseRepoString = vi.mocked(parseRepoString);
const mockedIsGhAvailable = vi.mocked(isGhAvailable);
const mockedVerifyRepoAccess = vi.mocked(verifyRepoAccess);
const mockedCheckRemoteFiles = vi.mocked(checkRemoteFiles);
const mockedValidateRulesets = vi.mocked(validateRulesets);

beforeEach(() => {
  vi.clearAllMocks();
  mockedParseRepoString.mockReturnValue({ owner: "acme", repo: "app" });
  mockedIsGhAvailable.mockResolvedValue(true);
  mockedVerifyRepoAccess.mockResolvedValue(true);
  mockedCheckRemoteFiles.mockResolvedValue([]);
  mockedValidateRulesets.mockReturnValue([]);
});

describe("scanRepository", () => {
  it("throws RemoteFetcherError when gh is not available", async () => {
    mockedIsGhAvailable.mockResolvedValue(false);
    await expect(scanRepository("acme/app", {})).rejects.toThrow(RemoteFetcherError);
  });

  it("verifies repo access before scanning", async () => {
    mockedExeca.mockResolvedValue({ stdout: "[]" } as never);
    await scanRepository("acme/app", {});
    expect(mockedVerifyRepoAccess).toHaveBeenCalledWith({ owner: "acme", repo: "app" });
  });

  it("returns passed result when no violations found", async () => {
    mockedExeca.mockResolvedValue({ stdout: "[]" } as never);
    const result = await scanRepository("acme/app", {});
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.repoInfo).toEqual({ owner: "acme", repo: "app" });
  });

  it("returns skipped result when repo config is not enabled", async () => {
    mockedExeca.mockResolvedValue({ stdout: "[]" } as never);
    const result = await scanRepository("acme/app", { process: { repo: { enabled: false } } });
    expect(result.checks).toHaveLength(2);
    const rulesetsCheck = result.checks[0];
    expect(rulesetsCheck.skipped).toBe(true);
  });

  it("returns failed result when rulesets API errors with generic error", async () => {
    mockedExeca.mockRejectedValue(new Error("server error"));
    const result = await scanRepository("acme/app", {
      process: { repo: { enabled: true } },
    });
    const rulesetsCheck = result.checks[0];
    expect(rulesetsCheck.passed).toBe(false);
    expect(rulesetsCheck.violations[0].message).toContain("Failed to check rulesets");
  });

  it("returns skipped result when rulesets API returns 403", async () => {
    mockedExeca.mockRejectedValue(new Error("403 Must have admin rights"));
    const result = await scanRepository("acme/app", {
      process: { repo: { enabled: true } },
    });
    const rulesetsCheck = result.checks[0];
    expect(rulesetsCheck.skipped).toBe(true);
    expect(rulesetsCheck.skipReason).toContain("insufficient permissions");
  });

  it("reports violations from 404 when branch protection is required", async () => {
    mockedExeca.mockRejectedValue(new Error("404 Not Found"));
    const result = await scanRepository("acme/app", {
      process: { repo: { enabled: true, require_branch_protection: true } },
    });
    const rulesetsCheck = result.checks[0];
    expect(rulesetsCheck.passed).toBe(false);
    expect(rulesetsCheck.violations[0].message).toContain("No branch protection rulesets");
  });

  it("includes file check results", async () => {
    mockedExeca.mockResolvedValue({ stdout: "[]" } as never);
    mockedCheckRemoteFiles.mockResolvedValue([
      { path: "CODEOWNERS", exists: true, checkedPaths: ["CODEOWNERS"] },
    ]);
    const result = await scanRepository("acme/app", {});
    expect(result.checks).toHaveLength(2);
  });

  it("reports file violations for required missing files", async () => {
    mockedExeca.mockResolvedValue({ stdout: "[]" } as never);
    mockedCheckRemoteFiles.mockResolvedValue([
      { path: "CODEOWNERS", exists: false, checkedPaths: ["CODEOWNERS", ".github/CODEOWNERS"] },
    ]);
    const result = await scanRepository("acme/app", {
      process: { repo: { require_codeowners: true } },
    });
    const filesCheck = result.checks[1];
    expect(filesCheck.violations.length).toBeGreaterThanOrEqual(1);
    expect(filesCheck.violations[0].message).toContain("CODEOWNERS");
  });

  it("aggregates summary counts correctly", async () => {
    mockedExeca.mockResolvedValue({ stdout: "[]" } as never);
    const result = await scanRepository("acme/app", {});
    expect(result.summary.totalChecks).toBe(2);
  });

  it("handles file check errors gracefully", async () => {
    mockedExeca.mockResolvedValue({ stdout: "[]" } as never);
    mockedCheckRemoteFiles.mockRejectedValue(new Error("API failure"));
    const result = await scanRepository("acme/app", {});
    const filesCheck = result.checks[1];
    expect(filesCheck.passed).toBe(false);
    expect(filesCheck.violations[0].message).toContain("Failed to check files");
  });
});
