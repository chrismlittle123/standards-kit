import {
  type BranchProtectionSettings,
  type BypassActor,
  type DesiredBranchProtection,
  type DesiredTagProtection,
  type RepoInfo,
  type SettingDiff,
  type SyncDiffResult,
  type TagProtectionDiffResult,
  type TagProtectionSettings,
} from "./types.js";

/** Field mapping for comparison */
interface FieldMapping {
  name: string;
  getCurrentValue: (c: BranchProtectionSettings) => unknown;
  getDesiredValue: (d: DesiredBranchProtection) => unknown;
  isArray?: boolean;
}

/** All field mappings for branch protection settings */
const fieldMappings: FieldMapping[] = [
  {
    name: "required_reviews",
    getCurrentValue: (c) => c.requiredReviews,
    getDesiredValue: (d) => d.required_reviews,
  },
  {
    name: "dismiss_stale_reviews",
    getCurrentValue: (c) => c.dismissStaleReviews,
    getDesiredValue: (d) => d.dismiss_stale_reviews,
  },
  {
    name: "require_code_owner_reviews",
    getCurrentValue: (c) => c.requireCodeOwnerReviews,
    getDesiredValue: (d) => d.require_code_owner_reviews,
  },
  {
    name: "require_status_checks",
    getCurrentValue: (c) => c.requiredStatusChecks,
    getDesiredValue: (d) => d.require_status_checks,
    isArray: true,
  },
  {
    name: "require_branches_up_to_date",
    getCurrentValue: (c) => c.requireBranchesUpToDate,
    getDesiredValue: (d) => d.require_branches_up_to_date,
  },
  {
    name: "require_signed_commits",
    getCurrentValue: (c) => c.requireSignedCommits,
    getDesiredValue: (d) => d.require_signed_commits,
  },
  {
    name: "enforce_admins",
    getCurrentValue: (c) => c.enforceAdmins,
    getDesiredValue: (d) => d.enforce_admins,
  },
];

/** Compare current settings with desired and generate diffs */
export function computeDiff(
  repoInfo: RepoInfo,
  current: BranchProtectionSettings,
  desired: DesiredBranchProtection
): SyncDiffResult {
  const diffs = collectDiffs(current, desired);

  // Add bypass_actors diff
  const bypassDiff = compareBypassActors(
    current.bypassActors,
    desired.bypass_actors,
    current.rulesetId
  );
  if (bypassDiff) {
    diffs.push(bypassDiff);
  }

  return {
    repoInfo,
    branch: current.branch,
    diffs,
    hasChanges: diffs.length > 0,
    currentRulesetId: current.rulesetId,
  };
}

/** Collect all diffs between current and desired settings */
function collectDiffs(
  current: BranchProtectionSettings,
  desired: DesiredBranchProtection
): SettingDiff[] {
  const diffs: SettingDiff[] = [];

  for (const mapping of fieldMappings) {
    const desiredValue = mapping.getDesiredValue(desired);
    if (desiredValue === undefined) {
      continue;
    }

    const currentValue = mapping.getCurrentValue(current);
    const diff = mapping.isArray
      ? compareArrayValue(mapping.name, currentValue as string[] | null, desiredValue as string[])
      : compareValue(mapping.name, currentValue, desiredValue);

    if (diff) {
      diffs.push(diff);
    }
  }

  return diffs;
}

/** Compare a single value and return diff if different */
function compareValue(setting: string, current: unknown, desired: unknown): SettingDiff | null {
  const currentValue = current ?? null;
  if (currentValue === desired) {
    return null;
  }

  return {
    setting,
    current: currentValue,
    desired,
    action: currentValue === null ? "add" : "change",
  };
}

