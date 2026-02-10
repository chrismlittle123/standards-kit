import { describe, it, expect } from "vitest";

import {
  type RulesetResponse,
  validateRulesets,
} from "../../../../src/process/scan/validators.js";

/** Helper to create a minimal branch ruleset */
function branchRuleset(overrides: Partial<RulesetResponse> = {}): RulesetResponse {
  return {
    id: 1,
    name: "Branch Protection",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    bypass_actors: [],
    rules: [],
    ...overrides,
  };
}

/** Helper to create a minimal tag ruleset */
function tagRuleset(overrides: Partial<RulesetResponse> = {}): RulesetResponse {
  return {
    id: 2,
    name: "Tag Protection",
    target: "tag",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/tags/v*"], exclude: [] } },
    rules: [{ type: "deletion" }, { type: "update" }],
    ...overrides,
  };
}

describe("validateRulesets", () => {
  it("returns empty array when repoConfig is undefined", () => {
    const result = validateRulesets([], undefined);
    expect(result).toEqual([]);
  });

  it("returns empty array when no rules are configured", () => {
    const result = validateRulesets([], {});
    expect(result).toEqual([]);
  });

  describe("branch protection", () => {
    it("reports violation when require_branch_protection is set but no ruleset exists", () => {
      const result = validateRulesets([], {
        require_branch_protection: true,
      });
      expect(result).toHaveLength(1);
      expect(result[0].rule).toBe("process.repo.branch_protection");
      expect(result[0].message).toContain("main");
      expect(result[0].message).toContain("does not have a branch protection ruleset");
    });

    it("reports violation for custom branch when no matching ruleset exists", () => {
      const result = validateRulesets([], {
        require_branch_protection: true,
        ruleset: { branch: "develop" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].message).toContain("develop");
    });

    it("passes when matching branch ruleset exists", () => {
      const result = validateRulesets([branchRuleset()], {
        require_branch_protection: true,
      });
      expect(result).toEqual([]);
    });

    it("matches ~DEFAULT_BRANCH pattern to main", () => {
      const rs = branchRuleset({
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      });
      const result = validateRulesets([rs], {
        require_branch_protection: true,
      });
      expect(result).toEqual([]);
    });

    it("matches ~ALL pattern", () => {
      const rs = branchRuleset({
        conditions: { ref_name: { include: ["~ALL"], exclude: [] } },
      });
      const result = validateRulesets([rs], {
        require_branch_protection: true,
      });
      expect(result).toEqual([]);
    });

    it("matches wildcard patterns", () => {
      const rs = branchRuleset({
        conditions: { ref_name: { include: ["release/*"], exclude: [] } },
      });
      const result = validateRulesets([rs], {
        require_branch_protection: true,
        ruleset: { branch: "release/v1.0" },
      });
      expect(result).toEqual([]);
    });

    it("ignores inactive rulesets", () => {
      const rs = branchRuleset({ enforcement: "disabled" });
      const result = validateRulesets([rs], {
        require_branch_protection: true,
      });
      expect(result).toHaveLength(1);
    });

    it("ignores tag rulesets for branch protection", () => {
      const rs = branchRuleset({ target: "tag" });
      const result = validateRulesets([rs], {
        require_branch_protection: true,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("pull request rule validation", () => {
    it("reports violation when required_reviews is below configured minimum", () => {
      const rs = branchRuleset({
        rules: [{ type: "pull_request", parameters: { required_approving_review_count: 1 } }],
      });
      const result = validateRulesets([rs], {
        ruleset: { required_reviews: 2 },
      });
      expect(result).toHaveLength(1);
      expect(result[0].rule).toBe("process.repo.branch_protection.required_reviews");
    });

    it("passes when required_reviews meets configured minimum", () => {
      const rs = branchRuleset({
        rules: [{ type: "pull_request", parameters: { required_approving_review_count: 2 } }],
      });
      const result = validateRulesets([rs], {
        ruleset: { required_reviews: 2 },
      });
      expect(result).toEqual([]);
    });

    it("reports violation when dismiss_stale_reviews is required but not set", () => {
      const rs = branchRuleset({
        rules: [{ type: "pull_request", parameters: { dismiss_stale_reviews_on_push: false } }],
      });
      const result = validateRulesets([rs], {
        ruleset: { dismiss_stale_reviews: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0].rule).toBe("process.repo.branch_protection.dismiss_stale_reviews");
    });

    it("passes when dismiss_stale_reviews is enabled", () => {
      const rs = branchRuleset({
        rules: [{ type: "pull_request", parameters: { dismiss_stale_reviews_on_push: true } }],
      });
      const result = validateRulesets([rs], {
        ruleset: { dismiss_stale_reviews: true },
      });
      expect(result).toEqual([]);
    });

    it("reports violation when code owner reviews required but not set", () => {
      const rs = branchRuleset({
        rules: [{ type: "pull_request", parameters: { require_code_owner_review: false } }],
      });
      const result = validateRulesets([rs], {
        ruleset: { require_code_owner_reviews: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0].rule).toBe("process.repo.branch_protection.require_code_owner_reviews");
    });
  });

  describe("status checks validation", () => {
    it("reports violation when required status checks are missing", () => {
      const rs = branchRuleset({
        rules: [
          {
            type: "required_status_checks",
            parameters: { required_status_checks: [{ context: "ci/build" }] },
          },
        ],
      });
      const result = validateRulesets([rs], {
        ruleset: { require_status_checks: ["ci/build", "ci/test"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0].rule).toBe("process.repo.branch_protection.require_status_checks");
      expect(result[0].message).toContain("ci/test");
    });

    it("passes when all required status checks are present", () => {
      const rs = branchRuleset({
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [{ context: "ci/build" }, { context: "ci/test" }],
            },
          },
        ],
      });
      const result = validateRulesets([rs], {
        ruleset: { require_status_checks: ["ci/build", "ci/test"] },
      });
      expect(result).toEqual([]);
    });

    it("reports violation when require_branches_up_to_date is not set", () => {
      const rs = branchRuleset({
        rules: [
          {
            type: "required_status_checks",
            parameters: { strict_required_status_checks_policy: false },
          },
        ],
      });
      const result = validateRulesets([rs], {
        ruleset: { require_branches_up_to_date: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0].rule).toBe(
        "process.repo.branch_protection.require_branches_up_to_date"
      );
    });
  });

  describe("signed commits validation", () => {
    it("reports violation when signed commits required but not configured", () => {
      const rs = branchRuleset({ rules: [] });
      const result = validateRulesets([rs], {
        ruleset: { require_signed_commits: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0].rule).toBe("process.repo.branch_protection.require_signed_commits");
    });

    it("passes when required_signatures rule exists", () => {
      const rs = branchRuleset({ rules: [{ type: "required_signatures" }] });
      const result = validateRulesets([rs], {
        ruleset: { require_signed_commits: true },
      });
      expect(result).toEqual([]);
    });

    it("does not report when require_signed_commits is not set", () => {
      const rs = branchRuleset({ rules: [] });
      const result = validateRulesets([rs], {
        ruleset: { require_signed_commits: false },
      });
      expect(result).toEqual([]);
    });
  });

  describe("bypass actors validation", () => {
    it("reports violation when enforce_admins is true and bypass actors exist", () => {
      const rs = branchRuleset({
        bypass_actors: [{ actor_id: 1, actor_type: "RepositoryRole", bypass_mode: "always" }],
      });
      const result = validateRulesets([rs], {
        ruleset: { enforce_admins: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0].rule).toBe("process.repo.branch_protection.enforce_admins");
    });

    it("passes when enforce_admins is true and no bypass actors", () => {
      const rs = branchRuleset({ bypass_actors: [] });
      const result = validateRulesets([rs], {
        ruleset: { enforce_admins: true },
      });
      expect(result).toEqual([]);
    });

    it("passes when enforce_admins is not set", () => {
      const rs = branchRuleset({
        bypass_actors: [{ actor_id: 1, actor_type: "RepositoryRole", bypass_mode: "always" }],
      });
      const result = validateRulesets([rs], {
        ruleset: {},
      });
      expect(result).toEqual([]);
    });
  });

  describe("tag protection validation", () => {
    it("reports violation when no active tag ruleset found", () => {
      const result = validateRulesets([], {
        tag_protection: { patterns: ["v*"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0].rule).toBe("process.repo.tag_protection");
      expect(result[0].message).toContain("No active tag protection");
    });

    it("reports violation when tag patterns mismatch", () => {
      const rs = tagRuleset({
        conditions: { ref_name: { include: ["refs/tags/release-*"], exclude: [] } },
      });
      const result = validateRulesets([rs], {
        tag_protection: { patterns: ["v*"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0].rule).toBe("process.repo.tag_protection.patterns");
    });

    it("passes when tag patterns match", () => {
      const result = validateRulesets([tagRuleset()], {
        tag_protection: { patterns: ["v*"] },
      });
      // tagRuleset has deletion and update rules, so no violations for patterns or rules
      expect(result).toEqual([]);
    });

    it("reports violation when prevent_deletion rule is missing", () => {
      const rs = tagRuleset({ rules: [{ type: "update" }] });
      const result = validateRulesets([rs], {
        tag_protection: { patterns: ["v*"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0].rule).toBe("process.repo.tag_protection.prevent_deletion");
    });

    it("reports violation when prevent_update rule is missing", () => {
      const rs = tagRuleset({ rules: [{ type: "deletion" }] });
      const result = validateRulesets([rs], {
        tag_protection: { patterns: ["v*"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0].rule).toBe("process.repo.tag_protection.prevent_update");
    });

    it("does not check tag protection when no patterns configured", () => {
      const result = validateRulesets([], {
        tag_protection: { patterns: [] },
      });
      expect(result).toEqual([]);
    });

    it("does not check prevent_deletion when set to false", () => {
      const rs = tagRuleset({ rules: [{ type: "update" }] });
      const result = validateRulesets([rs], {
        tag_protection: { patterns: ["v*"], prevent_deletion: false },
      });
      expect(result).toEqual([]);
    });

    it("does not check prevent_update when set to false", () => {
      const rs = tagRuleset({ rules: [{ type: "deletion" }] });
      const result = validateRulesets([rs], {
        tag_protection: { patterns: ["v*"], prevent_update: false },
      });
      expect(result).toEqual([]);
    });
  });
});
