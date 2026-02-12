import { execa } from "execa";

import {
  type DesiredBranchProtection,
  type DesiredTagProtection,
  type RepoInfo,
  type SettingDiff,
  type SyncDiffResult,
  type SyncResult,
  type TagProtectionDiffResult,
} from "./types.js";

/** Error thrown when applier encounters an issue */
export class ApplierError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_PERMISSION" | "API_ERROR"
  ) {
    super(message);
    this.name = "ApplierError";
  }
}

/** Apply branch protection ruleset to GitHub */
export async function applyBranchProtection(
  repoInfo: RepoInfo,
  branch: string,
  desired: DesiredBranchProtection,
  diffResult: SyncDiffResult
): Promise<SyncResult> {
  if (!diffResult.hasChanges) {
    return { success: true, applied: [], failed: [] };
  }

  const requestBody = buildBranchRulesetBody(branch, desired);

  try {
    if (diffResult.currentRulesetId === null) {
      // Create new ruleset
      await execa(
        "gh",
        ["api", `repos/${repoInfo.owner}/${repoInfo.repo}/rulesets`, "-X", "POST", "--input", "-"],
        { input: JSON.stringify(requestBody) }
      );
    } else {
      // Update existing ruleset
      await execa(
        "gh",
        [
          "api",
          `repos/${repoInfo.owner}/${repoInfo.repo}/rulesets/${diffResult.currentRulesetId}`,
          "-X",
          "PUT",
          "--input",
          "-",
        ],
        { input: JSON.stringify(requestBody) }
      );
    }

    return { success: true, applied: diffResult.diffs, failed: [] };
  } catch (error) {
    return handleBranchApplyError(error, diffResult.diffs);
  }
}

/** Handle errors from applying branch protection */
function handleBranchApplyError(error: unknown, diffs: SettingDiff[]): SyncResult {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (errorMessage.includes("403") || errorMessage.includes("Must have admin rights")) {
    throw new ApplierError(
      "Cannot update branch protection: insufficient permissions (requires admin access)",
      "NO_PERMISSION"
    );
  }

  return {
    success: false,
    applied: [],
    failed: diffs.map((diff) => ({ diff, error: errorMessage })),
  };
}

/** Build GitHub API request body for branch ruleset */
function buildBranchRulesetBody(
  branch: string,
  desired: DesiredBranchProtection
): Record<string, unknown> {
  const rules: { type: string; parameters?: Record<string, unknown> }[] = [];

  // Build pull_request rule if any review settings specified
  const pullRequestRule = buildPullRequestRule(desired);
  if (pullRequestRule) {
    rules.push(pullRequestRule);
  }

  // Build required_status_checks rule
  const statusChecksRule = buildStatusChecksRule(desired);
  if (statusChecksRule) {
    rules.push(statusChecksRule);
  }

  // Build required_signatures rule
  if (desired.require_signed_commits === true) {
    rules.push({ type: "required_signatures" });
  }

  // Build bypass actors array
  const bypassActors =
    desired.bypass_actors?.map((actor) => ({
      actor_id: actor.actor_id ?? null,
      actor_type: actor.actor_type,
      bypass_mode: actor.bypass_mode ?? "always",
    })) ?? [];

  return {
    name: "Branch Protection",
    target: "branch",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: [`refs/heads/${branch}`],
        exclude: [],
      },
    },
    bypass_actors: bypassActors,
    rules,
  };
}

/** Build pull_request rule for PR review settings */
function buildPullRequestRule(
  desired: DesiredBranchProtection
): { type: string; parameters: Record<string, unknown> } | null {
  const hasReviewSettings =
    desired.required_reviews !== undefined ||
    desired.dismiss_stale_reviews !== undefined ||
    desired.require_code_owner_reviews !== undefined;

  if (!hasReviewSettings) {
    return null;
  }

  return {
    type: "pull_request",
    parameters: {
      required_approving_review_count: desired.required_reviews ?? 0,
      dismiss_stale_reviews_on_push: desired.dismiss_stale_reviews ?? false,
      require_code_owner_review: desired.require_code_owner_reviews ?? false,
      require_last_push_approval: false,
      required_review_thread_resolution: false,
    },
  };
}

/** Build required_status_checks rule for status check settings */
function buildStatusChecksRule(
  desired: DesiredBranchProtection
): { type: string; parameters: Record<string, unknown> } | null {
  const hasStatusSettings =
    desired.require_status_checks !== undefined ||
    desired.require_branches_up_to_date !== undefined;

  if (!hasStatusSettings) {
    return null;
  }

  const statusChecks =
    desired.require_status_checks?.map((context) => ({
      context,
    })) ?? [];

  return {
    type: "required_status_checks",
    parameters: {
      required_status_checks: statusChecks,
      strict_required_status_checks_policy: desired.require_branches_up_to_date ?? false,
    },
  };
}

// =============================================================================
// Tag Protection (GitHub Rulesets API)
// =============================================================================

/** Apply tag protection ruleset to GitHub */
export async function applyTagProtection(
  repoInfo: RepoInfo,
  desired: DesiredTagProtection,
  diffResult: TagProtectionDiffResult
): Promise<SyncResult> {
  if (!diffResult.hasChanges) {
    return { success: true, applied: [], failed: [] };
  }

  const requestBody = buildTagRulesetBody(desired);

  try {
    if (diffResult.currentRulesetId === null) {
      // Create new ruleset
      await execa(
        "gh",
        ["api", `repos/${repoInfo.owner}/${repoInfo.repo}/rulesets`, "-X", "POST", "--input", "-"],
        { input: JSON.stringify(requestBody) }
      );
    } else {
      // Update existing ruleset
      await execa(
        "gh",
        [
          "api",
          `repos/${repoInfo.owner}/${repoInfo.repo}/rulesets/${diffResult.currentRulesetId}`,
          "-X",
          "PUT",
          "--input",
          "-",
        ],
        { input: JSON.stringify(requestBody) }
      );
    }

    return { success: true, applied: diffResult.diffs, failed: [] };
  } catch (error) {
    return handleTagApplyError(error, diffResult.diffs);
  }
}

/** Build GitHub API request body for tag ruleset */
function buildTagRulesetBody(desired: DesiredTagProtection): Record<string, unknown> {
  const rules: { type: string }[] = [];

  // Default to true if not specified
  if (desired.prevent_deletion !== false) {
    rules.push({ type: "deletion" });
  }
  if (desired.prevent_update !== false) {
    rules.push({ type: "update" });
  }

  const patterns = desired.patterns ?? ["v*"];
  const includePatterns = patterns.map((p) => `refs/tags/${p}`);

  return {
    name: "Tag Protection",
    target: "tag",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: includePatterns,
        exclude: [],
      },
    },
    rules,
  };
}

/** Handle errors from applying tag protection */
function handleTagApplyError(error: unknown, diffs: SettingDiff[]): SyncResult {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (errorMessage.includes("403") || errorMessage.includes("Must have admin rights")) {
    throw new ApplierError(
      "Cannot update tag protection: insufficient permissions (requires admin access)",
      "NO_PERMISSION"
    );
  }

  return {
    success: false,
    applied: [],
    failed: diffs.map((diff) => ({ diff, error: errorMessage })),
  };
}
