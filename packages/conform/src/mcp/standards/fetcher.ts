/**
 * Fetches the standards repository from GitHub or local filesystem
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { execa } from "execa";

const DEFAULT_OWNER = "palindrom-ai";
const DEFAULT_REPO = "standards";
const CACHE_DIR = path.join(os.tmpdir(), "cm-standards-cache");

/** Parsed GitHub source */
interface GitHubSource {
  type: "github";
  owner: string;
  repo: string;
  ref?: string;
}

/** Parsed local source */
interface LocalSource {
  type: "local";
  path: string;
}

/** Parsed source type */
type ParsedSource = GitHubSource | LocalSource;

/** Parse github:owner/repo[@ref] format */
function parseGitHubSource(source: string): GitHubSource {
  const remainder = source.slice(7); // Remove "github:"
  const atIndex = remainder.indexOf("@");
  const ownerRepo = atIndex !== -1 ? remainder.slice(0, atIndex) : remainder;
  const ref = atIndex !== -1 ? remainder.slice(atIndex + 1) : undefined;
  const slashIndex = ownerRepo.indexOf("/");

  if (slashIndex === -1) {
    throw new StandardsError(`Invalid GitHub source format: ${source}. Expected github:owner/repo`);
  }

  const owner = ownerRepo.slice(0, slashIndex);
  const repo = ownerRepo.slice(slashIndex + 1);

  if (!owner || !repo) {
    throw new StandardsError(`Invalid GitHub source format: ${source}. Expected github:owner/repo`);
  }

  return { type: "github", owner, repo, ref };
}

/**
 * Parse a source string into owner/repo/ref or local path.
 * Formats:
 * - "github:owner/repo" - GitHub repository
 * - "github:owner/repo@ref" - GitHub with branch/tag
 * - Local filesystem path (absolute or relative)
 */
function parseSource(source: string): ParsedSource {
  if (source.startsWith("github:")) {
    return parseGitHubSource(source);
  }
  return { type: "local", path: source };
}

/** Error class for standards fetching failures */
export class StandardsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StandardsError";
  }
}

/** Authentication method for GitHub */
type AuthMethod = "token" | "ssh" | "none";

/**
 * Detect authentication method based on environment variables.
 * Priority: CM_REGISTRY_TOKEN > GITHUB_TOKEN > SSH key detection > none
 */
function detectAuthMethod(): AuthMethod {
  if (process.env.CM_REGISTRY_TOKEN || process.env.GITHUB_TOKEN) {
    return "token";
  }
  if (process.env.SSH_AUTH_SOCK) {
    return "ssh";
  }
  return "none";
}

/**
 * Get the authentication token from environment variables.
 */
function getAuthToken(): string | undefined {
  return process.env.CM_REGISTRY_TOKEN ?? process.env.GITHUB_TOKEN;
}

/**
 * Build the git URL for a repository based on auth method.
 */
function buildGitHubUrl(auth: AuthMethod, owner: string, repo: string): string {
  switch (auth) {
    case "ssh":
      return `git@github.com:${owner}/${repo}.git`;
    case "token": {
      const token = getAuthToken();
      if (token) {
        return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
      }
      return `https://github.com/${owner}/${repo}.git`;
    }
    case "none":
    default:
      return `https://github.com/${owner}/${repo}.git`;
  }
}

/**
 * Update an existing cloned repository.
 */
async function updateExistingRepo(repoDir: string): Promise<boolean> {
  try {
    await execa("git", ["pull", "--ff-only"], { cwd: repoDir, timeout: 30_000 });
    return true;
  } catch {
    // If update fails, remove the directory so it will be re-cloned
    fs.rmSync(repoDir, { recursive: true, force: true });
    return false;
  }
}

/**
 * Clone a repository from GitHub.
 */
async function cloneRepo(repoDir: string, owner: string, repo: string, ref?: string): Promise<void> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const auth = detectAuthMethod();
  const url = buildGitHubUrl(auth, owner, repo);

  try {
    const args = ["clone", "--depth", "1"];
    if (ref) {
      args.push("--branch", ref);
    }
    args.push(url, repoDir);

    await execa("git", args, {
      timeout: 30_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("timed out")) {
      throw new StandardsError(`Standards repo clone timed out after 30 seconds`);
    }
    throw new StandardsError(`Failed to clone standards repo: ${message}`);
  }
}

/**
 * Fetch a GitHub repository, caching it locally.
 * Returns the path to the cached repository.
 */
async function fetchGitHubRepo(owner: string, repo: string, ref?: string): Promise<string> {
  const cacheKey = ref ? `${owner}-${repo}-${ref}` : `${owner}-${repo}`;
  const repoDir = path.join(CACHE_DIR, cacheKey);

  // If repo exists, try to update it
  if (fs.existsSync(repoDir)) {
    await updateExistingRepo(repoDir);
  }

  // Clone if it doesn't exist (either first time or after failed update)
  if (!fs.existsSync(repoDir)) {
    await cloneRepo(repoDir, owner, repo, ref);
  }

  return repoDir;
}

/**
 * Resolve a local source path to an absolute path.
 */
function resolveLocalPath(localPath: string, basePath?: string): string {
  if (path.isAbsolute(localPath)) {
    return localPath;
  }
  const base = basePath ?? process.cwd();
  return path.resolve(base, localPath);
}

/**
 * Fetch the standards repository from a source string.
 * Supports:
 * - "github:owner/repo" - GitHub repository
 * - "github:owner/repo@ref" - GitHub with branch/tag
 * - Local filesystem path (absolute or relative)
 *
 * @param source - Source string to fetch from
 * @param basePath - Base path for resolving relative local paths (defaults to cwd)
 * @returns Path to the standards repository
 */
export async function fetchStandardsRepoFromSource(
  source: string,
  basePath?: string
): Promise<string> {
  const parsed = parseSource(source);

  if (parsed.type === "local") {
    const resolvedPath = resolveLocalPath(parsed.path, basePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new StandardsError(`Local standards path does not exist: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  return fetchGitHubRepo(parsed.owner, parsed.repo, parsed.ref);
}

/**
 * Fetch the default standards repository, caching it locally.
 * Returns the path to the cached repository.
 */
export async function fetchStandardsRepo(): Promise<string> {
  return fetchGitHubRepo(DEFAULT_OWNER, DEFAULT_REPO);
}

/**
 * Get the path to the guidelines directory.
 */
export function getGuidelinesDir(repoPath: string): string {
  return path.join(repoPath, "guidelines");
}

/**
 * Get the path to the rulesets directory.
 */
export function getRulesetsDir(repoPath: string): string {
  return path.join(repoPath, "rulesets");
}
