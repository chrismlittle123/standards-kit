import { execa } from "execa";

import {
  type BranchProtectionSettings,
  type BypassActor,
  type GitHubRuleset,
  type GitHubRulesetBypassActor,
  type RepoInfo,
  type TagProtectionSettings,
} from "./types.js";

/** Error thrown when fetcher encounters an issue */
export class FetcherError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_GH" | "NO_REPO" | "NO_PERMISSION" | "API_ERROR"
  ) {
    super(message);
    this.name = "FetcherError";
  }
}

/** Check if gh CLI is available */
export async function isGhAvailable(): Promise<boolean> {
  try {
    await execa("gh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/** Get repository info from git remote */
export async function getRepoInfo(projectRoot: string): Promise<RepoInfo> {
  try {
    const result = await execa("gh", ["repo", "view", "--json", "owner,name"], {
      cwd: projectRoot,
    });
    const data = JSON.parse(result.stdout) as { owner: { login: string }; name: string };
    return { owner: data.owner.login, repo: data.name };
  } catch {
    throw new FetcherError("Could not determine GitHub repository from git remote", "NO_REPO");
  }
}

/** Fetch full details for a single ruleset by ID */
async function fetchRulesetById(repoInfo: RepoInfo, rulesetId: number): Promise<GitHubRuleset> {
  const result = await execa("gh", [
    "api",
    `repos/${repoInfo.owner}/${repoInfo.repo}/rulesets/${rulesetId}`,
  ]);
  return JSON.parse(result.stdout) as GitHubRuleset;
}

/** Fetch current branch protection settings from GitHub Rulesets */
export async function fetchBranchProtection(
  repoInfo: RepoInfo,
  branch: string
): Promise<BranchProtectionSettings> {
  try {
    const result = await execa("gh", ["api", `repos/${repoInfo.owner}/${repoInfo.repo}/rulesets`]);

    const summaries = JSON.parse(result.stdout) as GitHubRuleset[];

    // The list endpoint omits conditions/rules, so fetch full details
    // for candidate branch rulesets
    const candidates = summaries.filter(
      (r) => r.target === "branch" && r.enforcement === "active"
    );

    const rulesets: GitHubRuleset[] = [];
    for (const candidate of candidates) {
      try {
        rulesets.push(await fetchRulesetById(repoInfo, candidate.id));
      } catch {
        // If we can't fetch details, use the summary (may lack conditions/rules)
        rulesets.push(candidate);
      }
    }

    return parseBranchRuleset(rulesets, branch);
  } catch (error) {
    return handleBranchFetchError(error, branch);
  }
}

/** Handle errors from fetching branch protection */
function handleBranchFetchError(error: unknown, branch: string): BranchProtectionSettings {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // 404 means no rulesets exist - return empty settings
  if (errorMessage.includes("404")) {
    return createEmptySettings(branch);
  }

  if (errorMessage.includes("403") || errorMessage.includes("Must have admin rights")) {
    throw new FetcherError(
      "Cannot read branch protection: insufficient permissions (requires admin access)",
      "NO_PERMISSION"
    );
  }

  throw new FetcherError(`Failed to fetch branch protection: ${errorMessage}`, "API_ERROR");
}

/** Find and parse the branch protection ruleset */
 
function parseBranchRuleset(rulesets: GitHubRuleset[], branch: string): BranchProtectionSettings {
  // Find ruleset targeting branches that includes the specified branch
  const branchRuleset = rulesets.find(
    (r) =>
      r.target === "branch" &&
      r.enforcement === "active" &&
      matchesBranch(r.conditions?.ref_name?.include ?? [], branch)
  );

  if (!branchRuleset) {
    return createEmptySettings(branch);
  }

  const rules = branchRuleset.rules ?? [];
  const prRule = rules.find((r) => r.type === "pull_request");
  const statusRule = rules.find((r) => r.type === "required_status_checks");
  const signaturesRule = rules.find((r) => r.type === "required_signatures");

  // Parse bypass actors
  const bypassActors = parseBypassActors(branchRuleset.bypass_actors);

  // enforceAdmins is true when there are no bypass actors
  const enforceAdmins = bypassActors === null || bypassActors.length === 0;

  return {
    branch,
    requiredReviews: prRule?.parameters?.required_approving_review_count ?? null,
    dismissStaleReviews: prRule?.parameters?.dismiss_stale_reviews_on_push ?? null,
    requireCodeOwnerReviews: prRule?.parameters?.require_code_owner_review ?? null,
    requiredStatusChecks:
      statusRule?.parameters?.required_status_checks?.map((c) => c.context) ?? null,
    requireBranchesUpToDate: statusRule?.parameters?.strict_required_status_checks_policy ?? null,
    requireSignedCommits: signaturesRule !== undefined,
    enforceAdmins,
    bypassActors,
    rulesetId: branchRuleset.id,
    rulesetName: branchRuleset.name,
  };
}

/** Check if branch matches any of the include patterns */
function matchesBranch(patterns: string[], branch: string): boolean {
  for (const pattern of patterns) {
    const cleanPattern = pattern.replace(/^refs\/heads\//, "");
    if (cleanPattern === branch) {
      return true;
    }
    if (cleanPattern === "~DEFAULT_BRANCH" && branch === "main") {
      return true;
    }
    if (cleanPattern === "~ALL") {
      return true;
    }
    // Simple wildcard matching for patterns like "release/*"
    if (cleanPattern.includes("*")) {
      const regex = new RegExp(`^${cleanPattern.replace(/\*/g, ".*")}$`);
      if (regex.test(branch)) {
        return true;
      }
    }
  }
  return false;
}

/** Parse bypass actors from GitHub API response */
function parseBypassActors(actors: GitHubRulesetBypassActor[] | undefined): BypassActor[] | null {
  if (!actors || actors.length === 0) {
    return null;
  }

  return actors.map((actor) => ({
    actor_type: actor.actor_type,
    actor_id: actor.actor_id ?? undefined,
    bypass_mode: actor.bypass_mode,
  }));
}

/** Create empty settings for unprotected branch */
function createEmptySettings(branch: string): BranchProtectionSettings {
  return {
    branch,
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
  };
}

// =============================================================================
// Tag Protection (GitHub Rulesets API)
// =============================================================================

/** Fetch current tag protection rulesets from GitHub */
export async function fetchTagProtection(repoInfo: RepoInfo): Promise<TagProtectionSettings> {
  try {
    const result = await execa("gh", ["api", `repos/${repoInfo.owner}/${repoInfo.repo}/rulesets`]);

    const summaries = JSON.parse(result.stdout) as GitHubRuleset[];

    // The list endpoint omits conditions/rules, so fetch full details
    // for candidate tag rulesets
    const candidates = summaries.filter(
      (r) => r.target === "tag" && r.name === "Tag Protection"
    );

    const rulesets: GitHubRuleset[] = [];
    for (const candidate of candidates) {
      try {
        rulesets.push(await fetchRulesetById(repoInfo, candidate.id));
      } catch {
        rulesets.push(candidate);
      }
    }

    return parseTagRuleset(rulesets);
  } catch (error) {
    return handleTagFetchError(error);
  }
}

/** Find and parse the tag protection ruleset */
function parseTagRuleset(rulesets: GitHubRuleset[]): TagProtectionSettings {
  // Find existing tag protection ruleset (by target type and name)
  const tagRuleset = rulesets.find((r) => r.target === "tag" && r.name === "Tag Protection");

  if (!tagRuleset) {
    return createEmptyTagSettings();
  }

  const patterns =
    tagRuleset.conditions?.ref_name?.include?.map((p) => p.replace(/^refs\/tags\//, "")) ?? [];

  const rules = tagRuleset.rules ?? [];
  const preventDeletion = rules.some((r) => r.type === "deletion");
  const preventUpdate = rules.some((r) => r.type === "update");

  return {
    patterns,
    preventDeletion,
    preventUpdate,
    rulesetId: tagRuleset.id,
    rulesetName: tagRuleset.name,
  };
}

/** Create empty settings when no tag ruleset exists */
function createEmptyTagSettings(): TagProtectionSettings {
  return {
    patterns: [],
    preventDeletion: false,
    preventUpdate: false,
    rulesetId: null,
    rulesetName: null,
  };
}

/** Handle errors from fetching tag protection */
function handleTagFetchError(error: unknown): TagProtectionSettings {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // 404 means no rulesets exist - return empty settings
  if (errorMessage.includes("404")) {
    return createEmptyTagSettings();
  }

  if (errorMessage.includes("403") || errorMessage.includes("Must have admin rights")) {
    throw new FetcherError(
      "Cannot read tag protection: insufficient permissions (requires admin access)",
      "NO_PERMISSION"
    );
  }

  throw new FetcherError(`Failed to fetch tag protection: ${errorMessage}`, "API_ERROR");
}