/** Compare arrays and return diff if different */
function compareArrayValue(
  setting: string,
  current: string[] | null,
  desired: string[]
): SettingDiff | null {
  const currentArray = current ?? [];
  const sortedCurrent = [...currentArray].sort();
  const sortedDesired = [...desired].sort();

  const areEqual =
    sortedCurrent.length === sortedDesired.length &&
    sortedCurrent.every((v, i) => v === sortedDesired[i]);

  if (areEqual) {
    return null;
  }

  return {
    setting,
    current: currentArray,
    desired,
    action: currentArray.length === 0 ? "add" : "change",
  };
}

/** Compare bypass actors arrays */
function compareBypassActors(
  current: BypassActor[] | null,
  desired: BypassActor[] | undefined,
  rulesetId: number | null
): SettingDiff | null {
  if (desired === undefined) {
    return null;
  }

  const currentActors = current ?? [];

  // Normalize and sort for comparison
  const sortKey = (a: BypassActor): string =>
    `${a.actor_type}:${a.actor_id ?? ""}:${a.bypass_mode ?? "always"}`;

  const sortedCurrent = [...currentActors].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const sortedDesired = [...desired].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  // Normalize bypass_mode defaults for comparison
  const normalize = (actors: BypassActor[]): BypassActor[] =>
    actors.map((a) => ({
      actor_type: a.actor_type,
      actor_id: a.actor_id,
      bypass_mode: a.bypass_mode ?? "always",
    }));

  const normalizedCurrent = normalize(sortedCurrent);
  const normalizedDesired = normalize(sortedDesired);

  const areEqual =
    normalizedCurrent.length === normalizedDesired.length &&
    normalizedCurrent.every(
      (c, i) =>
        c.actor_type === normalizedDesired[i].actor_type &&
        c.actor_id === normalizedDesired[i].actor_id &&
        c.bypass_mode === normalizedDesired[i].bypass_mode
    );

  if (areEqual) {
    return null;
  }

  return {
    setting: "bypass_actors",
    current: currentActors,
    desired,
    action: rulesetId === null ? "add" : "change",
  };
}

/** Format a value for display */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "not set";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[${value.join(", ")}]`;
  }
  return String(value);
}

// =============================================================================
// Tag Protection Diff
// =============================================================================

/** Compare current tag protection with desired and generate diffs */
export function computeTagDiff(
  repoInfo: RepoInfo,
  current: TagProtectionSettings,
  desired: DesiredTagProtection
): TagProtectionDiffResult {
  const diffs: SettingDiff[] = [];
  const rulesetId = current.rulesetId;

  collectPatternDiff(diffs, current, desired);
  collectBooleanDiff(diffs, {
    s: "prevent_deletion",
    c: current.preventDeletion,
    d: desired.prevent_deletion,
    r: rulesetId,
  });
  collectBooleanDiff(diffs, {
    s: "prevent_update",
    c: current.preventUpdate,
    d: desired.prevent_update,
    r: rulesetId,
  });

  return { repoInfo, diffs, hasChanges: diffs.length > 0, currentRulesetId: rulesetId };
}

/** Collect pattern diff if patterns don't match */
function collectPatternDiff(
  diffs: SettingDiff[],
  current: TagProtectionSettings,
  desired: DesiredTagProtection
): void {
  if (desired.patterns === undefined) {
    return;
  }
  const curr = [...current.patterns].sort();
  const des = [...desired.patterns].sort();
  const match = curr.length === des.length && curr.every((v, i) => v === des[i]);
  if (!match) {
    diffs.push({
      setting: "patterns",
      current: current.patterns,
      desired: desired.patterns,
      action: curr.length === 0 ? "add" : "change",
    });
  }
}

/** Collect boolean setting diff (s=setting, c=current, d=desired, r=rulesetId) */
function collectBooleanDiff(
  diffs: SettingDiff[],
  o: { s: string; c: boolean; d: boolean | undefined; r: number | null }
): void {
  if (o.d !== undefined && o.c !== o.d) {
    diffs.push({
      setting: o.s,
      current: o.c,
      desired: o.d,
      action: o.r === null ? "add" : "change",
    });
  }
}
