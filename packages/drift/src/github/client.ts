import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { z } from "zod";
import { TIMEOUTS, GITHUB_API } from "../constants.js";
import { extractExecError } from "../utils/index.js";
import { fetchWithRetry, sanitizeError } from "./api-utils.js";

export interface GitHubRepo {
  name: string;
  full_name: string;
  clone_url: string;
  archived: boolean;
  disabled: boolean;
}

const GITHUB_REPO_SCHEMA = z.object({
  name: z.string(),
  full_name: z.string(),
  clone_url: z.string(),
  archived: z.boolean(),
  disabled: z.boolean(),
});

const GITHUB_REPO_ARRAY_SCHEMA = z.array(GITHUB_REPO_SCHEMA);

const GITHUB_ISSUE_SCHEMA = z.object({
  number: z.number(),
  html_url: z.string(),
});

/** Get GitHub token from CLI option or GITHUB_TOKEN environment variable. */
export function getGitHubToken(cliOption?: string): string | undefined {
  return cliOption || process.env.GITHUB_TOKEN;
}

/** List all repositories in a GitHub organization. */
export function listOrgRepos(
  org: string,
  token?: string
): Promise<GitHubRepo[]> {
  return listReposFromEndpoint(`/orgs/${org}/repos`, token);
}

/** List all repositories for a GitHub user. */
export function listUserRepos(
  username: string,
  token?: string
): Promise<GitHubRepo[]> {
  return listReposFromEndpoint(`/users/${username}/repos`, token);
}

/** List repositories with auto-detection of org vs user account. */
export async function listRepos(
  name: string,
  token?: string
): Promise<{ repos: GitHubRepo[]; isOrg: boolean }> {
  try {
    const repos = await listOrgRepos(name, token);
    return { repos, isOrg: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("404")) {
      const repos = await listUserRepos(name, token);
      return { repos, isOrg: false };
    }
    throw error;
  }
}

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

async function parseRepoResponse(
  response: Response,
  token?: string
): Promise<GitHubRepo[]> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub API error: ${response.status} ${sanitizeError(text, token)}`
    );
  }
  let rawData: unknown;
  try {
    rawData = await response.json();
  } catch (parseError) {
    const msg =
      parseError instanceof Error ? parseError.message : "Unknown error";
    throw new Error(`Failed to parse GitHub API response: ${msg}`);
  }
  const parseResult = GITHUB_REPO_ARRAY_SCHEMA.safeParse(rawData);
  if (!parseResult.success) {
    throw new Error(
      `Invalid GitHub API response: ${parseResult.error.message}`
    );
  }
  return parseResult.data;
}

async function listReposFromEndpoint(
  endpoint: string,
  token?: string
): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  const headers = buildApiHeaders(token);
  let page = 1;
  while (true) {
    const url = `${GITHUB_API.baseUrl}${endpoint}?per_page=${GITHUB_API.perPage}&page=${page}&type=all`;
    const response = await fetchWithRetry(url, { headers }, token);
    const pageRepos = await parseRepoResponse(response, token);
    if (pageRepos.length === 0) {
      break;
    }
    repos.push(...pageRepos.filter((r) => !r.archived && !r.disabled));
    if (pageRepos.length < GITHUB_API.perPage) {
      break;
    }
    page++;
  }
  return repos;
}

/** Create GIT_ASKPASS helper for secure token authentication (keeps token out of ps). */
function createAskPassScript(token: string): {
  scriptPath: string;
  cleanup: () => void;
} {
  const scriptDir = mkdtempSync(join(tmpdir(), "drift-askpass-"));
  const scriptPath = join(scriptDir, "askpass.sh");
  writeFileSync(
    scriptPath,
    `#!/bin/sh\necho "${token.replace(/"/g, '\\"')}"\n`,
    { mode: 0o700 }
  );
  chmodSync(scriptPath, 0o700);

  return {
    scriptPath,
    cleanup: () => {
      try {
        rmSync(scriptDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/** Clone a repository using shallow clone with secure token handling. */
export function cloneRepo(
  org: string,
  repo: string,
  targetDir: string,
  token?: string
): void {
  const cloneUrl = `https://github.com/${org}/${repo}.git`;
  let askPassHelper: { scriptPath: string; cleanup: () => void } | null = null;
  try {
    const env: Record<string, string> = { ...process.env } as Record<
      string,
      string
    >;
    if (token) {
      askPassHelper = createAskPassScript(token);
      env.GIT_ASKPASS = askPassHelper.scriptPath;
      env.GIT_USERNAME = "x-access-token";
      env.GIT_TERMINAL_PROMPT = "0";
    }
    execFileSync(
      "git",
      ["clone", "--depth", "2", "--quiet", cloneUrl, targetDir],
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: TIMEOUTS.gitClone,
        env,
      }
    );
  } catch (error) {
    const execError = extractExecError(error);
    const rawMsg = execError.stderr ?? execError.message ?? "Clone failed";
    throw new Error(
      `Failed to clone ${org}/${repo}: ${sanitizeError(rawMsg, token)}`
    );
  } finally {
    askPassHelper?.cleanup();
  }
}

/** Create a temporary directory for cloning repositories. */
export function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `drift-${prefix}-`));
}

/** Remove a temporary directory and its contents. */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/** Check if a repository exists and is accessible. */
export async function repoExists(
  org: string,
  repo: string,
  token?: string
): Promise<boolean> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API.version,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetchWithRetry(
      `${GITHUB_API.baseUrl}/repos/${org}/${repo}`,
      { headers },
      token
    );

    return response.ok;
  } catch {
    // Network errors or retry exhaustion - treat as not found
    return false;
  }
}

// Re-export file checking functions from repo-checks module
export { fileExists, isRepoScannable } from "./repo-checks.js";

export interface GitHubIssue {
  number: number;
  html_url: string;
}

export interface CreateIssueOptions {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels: string[];
}

/** Create a GitHub issue for drift detection. */
export async function createIssue(
  options: CreateIssueOptions,
  token: string
): Promise<GitHubIssue> {
  const { owner, repo, title, body, labels } = options;
  const headers = buildApiHeaders(token);
  headers["Content-Type"] = "application/json";

  const response = await fetchWithRetry(
    `${GITHUB_API.baseUrl}/repos/${owner}/${repo}/issues`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ title, body, labels }),
    },
    token
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create issue: ${response.status} ${sanitizeError(text, token)}`
    );
  }

  let rawData: unknown;
  try {
    rawData = await response.json();
  } catch (parseError) {
    const msg =
      parseError instanceof Error ? parseError.message : "Unknown error";
    throw new Error(`Failed to parse issue response: ${msg}`);
  }

  const parseResult = GITHUB_ISSUE_SCHEMA.safeParse(rawData);
  if (!parseResult.success) {
    throw new Error(`Invalid issue response: ${parseResult.error.message}`);
  }

  return parseResult.data;
}
