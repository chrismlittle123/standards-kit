import { minimatch } from "minimatch";
import {
  listRepos,
  cloneRepo,
  createTempDir,
  removeTempDir,
  getGitHubToken,
  repoExists,
  createIssue,
  isRepoScannable,
} from "./client.js";
import { hasRecentCommits } from "./repo-checks.js";
import {
  formatMissingProjectsIssueBody,
  getMissingProjectsIssueTitle,
  getMissingProjectsIssueLabel,
  formatTierMismatchIssueBody,
  getTierMismatchIssueTitle,
  getTierMismatchIssueLabel,
  formatDependencyChangesIssueBody,
  getDependencyChangesIssueTitle,
  getDependencyChangesIssueLabel,
} from "./issue-formatter.js";
import { detectMissingProjects } from "../repo/project-detection.js";
import {
  validateTierRuleset,
  hasTierMismatch,
} from "../repo/tier-validation.js";
import {
  detectDependencyChanges,
  type DependencyChanges,
} from "../repo/dependency-changes.js";
import { generateFileDiff } from "../repo/diff.js";
import { getHeadCommit } from "../repo/changes.js";
import { loadConfig } from "../config/loader.js";
import { version } from "../version.js";
import type {
  DriftConfig,
  OrgScanResults,
  RepoScanResult,
  DriftIssueResult,
  MissingProject,
  MissingProjectsDetection,
  TierValidationResult,
  TierMismatchDetection,
  DependencyChangesDetection,
  DependencyFileChange,
} from "../types.js";
import { CONCURRENCY, DEFAULTS } from "../constants.js";
import {
  COLORS,
  createEmptyResults,
  createEmptyOrgSummary,
  getErrorMessage,
  actionsOutput,
} from "../utils/index.js";

export interface OrgScanOptions {
  org: string;
  repo?: string; // Single repo or all if not specified
  configRepo?: string; // Default: drift-config
  token?: string;
  json?: boolean;
  dryRun?: boolean; // Log but don't create issues
  all?: boolean; // Skip commit window filter (scan all repos)
  since?: number; // Hours to look back for commits (default: 24)
}

/**
 * Run async tasks with a concurrency limit.
 * Executes tasks in parallel while respecting the max concurrent limit.
 *
 * @param items - Array of items to process
 * @param fn - Async function to run on each item
 * @param concurrency - Maximum concurrent operations
 * @returns Promise resolving to array of results in original order
 */
async function parallelLimit<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = CONCURRENCY.maxRepoScans
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  // Start workers up to concurrency limit
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

/**
 * Check if a repo name matches any of the exclude patterns.
 * Supports glob patterns via minimatch.
 *
 * @param repoName - The repository name to check
 * @param patterns - Array of glob patterns to match against
 * @returns True if the repo should be excluded
 */
function matchesExcludePattern(repoName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(repoName, pattern));
}

/**
 * Print scan header with org/user info
 */
function printScanHeader(
  org: string,
  configRepoName: string,
  repoCount: number,
  isOrg: boolean
): void {
  console.log(`\nDrift v${version}`);
  console.log(`${isOrg ? "Organization" : "User"}: ${org}`);
  console.log(`Config repo: ${configRepoName}`);
  console.log(`Repos to scan: ${repoCount}`);
  console.log("");
}

interface CreateMissingProjectsIssueOptions {
  org: string;
  repoName: string;
  missingProjects: MissingProject[];
  token: string;
  dryRun: boolean;
  json: boolean;
}

/**
 * Create a GitHub issue for missing projects detection with error handling
 */
