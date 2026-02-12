vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";

import {
  FetcherError,
  isGhAvailable,
  getRepoInfo,
  fetchBranchProtection,
  fetchTagProtection,
} from "../../../../src/process/sync/fetcher.js";

const mockedExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
});

/** Helper: mock list endpoint returning summaries, then individual fetch returning full details */
function mockListThenFetch(
  summaries: { id: number; name: string; target: string; enforcement: string }[],
  fullDetails: Record<number, Record<string, unknown>>
): void {
  mockedExeca.mockResolvedValueOnce({ stdout: JSON.stringify(summaries) } as never);
  // For each candidate that gets fetched individually, queue a response
  for (const summary of summaries) {
    if (fullDetails[summary.id]) {
      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify(fullDetails[summary.id]),
      } as never);
    }
  }
}

describe("isGhAvailable", () => {
  it("returns true when gh is installed", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "gh version 2.0.0" } as never);
    expect(await isGhAvailable()).toBe(true);
  });

  it("returns false when gh is not installed", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("not found"));
    expect(await isGhAvailable()).toBe(false);
  });
});

describe("getRepoInfo", () => {
  it("parses owner and repo from gh output", async () => {
    mockedExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ owner: { login: "acme" }, name: "my-app" }),
    } as never);
    const result = await getRepoInfo("/project");
    expect(result).toEqual({ owner: "acme", repo: "my-app" });
    expect(mockedExeca).toHaveBeenCalledWith(
      "gh",
      ["repo", "view", "--json", "owner,name"],
      { cwd: "/project" }
    );
  });

  it("throws FetcherError when gh command fails", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("not a git repo"));
    await expect(getRepoInfo("/nowhere")).rejects.toThrow(FetcherError);
    try {
      await getRepoInfo("/nowhere");
    } catch (e) {
      expect((e as FetcherError).code).toBe("NO_REPO");
    }
  });
});

describe("fetchBranchProtection", () => {
  const repoInfo = { owner: "acme", repo: "app" };

  it("returns empty settings when no matching branch ruleset found", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "[]" } as never);
    const result = await fetchBranchProtection(repoInfo, "main");
    expect(result.branch).toBe("main");
    expect(result.requiredReviews).toBeNull();
    expect(result.rulesetId).toBeNull();
  });

  it("parses branch protection settings from active ruleset", async () => {
    const fullRuleset = {
      id: 1,
      name: "Branch Protection",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
      bypass_actors: [],
      rules: [
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 2,
            dismiss_stale_reviews_on_push: true,
            require_code_owner_review: true,
          },
        },
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [{ context: "ci/build" }],
            strict_required_status_checks_policy: true,
          },
        },
        { type: "required_signatures" },
      ],
    };
    mockListThenFetch(
      [{ id: 1, name: "Branch Protection", target: "branch", enforcement: "active" }],
      { 1: fullRuleset }
    );
    const result = await fetchBranchProtection(repoInfo, "main");
    expect(result.branch).toBe("main");
    expect(result.requiredReviews).toBe(2);
    expect(result.dismissStaleReviews).toBe(true);
    expect(result.requireCodeOwnerReviews).toBe(true);
    expect(result.requiredStatusChecks).toEqual(["ci/build"]);
    expect(result.requireBranchesUpToDate).toBe(true);
    expect(result.requireSignedCommits).toBe(true);
    expect(result.enforceAdmins).toBe(true);
    expect(result.rulesetId).toBe(1);
  });

  it("parses bypass actors and sets enforceAdmins to false", async () => {
    const fullRuleset = {
      id: 1,
      name: "BP",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
      bypass_actors: [
        { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
      ],
      rules: [],
    };
    mockListThenFetch(
      [{ id: 1, name: "BP", target: "branch", enforcement: "active" }],
      { 1: fullRuleset }
    );
    const result = await fetchBranchProtection(repoInfo, "main");
    expect(result.enforceAdmins).toBe(false);
    expect(result.bypassActors).toEqual([
      { actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" },
    ]);
  });

  it("returns empty settings on 404 error", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("404 Not Found"));
    const result = await fetchBranchProtection(repoInfo, "main");
    expect(result.rulesetId).toBeNull();
    expect(result.requiredReviews).toBeNull();
  });

  it("throws FetcherError on 403 error", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("403 Must have admin rights"));
    try {
      await fetchBranchProtection(repoInfo, "main");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FetcherError);
      expect((e as FetcherError).code).toBe("NO_PERMISSION");
    }
  });

  it("throws FetcherError on generic API error", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("server error"));
    try {
      await fetchBranchProtection(repoInfo, "main");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FetcherError);
      expect((e as FetcherError).code).toBe("API_ERROR");
    }
  });

  it("matches ~DEFAULT_BRANCH to main", async () => {
    const fullRuleset = {
      id: 1,
      name: "BP",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: [],
    };
    mockListThenFetch(
      [{ id: 1, name: "BP", target: "branch", enforcement: "active" }],
      { 1: fullRuleset }
    );
    const result = await fetchBranchProtection(repoInfo, "main");
    expect(result.rulesetId).toBe(1);
  });

  it("matches ~ALL pattern to any branch", async () => {
    const fullRuleset = {
      id: 1,
      name: "BP",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~ALL"], exclude: [] } },
      rules: [],
    };
    mockListThenFetch(
      [{ id: 1, name: "BP", target: "branch", enforcement: "active" }],
      { 1: fullRuleset }
    );
    const result = await fetchBranchProtection(repoInfo, "develop");
    expect(result.rulesetId).toBe(1);
  });

  it("matches wildcard patterns", async () => {
    const fullRuleset = {
      id: 1,
      name: "BP",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["release/*"], exclude: [] } },
      rules: [],
    };
    mockListThenFetch(
      [{ id: 1, name: "BP", target: "branch", enforcement: "active" }],
      { 1: fullRuleset }
    );
    const result = await fetchBranchProtection(repoInfo, "release/v1.0");
    expect(result.rulesetId).toBe(1);
  });

  it("ignores inactive rulesets", async () => {
    // Disabled rulesets are filtered before individual fetch, so only the list call happens
    mockedExeca.mockResolvedValueOnce({
      stdout: JSON.stringify([
        { id: 1, name: "BP", target: "branch", enforcement: "disabled" },
      ]),
    } as never);
    const result = await fetchBranchProtection(repoInfo, "main");
    expect(result.rulesetId).toBeNull();
  });

  it("handles bypass_actors with null actor_id", async () => {
    const fullRuleset = {
      id: 1,
      name: "BP",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
      bypass_actors: [
        { actor_id: null, actor_type: "OrganizationAdmin", bypass_mode: "always" },
      ],
      rules: [],
    };
    mockListThenFetch(
      [{ id: 1, name: "BP", target: "branch", enforcement: "active" }],
      { 1: fullRuleset }
    );
    const result = await fetchBranchProtection(repoInfo, "main");
    expect(result.bypassActors).toEqual([
      { actor_type: "OrganizationAdmin", actor_id: undefined, bypass_mode: "always" },
    ]);
  });

  it("falls back to summary when individual fetch fails", async () => {
    // List returns a candidate, but individual fetch fails
    mockedExeca.mockResolvedValueOnce({
      stdout: JSON.stringify([
        { id: 1, name: "BP", target: "branch", enforcement: "active" },
      ]),
    } as never);
    mockedExeca.mockRejectedValueOnce(new Error("timeout"));
    // Falls back to summary (no conditions), so no match found
    const result = await fetchBranchProtection(repoInfo, "main");
    expect(result.rulesetId).toBeNull();
  });

  it("fetches individual rulesets to get conditions and rules", async () => {
    // List returns summary without conditions/rules (like real GitHub API)
    mockListThenFetch(
      [{ id: 42, name: "Branch Protection", target: "branch", enforcement: "active" }],
      {
        42: {
          id: 42,
          name: "Branch Protection",
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
          rules: [
            {
              type: "pull_request",
              parameters: { required_approving_review_count: 0 },
            },
          ],
        },
      }
    );
    const result = await fetchBranchProtection(repoInfo, "main");
    expect(result.rulesetId).toBe(42);
    expect(result.requiredReviews).toBe(0);
    // Verify both list and individual fetch were called
    expect(mockedExeca).toHaveBeenCalledTimes(2);
    expect(mockedExeca).toHaveBeenCalledWith("gh", [
      "api",
      "repos/acme/app/rulesets",
    ]);
    expect(mockedExeca).toHaveBeenCalledWith("gh", [
      "api",
      "repos/acme/app/rulesets/42",
    ]);
  });
});

