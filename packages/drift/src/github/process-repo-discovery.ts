/**
 * Process repository discovery utilities.
 * Discovers repositories in an organization that are configured for process scanning.
 */

import { CONCURRENCY, DEFAULTS } from "../constants.js";
import { listRepos, type GitHubRepo } from "./client.js";
import { hasRemoteCheckToml, hasRecentCommits } from "./repo-checks.js";

export interface ProcessRepoDiscoveryResult {
  repos: GitHubRepo[];
  totalRepos: number;
  reposWithCheckToml: number;
  isOrg: boolean;
  filteredByActivity: boolean;
  activityWindowHours?: number;
}

export interface DiscoverProcessReposOptions {
  org: string;
  token?: string;
  concurrency?: number;
  onProgress?: (checked: number, total: number) => void;
  onActivityProgress?: (checked: number, total: number) => void;
  sinceHours?: number;
  includeAll?: boolean;
}

interface FilterContext {
  token?: string;
  concurrency: number;
}

interface ResultOpts {
  base: { isOrg: boolean; totalRepos: number };
  repos: GitHubRepo[];
  checkTomlCount: number;
  filtered: boolean;
  hours?: number;
}

async function parallelFilter<T>(
  items: T[],
  predicate: (item: T) => Promise<boolean>,
  concurrency: number
): Promise<T[]> {
  const results: boolean[] = [];
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await predicate(items[i]);
    }
  }
  await Promise.all(
    Array(Math.min(concurrency, items.length))
      .fill(null)
      .map(() => worker())
  );
  return items.filter((_, i) => results[i]);
}

async function filterByCheckToml(
  repos: GitHubRepo[],
  ctx: FilterContext,
  onProgress?: (n: number, total: number) => void
): Promise<GitHubRepo[]> {
  let n = 0;
  return parallelFilter(
    repos,
    async (r) => {
      const [o, name] = r.full_name.split("/");
      const has = await hasRemoteCheckToml(o, name, ctx.token);
      onProgress?.(++n, repos.length);
      return has;
    },
    ctx.concurrency
  );
}

async function filterByActivity(
  repos: GitHubRepo[],
  ctx: FilterContext,
  hours: number,
  onProgress?: (n: number, total: number) => void
): Promise<GitHubRepo[]> {
  let n = 0;
  return parallelFilter(
    repos,
    async (r) => {
      const [o, name] = r.full_name.split("/");
      const has = await hasRecentCommits(o, name, hours, ctx.token);
      onProgress?.(++n, repos.length);
      return has;
    },
    ctx.concurrency
  );
}

function buildResult(o: ResultOpts): ProcessRepoDiscoveryResult {
  return {
    ...o.base,
    repos: o.repos,
    reposWithCheckToml: o.checkTomlCount,
    filteredByActivity: o.filtered,
    activityWindowHours: o.hours,
  };
}

/** Discover repositories with standards.toml, optionally filtering by recent activity. */
// eslint-disable-next-line max-lines-per-function
export async function discoverProcessRepos(
  opts: DiscoverProcessReposOptions
): Promise<ProcessRepoDiscoveryResult> {
  const {
    org,
    token,
    concurrency = CONCURRENCY.maxRepoScans,
    onProgress,
    onActivityProgress,
    sinceHours = DEFAULTS.commitWindowHours,
    includeAll = false,
  } = opts;
  const { repos: all, isOrg } = await listRepos(org, token);
  const ctx: FilterContext = { token, concurrency };
  const base = { isOrg, totalRepos: all.length };

  if (all.length === 0) {
    return buildResult({
      base,
      repos: [],
      checkTomlCount: 0,
      filtered: !includeAll,
      hours: includeAll ? undefined : sinceHours,
    });
  }

  const withConfig = await filterByCheckToml(all, ctx, onProgress);

  if (includeAll) {
    return buildResult({
      base,
      repos: withConfig,
      checkTomlCount: withConfig.length,
      filtered: false,
    });
  }
  if (withConfig.length === 0) {
    return buildResult({
      base,
      repos: [],
      checkTomlCount: 0,
      filtered: true,
      hours: sinceHours,
    });
  }

  const active = await filterByActivity(
    withConfig,
    ctx,
    sinceHours,
    onActivityProgress
  );
  return buildResult({
    base,
    repos: active,
    checkTomlCount: withConfig.length,
    filtered: true,
    hours: sinceHours,
  });
}
