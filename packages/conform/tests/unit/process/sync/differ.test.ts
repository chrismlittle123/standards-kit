import { describe, it, expect } from "vitest";

import { computeDiff, computeTagDiff, formatValue } from "../../../../src/process/sync/differ.js";
import type {
  BranchProtectionSettings,
  DesiredBranchProtection,
  TagProtectionSettings,
  DesiredTagProtection,
} from "../../../../src/process/sync/types.js";

/** Helper to create empty branch protection settings */
function emptySettings(overrides: Partial<BranchProtectionSettings> = {}): BranchProtectionSettings {
  return {
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
    ...overrides,
  };
}

const repoInfo = { owner: "acme", repo: "app" };

describe("computeDiff", () => {
  it("returns no diffs when current matches desired", () => {
    const current = emptySettings({ requiredReviews: 2 });
    const desired: DesiredBranchProtection = { required_reviews: 2 };
    const result = computeDiff(repoInfo, current, desired);
    expect(result.hasChanges).toBe(false);
    expect(result.diffs).toEqual([]);
  });

  it("detects required_reviews difference", () => {
    const current = emptySettings({ requiredReviews: 1 });
    const desired: DesiredBranchProtection = { required_reviews: 2 };
    const result = computeDiff(repoInfo, current, desired);
    expect(result.hasChanges).toBe(true);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0].setting).toBe("required_reviews");
    expect(result.diffs[0].current).toBe(1);
    expect(result.diffs[0].desired).toBe(2);
    expect(result.diffs[0].action).toBe("change");
  });

  it("uses add action when current is null", () => {
    const current = emptySettings({ requiredReviews: null });
    const desired: DesiredBranchProtection = { required_reviews: 2 };
    const result = computeDiff(repoInfo, current, desired);
    expect(result.diffs[0].action).toBe("add");
  });

  it("ignores fields not specified in desired", () => {
    const current = emptySettings({ requiredReviews: 1, dismissStaleReviews: false });
    const desired: DesiredBranchProtection = { required_reviews: 2 };
    const result = computeDiff(repoInfo, current, desired);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0].setting).toBe("required_reviews");
  });

  it("detects boolean field differences", () => {
    const current = emptySettings({ dismissStaleReviews: false });
    const desired: DesiredBranchProtection = { dismiss_stale_reviews: true };
    const result = computeDiff(repoInfo, current, desired);
    expect(result.hasChanges).toBe(true);
    expect(result.diffs[0].setting).toBe("dismiss_stale_reviews");
  });

  it("detects status checks array difference", () => {
    const current = emptySettings({ requiredStatusChecks: ["ci/build"] });
    const desired: DesiredBranchProtection = { require_status_checks: ["ci/build", "ci/test"] };
    const result = computeDiff(repoInfo, current, desired);
    expect(result.hasChanges).toBe(true);
    expect(result.diffs[0].setting).toBe("require_status_checks");
  });

  it("treats null status checks as empty array for comparison", () => {
    const current = emptySettings({ requiredStatusChecks: null });
    const desired: DesiredBranchProtection = { require_status_checks: ["ci/build"] };
    const result = computeDiff(repoInfo, current, desired);
    expect(result.diffs[0].action).toBe("add");
  });

  it("considers arrays equal regardless of order", () => {
    const current = emptySettings({ requiredStatusChecks: ["ci/test", "ci/build"] });
    const desired: DesiredBranchProtection = { require_status_checks: ["ci/build", "ci/test"] };
    const result = computeDiff(repoInfo, current, desired);
    expect(result.hasChanges).toBe(false);
  });

  it("detects bypass_actors difference", () => {
    const current = emptySettings({
      bypassActors: [{ actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" }],
      rulesetId: 1,
    });
    const desired: DesiredBranchProtection = {
      bypass_actors: [{ actor_type: "Team", actor_id: 10, bypass_mode: "always" }],
    };
    const result = computeDiff(repoInfo, current, desired);
    expect(result.hasChanges).toBe(true);
    expect(result.diffs.some((d) => d.setting === "bypass_actors")).toBe(true);
  });

  it("considers bypass_actors equal when they match", () => {
    const current = emptySettings({
      bypassActors: [{ actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" }],
    });
    const desired: DesiredBranchProtection = {
      bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" }],
    };
    const result = computeDiff(repoInfo, current, desired);
    expect(result.diffs.some((d) => d.setting === "bypass_actors")).toBe(false);
  });

  it("normalizes bypass_mode default to always", () => {
    const current = emptySettings({
      bypassActors: [{ actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" }],
    });
    const desired: DesiredBranchProtection = {
      bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5 }],
    };
    const result = computeDiff(repoInfo, current, desired);
    expect(result.diffs.some((d) => d.setting === "bypass_actors")).toBe(false);
  });

  it("includes repoInfo and branch in result", () => {
    const result = computeDiff(repoInfo, emptySettings(), {});
    expect(result.repoInfo).toEqual(repoInfo);
    expect(result.branch).toBe("main");
  });

  it("includes currentRulesetId in result", () => {
    const current = emptySettings({ rulesetId: 42 });
    const result = computeDiff(repoInfo, current, {});
    expect(result.currentRulesetId).toBe(42);
  });

  it("detects multiple diffs at once", () => {
    const current = emptySettings({
      requiredReviews: 1,
      dismissStaleReviews: false,
      requireSignedCommits: false,
    });
    const desired: DesiredBranchProtection = {
      required_reviews: 2,
      dismiss_stale_reviews: true,
      require_signed_commits: true,
    };
    const result = computeDiff(repoInfo, current, desired);
    expect(result.diffs).toHaveLength(3);
  });
});

describe("computeTagDiff", () => {
  const emptyTag: TagProtectionSettings = {
    patterns: [],
    preventDeletion: false,
    preventUpdate: false,
    rulesetId: null,
    rulesetName: null,
  };

  it("returns no diffs when current matches desired", () => {
    const current: TagProtectionSettings = {
      patterns: ["v*"],
      preventDeletion: true,
      preventUpdate: true,
      rulesetId: 1,
      rulesetName: "Tag Protection",
    };
    const desired: DesiredTagProtection = {
      patterns: ["v*"],
      prevent_deletion: true,
      prevent_update: true,
    };
    const result = computeTagDiff(repoInfo, current, desired);
    expect(result.hasChanges).toBe(false);
  });

  it("detects pattern difference", () => {
    const desired: DesiredTagProtection = { patterns: ["v*"] };
    const result = computeTagDiff(repoInfo, emptyTag, desired);
    expect(result.hasChanges).toBe(true);
    expect(result.diffs[0].setting).toBe("patterns");
  });

  it("detects prevent_deletion difference", () => {
    const desired: DesiredTagProtection = { prevent_deletion: true };
    const result = computeTagDiff(repoInfo, emptyTag, desired);
    expect(result.hasChanges).toBe(true);
    expect(result.diffs[0].setting).toBe("prevent_deletion");
  });

  it("detects prevent_update difference", () => {
    const desired: DesiredTagProtection = { prevent_update: true };
    const result = computeTagDiff(repoInfo, emptyTag, desired);
    expect(result.hasChanges).toBe(true);
    expect(result.diffs[0].setting).toBe("prevent_update");
  });

  it("uses add action when rulesetId is null", () => {
    const desired: DesiredTagProtection = { prevent_deletion: true };
    const result = computeTagDiff(repoInfo, emptyTag, desired);
    expect(result.diffs[0].action).toBe("add");
  });

  it("uses change action when rulesetId is set", () => {
    const current: TagProtectionSettings = { ...emptyTag, rulesetId: 1 };
    const desired: DesiredTagProtection = { prevent_deletion: true };
    const result = computeTagDiff(repoInfo, current, desired);
    expect(result.diffs[0].action).toBe("change");
  });

  it("ignores fields not specified in desired", () => {
    const result = computeTagDiff(repoInfo, emptyTag, {});
    expect(result.hasChanges).toBe(false);
  });
});

describe("formatValue", () => {
  it("returns 'not set' for null", () => {
    expect(formatValue(null)).toBe("not set");
  });

  it("returns 'not set' for undefined", () => {
    expect(formatValue(undefined)).toBe("not set");
  });

  it("returns '[]' for empty array", () => {
    expect(formatValue([])).toBe("[]");
  });

  it("formats non-empty array with brackets", () => {
    expect(formatValue(["a", "b"])).toBe("[a, b]");
  });

  it("converts numbers to string", () => {
    expect(formatValue(42)).toBe("42");
  });

  it("converts booleans to string", () => {
    expect(formatValue(true)).toBe("true");
    expect(formatValue(false)).toBe("false");
  });

  it("converts strings directly", () => {
    expect(formatValue("hello")).toBe("hello");
  });
});