describe("fetchTagProtection", () => {
  const repoInfo = { owner: "acme", repo: "app" };

  it("returns empty settings when no tag ruleset found", async () => {
    mockedExeca.mockResolvedValueOnce({ stdout: "[]" } as never);
    const result = await fetchTagProtection(repoInfo);
    expect(result.patterns).toEqual([]);
    expect(result.preventDeletion).toBe(false);
    expect(result.preventUpdate).toBe(false);
    expect(result.rulesetId).toBeNull();
  });

  it("parses tag protection settings", async () => {
    const fullRuleset = {
      id: 2,
      name: "Tag Protection",
      target: "tag",
      enforcement: "active",
      conditions: {
        ref_name: { include: ["refs/tags/v*"], exclude: [] },
      },
      rules: [{ type: "deletion" }, { type: "update" }],
    };
    mockListThenFetch(
      [{ id: 2, name: "Tag Protection", target: "tag", enforcement: "active" }],
      { 2: fullRuleset }
    );
    const result = await fetchTagProtection(repoInfo);
    expect(result.patterns).toEqual(["v*"]);
    expect(result.preventDeletion).toBe(true);
    expect(result.preventUpdate).toBe(true);
    expect(result.rulesetId).toBe(2);
  });

  it("returns empty settings on 404 error", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("404"));
    const result = await fetchTagProtection(repoInfo);
    expect(result.rulesetId).toBeNull();
  });

  it("throws FetcherError on 403 error", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("403 Must have admin rights"));
    await expect(fetchTagProtection(repoInfo)).rejects.toThrow(FetcherError);
  });

  it("throws FetcherError on generic error", async () => {
    mockedExeca.mockRejectedValueOnce(new Error("timeout"));
    await expect(fetchTagProtection(repoInfo)).rejects.toThrow(FetcherError);
  });

  it("fetches individual tag rulesets for full details", async () => {
    const fullRuleset = {
      id: 5,
      name: "Tag Protection",
      target: "tag",
      enforcement: "active",
      conditions: { ref_name: { include: ["refs/tags/v*"], exclude: [] } },
      rules: [{ type: "deletion" }],
    };
    mockListThenFetch(
      [{ id: 5, name: "Tag Protection", target: "tag", enforcement: "active" }],
      { 5: fullRuleset }
    );
    const result = await fetchTagProtection(repoInfo);
    expect(result.rulesetId).toBe(5);
    expect(result.preventDeletion).toBe(true);
    expect(mockedExeca).toHaveBeenCalledTimes(2);
    expect(mockedExeca).toHaveBeenCalledWith("gh", [
      "api",
      "repos/acme/app/rulesets/5",
    ]);
  });
});