async function createMissingProjectsIssue(
  options: CreateMissingProjectsIssueOptions
): Promise<DriftIssueResult> {
  const { org, repoName, missingProjects, token, dryRun, json } = options;

  if (missingProjects.length === 0) {
    return { created: false };
  }

  const detection: MissingProjectsDetection = {
    repository: `${org}/${repoName}`,
    scanTime: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
    projects: missingProjects,
  };

  if (dryRun) {
    if (!json) {
      console.log(
        `  ${COLORS.cyan}[DRY-RUN] Would create issue: ${getMissingProjectsIssueTitle()}${COLORS.reset}`
      );
      console.log(
        `  ${COLORS.cyan}[DRY-RUN] Repository: ${org}/${repoName}${COLORS.reset}`
      );
      console.log(
        `  ${COLORS.cyan}[DRY-RUN] Labels: ${getMissingProjectsIssueLabel()}${COLORS.reset}`
      );
      console.log(
        `  ${COLORS.cyan}[DRY-RUN] Missing projects: ${missingProjects.map((p) => p.path).join(", ")}${COLORS.reset}`
      );
    }
    return { created: false };
  }

  try {
    const body = formatMissingProjectsIssueBody(detection);
    const issue = await createIssue(
      {
        owner: org,
        repo: repoName,
        title: getMissingProjectsIssueTitle(),
        body,
        labels: [getMissingProjectsIssueLabel()],
      },
      token
    );

    if (!json) {
      console.log(
        `  ${COLORS.green}✓ Created issue #${issue.number}: ${issue.html_url}${COLORS.reset}`
      );
    }

    return {
      created: true,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    if (!json) {
      console.log(
        `  ${COLORS.yellow}⚠ Failed to create missing projects issue: ${errorMessage}${COLORS.reset}`
      );
    }
    return {
      created: false,
      error: errorMessage,
    };
  }
}

interface CreateTierMismatchIssueOptions {
  org: string;
  repoName: string;
  tierValidation: TierValidationResult;
  token: string;
  dryRun: boolean;
  json: boolean;
}

/**
 * Create a GitHub issue for tier-ruleset mismatch detection with error handling
 */
async function createTierMismatchIssue(
  options: CreateTierMismatchIssueOptions
): Promise<DriftIssueResult> {
  const { org, repoName, tierValidation, token, dryRun, json } = options;

  if (tierValidation.valid || !tierValidation.error) {
    return { created: false };
  }

  const detection: TierMismatchDetection = {
    repository: `${org}/${repoName}`,
    scanTime: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
    tier: tierValidation.tier,
    rulesets: tierValidation.rulesets,
    expectedPattern: tierValidation.expectedPattern,
    error: tierValidation.error,
  };

  if (dryRun) {
    if (!json) {
      console.log(
        `  ${COLORS.cyan}[DRY-RUN] Would create issue: ${getTierMismatchIssueTitle()}${COLORS.reset}`
      );
      console.log(
        `  ${COLORS.cyan}[DRY-RUN] Repository: ${org}/${repoName}${COLORS.reset}`
      );
      console.log(
        `  ${COLORS.cyan}[DRY-RUN] Labels: ${getTierMismatchIssueLabel()}${COLORS.reset}`
      );
      console.log(
        `  ${COLORS.cyan}[DRY-RUN] Tier: ${tierValidation.tier}, Expected: ${tierValidation.expectedPattern}${COLORS.reset}`
      );
    }
    return { created: false };
  }

  try {
    const body = formatTierMismatchIssueBody(detection);
    const issue = await createIssue(
      {
        owner: org,
        repo: repoName,
        title: getTierMismatchIssueTitle(),
        body,
        labels: [getTierMismatchIssueLabel()],
      },
      token
    );

    if (!json) {
      console.log(
        `  ${COLORS.green}✓ Created tier mismatch issue #${issue.number}: ${issue.html_url}${COLORS.reset}`
      );
    }

    return {
      created: true,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    if (!json) {
      console.log(
        `  ${COLORS.yellow}⚠ Failed to create tier mismatch issue: ${errorMessage}${COLORS.reset}`
      );
    }
    return {
      created: false,
      error: errorMessage,
    };
  }
}

interface BuildDependencyChangesDetectionOptions {
  org: string;
  repoName: string;
  repoDir: string;
  changes: DependencyChanges;
}

/**
 * Build DependencyChangesDetection from DependencyChanges result
 */
function buildDependencyChangesDetection(
  options: BuildDependencyChangesDetectionOptions
): DependencyChangesDetection | null {
  const { org, repoName, repoDir, changes } = options;

  if (!changes.hasChanges) {
    return null;
  }

  const commit = getHeadCommit(repoDir) || "HEAD";
  const repoUrl = `https://github.com/${org}/${repoName}`;

  // Convert DependencyChange to DependencyFileChange with diffs
  const fileChanges: DependencyFileChange[] = changes.changes.map((change) => {
    const diff = generateFileDiff(repoDir, change.file, {
      fromCommit: "HEAD~1",
      toCommit: "HEAD",
      repoUrl,
    });

    return {
      file: change.file,
      status: change.status,
      checkType: change.checkType,
      diff: diff.diff || undefined,
    };
  });

  // Group by check type with diffs
  const byCheck: Record<string, DependencyFileChange[]> = {};
  for (const [checkType, checkChanges] of Object.entries(changes.byCheck)) {
    byCheck[checkType] = checkChanges.map((change) => {
      const fileChange = fileChanges.find((fc) => fc.file === change.file);
      return (
        fileChange || {
          file: change.file,
          status: change.status,
          checkType: change.checkType,
        }
      );
    });
  }

  return {
    repository: `${org}/${repoName}`,
    scanTime: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
    commit,
    commitUrl: `${repoUrl}/commit/${commit}`,
    changes: fileChanges,
    byCheck,
  };
}

interface CreateDependencyChangesIssueOptions {
  org: string;
  repoName: string;
  detection: DependencyChangesDetection;
  token: string;
  dryRun: boolean;
  json: boolean;
}

/**
 * Create a GitHub issue for dependency changes detection with error handling
 */
async function createDependencyChangesIssue(
  options: CreateDependencyChangesIssueOptions
): Promise<DriftIssueResult> {
  const { org, repoName, detection, token, dryRun, json } = options;

  if (detection.changes.length === 0) {
    return { created: false };
  }

  if (dryRun) {
    if (!json) {
      console.log(
        `  ${COLORS.cyan}[DRY-RUN] Would create issue: ${getDependencyChangesIssueTitle()}${COLORS.reset}`
      );
      console.log(
        `  ${COLORS.cyan}[DRY-RUN] Repository: ${org}/${repoName}${COLORS.reset}`
      );
      console.log(
        `  ${COLORS.cyan}[DRY-RUN] Labels: ${getDependencyChangesIssueLabel()}${COLORS.reset}`
      );
      console.log(
        `  ${COLORS.cyan}[DRY-RUN] Changed files: ${detection.changes.map((c) => c.file).join(", ")}${COLORS.reset}`
      );
    }
    return { created: false };
  }

  try {
    const body = formatDependencyChangesIssueBody(detection);
    const issue = await createIssue(
      {
        owner: org,
        repo: repoName,
        title: getDependencyChangesIssueTitle(),
        body,
        labels: [getDependencyChangesIssueLabel()],
      },
      token
    );

    if (!json) {
      console.log(
        `  ${COLORS.green}✓ Created dependency changes issue #${issue.number}: ${issue.html_url}${COLORS.reset}`
      );
    }

    return {
      created: true,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    if (!json) {
      console.log(
        `  ${COLORS.yellow}⚠ Failed to create dependency changes issue: ${errorMessage}${COLORS.reset}`
      );
    }
    return {
      created: false,
      error: errorMessage,
    };
  }
}

/**
 * Check if a repo has any issues (missing projects, tier mismatch, dependency changes)
 */
function repoHasIssues(result: RepoScanResult): boolean {
  return Boolean(
    (result.missingProjects && result.missingProjects.length > 0) ||
    (result.tierValidation && hasTierMismatch(result.tierValidation)) ||
    (result.dependencyChanges && result.dependencyChanges.changes.length > 0)
  );
}

/**
 * Scan all repositories in an organization
 */
export async function scanOrg(
  options: OrgScanOptions
): Promise<OrgScanResults> {
  const token = getGitHubToken(options.token);
  const configRepoName = options.configRepo ?? DEFAULTS.configRepo;
  const org = options.org;

  // Initialize results
  const orgResults: OrgScanResults = {
    org,
    configRepo: configRepoName,
    timestamp: new Date().toISOString(),
    repos: [],
    summary: createEmptyOrgSummary(),
  };

  // Check if config repo exists
  const configRepoExists = await repoExists(org, configRepoName, token);
  if (!configRepoExists) {
    const errorMsg = `Config repo ${org}/${configRepoName} not found`;
    console.error(`Error: ${errorMsg}.`);
    console.error(`Create a '${configRepoName}' repo with drift.config.yaml.`);
    if (!token) {
      console.error(
        `Hint: If this is a private repo, ensure GITHUB_TOKEN is set or pass --token.`
      );
    }
    actionsOutput.error(errorMsg);
    process.exit(1);
  }

  // Clone config repo - use try-finally for guaranteed cleanup
  const configDir = createTempDir("config");

  try {
    // Clone the config repo
    try {
      if (!options.json) {
        console.log(`Cloning config repo ${org}/${configRepoName}...`);
      }
      cloneRepo(org, configRepoName, configDir, token);
    } catch (error) {
      const errorMsg = `Failed to clone config repo: ${getErrorMessage(error)}`;
      console.error(`Error: ${errorMsg}`);
      actionsOutput.error(errorMsg);
      process.exit(1);
    }

    // Load config - will exit if not found, so config is guaranteed non-null after this
    const loadedConfig = loadConfig(configDir);
    if (!loadedConfig) {
      const errorMsg = `No drift.config.yaml found in ${org}/${configRepoName}`;
      console.error(`Error: ${errorMsg}`);
      actionsOutput.error(errorMsg);
      process.exit(1);
      return orgResults; // Never reached, but helps TypeScript understand control flow
    }
    // Create a const that TypeScript knows is non-null
    const config: DriftConfig = loadedConfig;

    // Get list of repos to scan
    let reposToScan: string[];
    let isOrg = true;

    if (options.repo) {
      // Single repo mode
      reposToScan = [options.repo];
    } else {
      // List all repos (auto-detects org vs user)
      if (!options.json) {
        console.log(`Fetching repos for ${org}...`);
      }
      const result = await listRepos(org, token);
      isOrg = result.isOrg;
      // Exclude the config repo and any repos matching exclude patterns
      reposToScan = result.repos
        .map((r) => r.name)
        .filter((name) => name !== configRepoName)
        .filter(
          (name) =>
            !config.exclude || !matchesExcludePattern(name, config.exclude)
        );
    }

    if (!options.json) {
      printScanHeader(org, configRepoName, reposToScan.length, isOrg);
      console.log(
        `Scanning with concurrency: ${Math.min(CONCURRENCY.maxRepoScans, reposToScan.length)}\n`
      );
    }

    /**
     * Scan a single repository and return the result.
     * Handles cloning, scanning, and cleanup.
     */
    function scanSingleRepo(repoName: string): RepoScanResult {
      const repoResult: RepoScanResult = {
        repo: repoName,
        results: createEmptyResults(`${org}/${repoName}`),
      };

      const repoDir = createTempDir(repoName);

      try {
        // Clone the repo
        cloneRepo(org, repoName, repoDir, token);
        repoResult.results.path = `${org}/${repoName}`;

        // Detect projects missing standards.toml
        repoResult.missingProjects = detectMissingProjects(repoDir);

        // Validate tier-ruleset alignment
        repoResult.tierValidation = validateTierRuleset(repoDir) ?? undefined;

        // Detect dependency file changes
        const dependencyChanges = detectDependencyChanges(repoDir);
        if (dependencyChanges.hasChanges) {
          const detection = buildDependencyChangesDetection({
            org,
            repoName,
            repoDir,
            changes: dependencyChanges,
          });
          if (detection) {
            repoResult.dependencyChanges = detection;
          }
        }
      } catch (error) {
        repoResult.error = getErrorMessage(error);
      } finally {
        removeTempDir(repoDir);
      }

      return repoResult;
    }

    // Scan repos in parallel with concurrency limit
    const repoResults = await parallelLimit(reposToScan, async (repoName) => {
      if (!options.json) {
        process.stdout.write(`Scanning ${org}/${repoName}... `);
      }

      // When scanning a specific repo, check if it exists first
      if (options.repo) {
        const exists = await repoExists(org, repoName, token);
        if (!exists) {
          if (!options.json) {
            console.log(`${COLORS.red}✗ repo not found${COLORS.reset}`);
          }
          return {
            repo: repoName,
            results: createEmptyResults(`${org}/${repoName}`),
            error: "repo not found",
          } as RepoScanResult;
        }
      }

      // Check if repo has required files before cloning
      const scannable = await isRepoScannable(org, repoName, token);
      if (!scannable) {
        if (!options.json) {
          console.log(
            `${COLORS.dim}○ skipped (missing required files)${COLORS.reset}`
          );
        }
        return {
          repo: repoName,
          results: createEmptyResults(`${org}/${repoName}`),
          error: "missing required files",
        } as RepoScanResult;
      }

      // Check for recent commits (unless --all flag is set)
      if (!options.all) {
        const hours = options.since ?? DEFAULTS.commitWindowHours;
        const hasActivity = await hasRecentCommits(org, repoName, hours, token);
        if (!hasActivity) {
          if (!options.json) {
            console.log(
              `${COLORS.dim}○ skipped (no recent activity)${COLORS.reset}`
            );
          }
          return {
            repo: repoName,
            results: createEmptyResults(`${org}/${repoName}`),
            error: "no recent activity",
          } as RepoScanResult;
        }
      }

      // scanSingleRepo is sync but we wrap in promise for parallelLimit
      const result = await Promise.resolve(scanSingleRepo(repoName));

      // Print status immediately after each scan completes
      if (!options.json) {
        if (result.error) {
          console.log(
            `${COLORS.yellow}⚠ skipped (${result.error})${COLORS.reset}`
          );
        } else if (repoHasIssues(result)) {
          console.log(`${COLORS.red}✗ issues found${COLORS.reset}`);
          // GitHub Actions warning for repos with issues
          actionsOutput.warning(`Drift detected in ${org}/${repoName}`);
        } else {
          console.log(`${COLORS.green}✓ ok${COLORS.reset}`);
        }
      }

      // Create GitHub issue for repos with missing projects
      if (
        !result.error &&
        result.missingProjects &&
        result.missingProjects.length > 0 &&
        token
      ) {
        await createMissingProjectsIssue({
          org,
          repoName,
          missingProjects: result.missingProjects,
          token,
          dryRun: options.dryRun ?? false,
          json: options.json ?? false,
        });
      }

      // Create GitHub issue for repos with tier-ruleset mismatch
      if (
        !result.error &&
        result.tierValidation &&
        hasTierMismatch(result.tierValidation) &&
        token
      ) {
        await createTierMismatchIssue({
          org,
          repoName,
          tierValidation: result.tierValidation,
          token,
          dryRun: options.dryRun ?? false,
          json: options.json ?? false,
        });
      }

      // Create GitHub issue for repos with dependency file changes
      if (
        !result.error &&
        result.dependencyChanges &&
        result.dependencyChanges.changes.length > 0 &&
        token
      ) {
        await createDependencyChangesIssue({
          org,
          repoName,
          detection: result.dependencyChanges,
          token,
          dryRun: options.dryRun ?? false,
          json: options.json ?? false,
        });
      }

      return result;
    });

    // Aggregate results
    for (const repoResult of repoResults) {
      if (repoResult.error) {
        orgResults.summary.reposSkipped++;
      } else {
        orgResults.summary.reposScanned++;
        if (repoHasIssues(repoResult)) {
          orgResults.summary.reposWithIssues++;
        }
      }
      orgResults.repos.push(repoResult);
    }

    // Output results
    if (options.json) {
      console.log(JSON.stringify(orgResults, null, 2));
    } else {
      printOrgResults(orgResults);
    }

    // Exit with error code if there are issues
    if (orgResults.summary.reposWithIssues > 0) {
      process.exit(1);
    }

    return orgResults;
  } finally {
    // Always cleanup config repo, even if errors occur
    removeTempDir(configDir);
  }
}

/**
 * Print organization scan results
 */
function printOrgResults(results: OrgScanResults): void {
  console.log("");
  console.log(`${COLORS.bold}RESULTS BY REPOSITORY${COLORS.reset}`);
  console.log("═".repeat(60));

  for (const repoResult of results.repos) {
    if (repoResult.error) {
      console.log(`\n${repoResult.repo}`);
      console.log("─".repeat(60));
      console.log(
        `  ${COLORS.yellow}⚠ Skipped: ${repoResult.error}${COLORS.reset}`
      );
      continue;
    }

    const hasIssues = repoHasIssues(repoResult);

    if (!hasIssues) {
      // Skip repos with no issues
      continue;
    }

    console.log(`\n${repoResult.repo}`);
    console.log("─".repeat(60));

    // Missing projects
    if (repoResult.missingProjects && repoResult.missingProjects.length > 0) {
      console.log(
        `  ⚠ Missing projects: ${repoResult.missingProjects.map((p) => p.path).join(", ")}`
      );
    }

    // Tier mismatch
    if (
      repoResult.tierValidation &&
      hasTierMismatch(repoResult.tierValidation)
    ) {
      console.log(`  ⚠ Tier mismatch: ${repoResult.tierValidation.error}`);
    }

    // Dependency changes
    if (
      repoResult.dependencyChanges &&
      repoResult.dependencyChanges.changes.length > 0
    ) {
      console.log(
        `  ⚠ Dependency changes: ${repoResult.dependencyChanges.changes.map((c) => c.file).join(", ")}`
      );
    }
  }

  // Summary
  console.log("");
  console.log(`${COLORS.bold}SUMMARY${COLORS.reset}`);
  console.log("═".repeat(60));
  console.log(`  Organization: ${results.org}`);
  console.log(`  Config repo: ${results.configRepo}`);
  console.log(
    `  Repos: ${results.summary.reposScanned} scanned` +
      (results.summary.reposSkipped > 0
        ? `, ${results.summary.reposSkipped} skipped`
        : "") +
      (results.summary.reposWithIssues > 0
        ? `, ${COLORS.red}${results.summary.reposWithIssues} with issues${COLORS.reset}`
        : "")
  );

  console.log("");

  if (results.summary.reposWithIssues > 0) {
    console.log(
      `${COLORS.red}✗ ISSUES DETECTED IN ${results.summary.reposWithIssues} REPO${results.summary.reposWithIssues > 1 ? "S" : ""}${COLORS.reset}`
    );
    // GitHub Actions error annotation for visibility
    actionsOutput.error(
      `Drift detected in ${results.summary.reposWithIssues} repository(s)`
    );
  } else {
    console.log(`${COLORS.green}✓ All repos passed${COLORS.reset}`);
    actionsOutput.notice("All repositories passed drift checks");
  }
}
