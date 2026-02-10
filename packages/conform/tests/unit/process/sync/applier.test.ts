vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";

import {
  ApplierError,
  applyBranchProtection,
  applyTagProtection,
} from "../../../../src/process/sync/applier.js";
import type {
  DesiredBranchProtection,
  DesiredTagProtection,
  SyncDiffResult,
  TagProtectionDiffResult,
} from "../../../../src/process/sync/types.js";

const mockedExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
});

const repoInfo = { owner: "acme", repo: "app" };

describe("applyBranchProtection", () => {
  it("returns success with no applied when no changes", async () => {
    const diffResult: SyncDiffResult = {
      repoInfo,
      branch: "main",
      diffs: [],
      hasChanges: false,
      currentRulesetId: null,
    };
    const result = await applyBranchProtection(repoInfo, "main", {}, diffResult);
    expect(result.success).toBe(true);
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(mockedExeca).not.toHaveBeenCalled();
  });

  it("creates a new ruleset via POST when currentRulesetId is null", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "{}" } as never);
    const diffs = [{ setting: "required_reviews", current: null, desired: 2, action: "add" as const }];
    const diffResult: SyncDiffResult = {
      repoInfo,
      branch: "main",
      diffs,
      hasChanges: true,
      currentRulesetId: null,
    };
    const desired: DesiredBranchProtection = { required_reviews: 2 };
    const result = await applyBranchProtection(repoInfo, "main", desired, diffResult);
    expect(result.success).toBe(true);
    expect(result.applied).toEqual(diffs);
    expect(mockedExeca).toHaveBeenCalledWith(
      "gh",
      ["api", "repos/acme/app/rulesets", "-X", "POST", "--input", "-"],
      expect.objectContaining({ input: expect.any(String) })
    );
  });

  it("updates existing ruleset via PUT when currentRulesetId is set", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "{}" } as never);
    const diffs = [{ setting: "required_reviews", current: 1, desired: 2, action: "change" as const }];
    const diffResult: SyncDiffResult = {
      repoInfo,
      branch: "main",
      diffs,
      hasChanges: true,
      currentRulesetId: 42,
    };
    const desired: DesiredBranchProtection = { required_reviews: 2 };
    const result = await applyBranchProtection(repoInfo, "main", desired, diffResult);
    expect(result.success).toBe(true);
    expect(mockedExeca).toHaveBeenCalledWith(
      "gh",
      ["api", "repos/acme/app/rulesets/42", "-X", "PUT", "--input", "-"],
      expect.objectContaining({ input: expect.any(String) })
    );
  });

  it("builds correct request body with pull_request rule", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "{}" } as never);
    const diffs = [{ setting: "required_reviews", current: null, desired: 2, action: "add" as const }];
    const diffResult: SyncDiffResult = {
      repoInfo,
      branch: "main",
      diffs,
      hasChanges: true,
      currentRulesetId: null,
    };
    const desired: DesiredBranchProtection = {
      required_reviews: 2,
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
    };
    await applyBranchProtection(repoInfo, "main", desired, diffResult);
    const callArgs = mockedExeca.mock.calls[0];
    const body = JSON.parse((callArgs[2] as { input: string }).input);
    expect(body.name).toBe("Branch Protection");
    expect(body.target).toBe("branch");
    expect(body.enforcement).toBe("active");
    expect(body.conditions.ref_name.include).toEqual(["refs/heads/main"]);
    const prRule = body.rules.find((r: { type: string }) => r.type === "pull_request");
    expect(prRule.parameters.required_approving_review_count).toBe(2);
    expect(prRule.parameters.dismiss_stale_reviews_on_push).toBe(true);
    expect(prRule.parameters.require_code_owner_review).toBe(true);
  });

  it("builds correct request body with status checks rule", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "{}" } as never);
    const diffs = [{ setting: "require_status_checks", current: null, desired: ["ci"], action: "add" as const }];
    const diffResult: SyncDiffResult = {
      repoInfo,
      branch: "main",
      diffs,
      hasChanges: true,
      currentRulesetId: null,
    };
    const desired: DesiredBranchProtection = {
      require_status_checks: ["ci/build"],
      require_branches_up_to_date: true,
    };
    await applyBranchProtection(repoInfo, "main", desired, diffResult);
    const callArgs = mockedExeca.mock.calls[0];
    const body = JSON.parse((callArgs[2] as { input: string }).input);
    const statusRule = body.rules.find(
      (r: { type: string }) => r.type === "required_status_checks"
    );
    expect(statusRule.parameters.required_status_checks).toEqual([{ context: "ci/build" }]);
    expect(statusRule.parameters.strict_required_status_checks_policy).toBe(true);
  });

  it("includes required_signatures rule when configured", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "{}" } as never);
    const diffs = [{ setting: "require_signed_commits", current: false, desired: true, action: "change" as const }];
    const diffResult: SyncDiffResult = {
      repoInfo,
      branch: "main",
      diffs,
      hasChanges: true,
      currentRulesetId: null,
    };
    const desired: DesiredBranchProtection = { require_signed_commits: true };
    await applyBranchProtection(repoInfo, "main", desired, diffResult);
    const callArgs = mockedExeca.mock.calls[0];
    const body = JSON.parse((callArgs[2] as { input: string }).input);
    expect(body.rules.some((r: { type: string }) => r.type === "required_signatures")).toBe(true);
  });

  it("includes bypass_actors when configured", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "{}" } as never);
    const diffs = [{ setting: "bypass_actors", current: [], desired: [], action: "add" as const }];
    const diffResult: SyncDiffResult = {
      repoInfo,
      branch: "main",
      diffs,
      hasChanges: true,
      currentRulesetId: null,
    };
    const desired: DesiredBranchProtection = {
      bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" }],
    };
    await applyBranchProtection(repoInfo, "main", desired, diffResult);
    const callArgs = mockedExeca.mock.calls[0];
    const body = JSON.parse((callArgs[2] as { input: string }).input);
    expect(body.bypass_actors).toEqual([
      { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
    ]);
  });

  it("throws ApplierError on 403 permission error", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("403 Must have admin rights"));
    const diffs = [{ setting: "required_reviews", current: 1, desired: 2, action: "change" as const }];
    const diffResult: SyncDiffResult = {
      repoInfo,
      branch: "main",
      diffs,
      hasChanges: true,
      currentRulesetId: 1,
    };
    await expect(
      applyBranchProtection(repoInfo, "main", { required_reviews: 2 }, diffResult)
    ).rejects.toThrow(ApplierError);
  });

  it("returns failed result on other API errors", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("server error"));
    const diffs = [{ setting: "required_reviews", current: 1, desired: 2, action: "change" as const }];
    const diffResult: SyncDiffResult = {
      repoInfo,
      branch: "main",
      diffs,
      hasChanges: true,
      currentRulesetId: 1,
    };
    const result = await applyBranchProtection(
      repoInfo,
      "main",
      { required_reviews: 2 },
      diffResult
    );
    expect(result.success).toBe(false);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("server error");
  });
});

