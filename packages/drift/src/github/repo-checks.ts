/**
 * Repository file checking utilities for pre-clone validation.
 * Uses GitHub Content API to verify file existence without cloning.
 */

import { parse as parseToml } from "smol-toml";
import { GITHUB_API, FILE_PATTERNS } from "../constants.js";
import { fetchWithRetry } from "./api-utils.js";

/** Build GitHub API request headers */
function buildApiHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API.version,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/** Check if a file exists in a repository via GitHub Content API. */
export async function fileExists(
  org: string,
  repo: string,
  path: string,
  token?: string
): Promise<boolean> {
  const headers = buildApiHeaders(token);

  try {
    const response = await fetchWithRetry(
      `${GITHUB_API.baseUrl}/repos/${org}/${repo}/contents/${path}`,
      { headers },
      token
    );
    return response.ok;
  } catch {
    // Network errors or retry exhaustion - treat as not found
    return false;
  }
}

/**
 * Check if a repository has a [metadata] section in its standards.toml.
 * Uses GitHub API to fetch and parse the file.
 */
export async function hasRemoteMetadataConfig(
  org: string,
  repo: string,
  token?: string
): Promise<boolean> {
  const headers = buildApiHeaders(token);
  headers.Accept = "application/vnd.github.raw+json";

  try {
    const response = await fetchWithRetry(
      `${GITHUB_API.baseUrl}/repos/${org}/${repo}/contents/${FILE_PATTERNS.checkToml}`,
      { headers },
      token
    );

    if (!response.ok) {
      return false;
    }

    const content = await response.text();
    const config = parseToml(content) as Record<string, unknown>;
    const metadataConfig = config.metadata as Record<string, unknown> | undefined;

    // Check if [metadata] section exists with a tier
    return metadataConfig?.tier !== undefined;
  } catch {
    return false;
  }
}

/**
 * Check if a repository is scannable (has required metadata).
 * A repo is scannable if it has standards.toml with [metadata] section.
 */
export async function isRepoScannable(
  org: string,
  repo: string,
  token?: string
): Promise<boolean> {
  // Check if standards.toml exists and has [metadata] section
  return hasRemoteMetadataConfig(org, repo, token);
}

/**
 * Check if a repository has a standards.toml file at the root.
 * Used for discovering repos that are configured for process scanning.
 *
 * @param org - GitHub organization or user
 * @param repo - Repository name
 * @param token - GitHub token (optional)
 * @returns true if standards.toml exists at the repository root
 */
export async function hasRemoteCheckToml(
  org: string,
  repo: string,
  token?: string
): Promise<boolean> {
  return fileExists(org, repo, FILE_PATTERNS.checkToml, token);
}

/**
 * Check if a repository has commits within the specified time window.
 * Checks the default branch (main, then falls back to master).
 *
 * @param org - GitHub organization or user
 * @param repo - Repository name
 * @param hours - Number of hours to look back
 * @param token - GitHub token (optional)
 * @returns true if commits exist within the time window
 */
export async function hasRecentCommits(
  org: string,
  repo: string,
  hours: number,
  token?: string
): Promise<boolean> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const headers = buildApiHeaders(token);

  // Try main branch first
  const mainUrl = `${GITHUB_API.baseUrl}/repos/${org}/${repo}/commits?sha=main&since=${since}&per_page=1`;
  const mainResponse = await fetchWithRetry(mainUrl, { headers }, token);

  if (mainResponse.ok) {
    const commits = (await mainResponse.json()) as unknown[];
    return commits.length > 0;
  }

  // Fall back to master branch if main doesn't exist (404)
  if (mainResponse.status === 404) {
    const masterUrl = `${GITHUB_API.baseUrl}/repos/${org}/${repo}/commits?sha=master&since=${since}&per_page=1`;
    const masterResponse = await fetchWithRetry(masterUrl, { headers }, token);

    if (masterResponse.ok) {
      const commits = (await masterResponse.json()) as unknown[];
      return commits.length > 0;
    }
  }

  // If both fail, assume no recent commits (or repo has no commits)
  return false;
}

/**
 * Check if a repository has an [infra] section enabled in standards.toml.
 * Fetches the standards.toml file and parses it to check for infra configuration.
 *
 * @param org - GitHub organization or user
 * @param repo - Repository name
 * @param token - GitHub token (optional)
 * @returns true if standards.toml exists and has [infra] section with enabled = true
 */
export async function hasRemoteInfraConfig(
  org: string,
  repo: string,
  token?: string
): Promise<boolean> {
  const headers = buildApiHeaders(token);
  // Request raw content
  headers.Accept = "application/vnd.github.raw+json";

  try {
    const response = await fetchWithRetry(
      `${GITHUB_API.baseUrl}/repos/${org}/${repo}/contents/${FILE_PATTERNS.checkToml}`,
      { headers },
      token
    );

    if (!response.ok) {
      return false;
    }

    const content = await response.text();

    // Parse TOML and check for [infra] section with enabled = true
    const config = parseToml(content) as Record<string, unknown>;
    const infraConfig = config.infra as Record<string, unknown> | undefined;

    return infraConfig?.enabled === true;
  } catch {
    // Parse errors or network errors - treat as not configured
    return false;
  }
}
