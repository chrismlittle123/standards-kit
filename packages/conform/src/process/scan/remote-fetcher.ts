import { execa } from "execa";

import { type FileCheckConfig, type FileCheckResult, type RemoteRepoInfo } from "./types.js";

/** Error thrown when remote fetcher encounters an issue */
export class RemoteFetcherError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_GH" | "NO_REPO" | "NO_PERMISSION" | "API_ERROR" | "INVALID_REPO"
  ) {
    super(message);
    this.name = "RemoteFetcherError";
  }
}

/** Parse owner/repo string into RemoteRepoInfo */
export function parseRepoString(repo: string): RemoteRepoInfo {
  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new RemoteFetcherError(
      `Invalid repository format: "${repo}". Expected "owner/repo" format.`,
      "INVALID_REPO"
    );
  }
  return { owner: parts[0], repo: parts[1] };
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

/** Verify the repository exists and user has access */
export async function verifyRepoAccess(repoInfo: RemoteRepoInfo): Promise<boolean> {
  try {
    await execa("gh", ["api", `repos/${repoInfo.owner}/${repoInfo.repo}`]);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("404") || errorMessage.includes("Not Found")) {
      throw new RemoteFetcherError(
        `Repository not found: ${repoInfo.owner}/${repoInfo.repo}`,
        "NO_REPO"
      );
    }

    if (errorMessage.includes("403") || errorMessage.includes("401")) {
      throw new RemoteFetcherError(
        `Cannot access repository: ${repoInfo.owner}/${repoInfo.repo}. Check your GITHUB_TOKEN permissions.`,
        "NO_PERMISSION"
      );
    }

    throw new RemoteFetcherError(
      `Failed to verify repository access: ${errorMessage}`,
      "API_ERROR"
    );
  }
}

/** Check if a file exists in the remote repository via GitHub Contents API */
async function checkRemoteFileExists(
  repoInfo: RemoteRepoInfo,
  filePath: string
): Promise<boolean> {
  try {
    await execa("gh", [
      "api",
      `repos/${repoInfo.owner}/${repoInfo.repo}/contents/${filePath}`,
      "--silent",
    ]);
    return true;
  } catch {
    // File doesn't exist or no access - both return false
    return false;
  }
}

/** Check multiple alternative paths for a file */
async function checkRemoteFileWithAlternatives(
  repoInfo: RemoteRepoInfo,
  config: FileCheckConfig
): Promise<FileCheckResult> {
  const allPaths = [config.path, ...(config.alternativePaths ?? [])];

  for (const path of allPaths) {
    // Sequential check needed - stop on first match
    const exists = await checkRemoteFileExists(repoInfo, path);
    if (exists) {
      return { path: config.path, exists: true, checkedPaths: allPaths };
    }
  }

  return { path: config.path, exists: false, checkedPaths: allPaths };
}

/** Batch check multiple files in a repository */
export async function checkRemoteFiles(
  repoInfo: RemoteRepoInfo,
  configs: FileCheckConfig[]
): Promise<FileCheckResult[]> {
  // Run checks in parallel for efficiency
  const results = await Promise.all(
    configs.map((config) => checkRemoteFileWithAlternatives(repoInfo, config))
  );
  return results;
}

/** Standard file checks for remote validation */
export const standardFileChecks: FileCheckConfig[] = [
  {
    path: "CODEOWNERS",
    alternativePaths: [".github/CODEOWNERS", "docs/CODEOWNERS"],
    required: false,
    description: "CODEOWNERS file for code review assignment",
  },
  {
    path: ".github/PULL_REQUEST_TEMPLATE.md",
    alternativePaths: [
      ".github/pull_request_template.md",
      "PULL_REQUEST_TEMPLATE.md",
      "pull_request_template.md",
    ],
    required: false,
    description: "Pull request template",
  },
  {
    path: "README.md",
    alternativePaths: ["readme.md", "README"],
    required: false,
    description: "Repository README",
  },
  {
    path: ".github/workflows",
    required: false,
    description: "GitHub Actions workflows directory",
  },
];