describe("applyTagProtection", () => {
  it("returns success with no applied when no changes", async () => {
    const diffResult: TagProtectionDiffResult = {
      repoInfo,
      diffs: [],
      hasChanges: false,
      currentRulesetId: null,
    };
    const result = await applyTagProtection(repoInfo, {}, diffResult);
    expect(result.success).toBe(true);
    expect(result.applied).toEqual([]);
    expect(mockedExeca).not.toHaveBeenCalled();
  });

  it("creates a new tag ruleset via POST when currentRulesetId is null", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "{}" } as never);
    const diffs = [{ setting: "patterns", current: [], desired: ["v*"], action: "add" as const }];
    const diffResult: TagProtectionDiffResult = {
      repoInfo,
      diffs,
      hasChanges: true,
      currentRulesetId: null,
    };
    const desired: DesiredTagProtection = { patterns: ["v*"] };
    const result = await applyTagProtection(repoInfo, desired, diffResult);
    expect(result.success).toBe(true);
    expect(mockedExeca).toHaveBeenCalledWith(
      "gh",
      ["api", "repos/acme/app/rulesets", "-X", "POST", "--input", "-"],
      expect.objectContaining({ input: expect.any(String) })
    );
  });

  it("updates existing tag ruleset via PUT", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "{}" } as never);
    const diffs = [{ setting: "patterns", current: ["v*"], desired: ["v*", "release-*"], action: "change" as const }];
    const diffResult: TagProtectionDiffResult = {
      repoInfo,
      diffs,
      hasChanges: true,
      currentRulesetId: 5,
    };
    await applyTagProtection(repoInfo, { patterns: ["v*", "release-*"] }, diffResult);
    expect(mockedExeca).toHaveBeenCalledWith(
      "gh",
      ["api", "repos/acme/app/rulesets/5", "-X", "PUT", "--input", "-"],
      expect.objectContaining({ input: expect.any(String) })
    );
  });

  it("builds correct tag ruleset body", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "{}" } as never);
    const diffs = [{ setting: "patterns", current: [], desired: ["v*"], action: "add" as const }];
    const diffResult: TagProtectionDiffResult = {
      repoInfo,
      diffs,
      hasChanges: true,
      currentRulesetId: null,
    };
    const desired: DesiredTagProtection = {
      patterns: ["v*"],
      prevent_deletion: true,
      prevent_update: true,
    };
    await applyTagProtection(repoInfo, desired, diffResult);
    const callArgs = mockedExeca.mock.calls[0];
    const body = JSON.parse((callArgs[2] as { input: string }).input);
    expect(body.name).toBe("Tag Protection");
    expect(body.target).toBe("tag");
    expect(body.enforcement).toBe("active");
    expect(body.conditions.ref_name.include).toEqual(["refs/tags/v*"]);
    expect(body.rules).toContainEqual({ type: "deletion" });
    expect(body.rules).toContainEqual({ type: "update" });
  });

  it("omits deletion rule when prevent_deletion is false", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "{}" } as never);
    const diffs = [{ setting: "prevent_update", current: false, desired: true, action: "add" as const }];
    const diffResult: TagProtectionDiffResult = {
      repoInfo,
      diffs,
      hasChanges: true,
      currentRulesetId: null,
    };
    const desired: DesiredTagProtection = { prevent_deletion: false, prevent_update: true };
    await applyTagProtection(repoInfo, desired, diffResult);
    const callArgs = mockedExeca.mock.calls[0];
    const body = JSON.parse((callArgs[2] as { input: string }).input);
    expect(body.rules).not.toContainEqual({ type: "deletion" });
    expect(body.rules).toContainEqual({ type: "update" });
  });

  it("throws ApplierError on 403 permission error", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("403 Must have admin rights"));
    const diffs = [{ setting: "patterns", current: [], desired: ["v*"], action: "add" as const }];
    const diffResult: TagProtectionDiffResult = {
      repoInfo,
      diffs,
      hasChanges: true,
      currentRulesetId: null,
    };
    await expect(applyTagProtection(repoInfo, { patterns: ["v*"] }, diffResult)).rejects.toThrow(
      ApplierError
    );
  });

  it("returns failed result on other API errors", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("server error"));
    const diffs = [{ setting: "patterns", current: [], desired: ["v*"], action: "add" as const }];
    const diffResult: TagProtectionDiffResult = {
      repoInfo,
      diffs,
      hasChanges: true,
      currentRulesetId: null,
    };
    const result = await applyTagProtection(repoInfo, { patterns: ["v*"] }, diffResult);
    expect(result.success).toBe(false);
    expect(result.failed).toHaveLength(1);
  });
});
