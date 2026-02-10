vi.mock("../../../../src/core/index.js");
vi.mock("../../../../src/process/sync/fetcher.js");
vi.mock("../../../../src/process/sync/differ.js");
vi.mock("../../../../src/process/sync/applier.js");
vi.mock("../../../../src/process/sync/validator.js");

import { describe, it, expect, vi, beforeEach } from "vitest";

import * as core from "../../../../src/core/index.js";
import * as applier from "../../../../src/process/sync/applier.js";
import * as differ from "../../../../src/process/sync/differ.js";
import * as fetcher from "../../../../src/process/sync/fetcher.js";
import { runDiff, runSync, runTagDiff, runTagSync } from "../../../../src/process/sync/index.js";
import type {
  SyncDiffResult,
  SyncOptions,
  TagProtectionDiffResult,
} from "../../../../src/process/sync/types.js";

const mockedCore = vi.mocked(core);
const mockedFetcher = vi.mocked(fetcher);
const mockedDiffer = vi.mocked(differ);
const mockedApplier = vi.mocked(applier);

beforeEach(() => vi.clearAllMocks());

const mockRepoInfo = { owner: "test-owner", repo: "test-repo" };

const defaultOptions: SyncOptions = {
  format: "text",
};

function setupCommonMocks(diffResult: SyncDiffResult): void {
  mockedFetcher.isGhAvailable.mockResolvedValue(true);
  mockedCore.loadConfig.mockReturnValue({
    config: {
      process: {
        repo: {
          ruleset: {
            branch: "main",
            required_reviews: 1,
          },
        },
      },
    },
    configPath: "/root/standards.toml",
  } as ReturnType<typeof core.loadConfig>);
  mockedCore.getProjectRoot.mockReturnValue("/root");
  mockedFetcher.getRepoInfo.mockResolvedValue(mockRepoInfo);
  mockedFetcher.fetchBranchProtection.mockResolvedValue({
    branch: "main",
    requiredReviews: null,
    dismissStaleReviews: null,
    requireCodeOwnerReviews: null,
    requiredStatusChecks: null,
    requireBranchesUpToDate: null,
    requireSignedCommits: null,
    enforceAdmins: null,
    bypassActors: null,
    rulesetId: null,
    rulesetName: null,
  });
  mockedDiffer.computeDiff.mockReturnValue(diffResult);
  mockedDiffer.formatValue.mockImplementation((v: unknown) => (v === null ? "not set" : String(v)));
}

function makeNoDiffResult(): SyncDiffResult {
  return {
    repoInfo: mockRepoInfo,
    branch: "main",
    diffs: [],
    hasChanges: false,
    currentRulesetId: null,
  };
}

function makeChangeDiffResult(): SyncDiffResult {
  return {
    repoInfo: mockRepoInfo,
    branch: "main",
    diffs: [
      { setting: "required_reviews", current: null, desired: 1, action: "add" },
    ],
    hasChanges: true,
    currentRulesetId: null,
  };
}

