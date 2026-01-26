/** Bypass actor type for GitHub Rulesets */
export type BypassActorType =
  | "Integration"
  | "OrganizationAdmin"
  | "RepositoryRole"
  | "Team"
  | "DeployKey";

/** Bypass mode - when the actor can bypass */
export type BypassMode = "always" | "pull_request";

/** Single bypass actor configuration */
export interface BypassActor {
  actor_type: BypassActorType;
  actor_id?: number;
  bypass_mode?: BypassMode;
}

/** Current branch protection settings from GitHub Ruleset */
export interface BranchProtectionSettings {
  branch: string;
  requiredReviews: number | null;
  dismissStaleReviews: boolean | null;
  requireCodeOwnerReviews: boolean | null;
  requiredStatusChecks: string[] | null;
  requireBranchesUpToDate: boolean | null;
  requireSignedCommits: boolean | null;
  enforceAdmins: boolean | null;
  bypassActors: BypassActor[] | null;
  rulesetId: number | null;
  rulesetName: string | null;
}

/** A single setting difference */
export interface SettingDiff {
  setting: string;
  current: unknown;
  desired: unknown;
  action: "add" | "change";
}

/** Result of comparing current vs. desired settings */
export interface SyncDiffResult {
  repoInfo: { owner: string; repo: string };
  branch: string;
  diffs: SettingDiff[];
  hasChanges: boolean;
  currentRulesetId: number | null;
}

/** Result of applying sync changes */
export interface SyncResult {
  success: boolean;
  applied: SettingDiff[];
  failed: { diff: SettingDiff; error: string }[];
}

/** Options for sync/diff commands */
export interface SyncOptions {
  config?: string;
  format: "text" | "json";
  apply?: boolean;
  validateActors?: boolean;
}

/** Repository info */
export interface RepoInfo {
  owner: string;
  repo: string;
}

/** Desired branch protection settings from config */
export interface DesiredBranchProtection {
  branch?: string;
  required_reviews?: number;
  dismiss_stale_reviews?: boolean;
  require_code_owner_reviews?: boolean;
  require_status_checks?: string[];
  require_branches_up_to_date?: boolean;
  require_signed_commits?: boolean;
  enforce_admins?: boolean;
  bypass_actors?: BypassActor[];
}

// =============================================================================
// Tag Protection Types (GitHub Rulesets API)
// =============================================================================

/** GitHub Ruleset bypass actor from API */
export interface GitHubRulesetBypassActor {
  actor_id: number | null;
  actor_type: BypassActorType;
  bypass_mode: BypassMode;
}

/** GitHub Ruleset rule types */
export type GitHubRulesetRuleType =
  | "deletion"
  | "update"
  | "creation"
  | "pull_request"
  | "required_status_checks"
  | "required_signatures"
  | string;

/** GitHub Ruleset response */
export interface GitHubRuleset {
  id: number;
  name: string;
  target: "branch" | "tag";
  enforcement: "active" | "evaluate" | "disabled";
  conditions?: {
    ref_name?: {
      include?: string[];
      exclude?: string[];
    };
  };
  bypass_actors?: GitHubRulesetBypassActor[];
  rules?: {
    type: GitHubRulesetRuleType;
    parameters?: {
      // pull_request rule parameters
      required_approving_review_count?: number;
      dismiss_stale_reviews_on_push?: boolean;
      require_code_owner_review?: boolean;
      // required_status_checks rule parameters
      required_status_checks?: { context: string }[];
      strict_required_status_checks_policy?: boolean;
      // generic fallback
      [key: string]: unknown;
    };
  }[];
}

/** Current tag protection settings from GitHub */
export interface TagProtectionSettings {
  patterns: string[];
  preventDeletion: boolean;
  preventUpdate: boolean;
  rulesetId: number | null;
  rulesetName: string | null;
}

/** Desired tag protection settings from config */
export interface DesiredTagProtection {
  patterns?: string[];
  prevent_deletion?: boolean;
  prevent_update?: boolean;
}

/** Tag protection diff result */
export interface TagProtectionDiffResult {
  repoInfo: RepoInfo;
  diffs: SettingDiff[];
  hasChanges: boolean;
  currentRulesetId: number | null;
}