describe("runDiff", () => {
  it("exits with 0 when there are no changes", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    setupCommonMocks(makeNoDiffResult());

    await runDiff(defaultOptions);

    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("exits with 1 when there are changes", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    setupCommonMocks(makeChangeDiffResult());

    await runDiff(defaultOptions);

    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("outputs JSON when format is json", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    setupCommonMocks(makeNoDiffResult());

    await runDiff({ ...defaultOptions, format: "json" });

    const outputText = mockWrite.mock.calls.map((c) => c[0]).join("");
    expect(outputText).toContain("{");
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("exits with 2 on error", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockedFetcher.isGhAvailable.mockResolvedValue(false);

    await runDiff(defaultOptions);

    expect(mockExit).toHaveBeenCalledWith(2);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });
});

describe("runSync", () => {
  it("exits with 0 when there are no changes", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    setupCommonMocks(makeNoDiffResult());

    await runSync(defaultOptions);

    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("exits with 0 for preview mode (no --apply)", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    setupCommonMocks(makeChangeDiffResult());

    await runSync({ ...defaultOptions, apply: false });

    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("applies changes and exits with 0 on success", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const diffResult = makeChangeDiffResult();
    setupCommonMocks(diffResult);
    mockedApplier.applyBranchProtection.mockResolvedValue({
      success: true,
      applied: diffResult.diffs,
      failed: [],
    });

    await runSync({ ...defaultOptions, apply: true });

    expect(mockedApplier.applyBranchProtection).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("exits with 1 when apply fails", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const diffResult = makeChangeDiffResult();
    setupCommonMocks(diffResult);
    mockedApplier.applyBranchProtection.mockResolvedValue({
      success: false,
      applied: [],
      failed: [{ diff: diffResult.diffs[0], error: "API error" }],
    });

    await runSync({ ...defaultOptions, apply: true });

    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("exits with 2 on error", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockedFetcher.isGhAvailable.mockResolvedValue(false);

    await runSync({ ...defaultOptions, apply: true });

    expect(mockExit).toHaveBeenCalledWith(2);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });
});

describe("runTagDiff", () => {
  function setupTagMocks(diffResult: TagProtectionDiffResult): void {
    mockedFetcher.isGhAvailable.mockResolvedValue(true);
    mockedCore.loadConfig.mockReturnValue({
      config: {
        process: {
          repo: {
            tag_protection: {
              patterns: ["v*"],
              prevent_deletion: true,
              prevent_update: true,
            },
          },
        },
      },
      configPath: "/root/standards.toml",
    } as ReturnType<typeof core.loadConfig>);
    mockedCore.getProjectRoot.mockReturnValue("/root");
    mockedFetcher.getRepoInfo.mockResolvedValue(mockRepoInfo);
    mockedFetcher.fetchTagProtection.mockResolvedValue({
      patterns: [],
      preventDeletion: false,
      preventUpdate: false,
      rulesetId: null,
      rulesetName: null,
    });
    mockedDiffer.computeTagDiff.mockReturnValue(diffResult);
    mockedDiffer.formatValue.mockImplementation((v: unknown) => (v === null ? "not set" : String(v)));
  }

  it("exits with 0 when there are no changes", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    setupTagMocks({
      repoInfo: mockRepoInfo,
      diffs: [],
      hasChanges: false,
      currentRulesetId: null,
    });

    await runTagDiff(defaultOptions);

    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("exits with 1 when there are changes", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    setupTagMocks({
      repoInfo: mockRepoInfo,
      diffs: [{ setting: "patterns", current: [], desired: ["v*"], action: "add" }],
      hasChanges: true,
      currentRulesetId: null,
    });

    await runTagDiff(defaultOptions);

    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("exits with 2 on error", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockedFetcher.isGhAvailable.mockResolvedValue(false);

    await runTagDiff(defaultOptions);

    expect(mockExit).toHaveBeenCalledWith(2);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });
});

describe("runTagSync", () => {
  function setupTagMocks(diffResult: TagProtectionDiffResult): void {
    mockedFetcher.isGhAvailable.mockResolvedValue(true);
    mockedCore.loadConfig.mockReturnValue({
      config: {
        process: {
          repo: {
            tag_protection: {
              patterns: ["v*"],
              prevent_deletion: true,
              prevent_update: true,
            },
          },
        },
      },
      configPath: "/root/standards.toml",
    } as ReturnType<typeof core.loadConfig>);
    mockedCore.getProjectRoot.mockReturnValue("/root");
    mockedFetcher.getRepoInfo.mockResolvedValue(mockRepoInfo);
    mockedFetcher.fetchTagProtection.mockResolvedValue({
      patterns: [],
      preventDeletion: false,
      preventUpdate: false,
      rulesetId: null,
      rulesetName: null,
    });
    mockedDiffer.computeTagDiff.mockReturnValue(diffResult);
    mockedDiffer.formatValue.mockImplementation((v: unknown) => (v === null ? "not set" : String(v)));
  }

  it("exits with 0 when there are no changes", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    setupTagMocks({
      repoInfo: mockRepoInfo,
      diffs: [],
      hasChanges: false,
      currentRulesetId: null,
    });

    await runTagSync(defaultOptions);

    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("exits with 0 for preview mode (no --apply)", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    setupTagMocks({
      repoInfo: mockRepoInfo,
      diffs: [{ setting: "patterns", current: [], desired: ["v*"], action: "add" }],
      hasChanges: true,
      currentRulesetId: null,
    });

    await runTagSync({ ...defaultOptions, apply: false });

    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("applies changes and exits with 0 on success", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const diffs = [{ setting: "patterns", current: [] as string[], desired: ["v*"], action: "add" as const }];
    setupTagMocks({
      repoInfo: mockRepoInfo,
      diffs,
      hasChanges: true,
      currentRulesetId: null,
    });
    mockedApplier.applyTagProtection.mockResolvedValue({
      success: true,
      applied: diffs,
      failed: [],
    });

    await runTagSync({ ...defaultOptions, apply: true });

    expect(mockedApplier.applyTagProtection).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("exits with 1 when apply fails", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const diffs = [{ setting: "patterns", current: [] as string[], desired: ["v*"], action: "add" as const }];
    setupTagMocks({
      repoInfo: mockRepoInfo,
      diffs,
      hasChanges: true,
      currentRulesetId: null,
    });
    mockedApplier.applyTagProtection.mockResolvedValue({
      success: false,
      applied: [],
      failed: [{ diff: diffs[0], error: "API error" }],
    });

    await runTagSync({ ...defaultOptions, apply: true });

    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });

  it("exits with 2 on error", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockedFetcher.isGhAvailable.mockResolvedValue(false);

    await runTagSync({ ...defaultOptions, apply: true });

    expect(mockExit).toHaveBeenCalledWith(2);
    mockExit.mockRestore();
    mockWrite.mockRestore();
  });
});
