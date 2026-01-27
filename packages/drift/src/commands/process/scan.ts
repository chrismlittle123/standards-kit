import { validateProcess, type ValidateProcessResult } from "@standards-kit/conform";
import { version } from "../../version.js";
import { actionsOutput, COLORS } from "../../utils/index.js";
import { createIssue, getGitHubToken } from "../../github/client.js";
import { discoverProcessRepos } from "../../github/process-repo-discovery.js";
import {
  formatProcessViolationsIssueBody,
  getProcessViolationsIssueTitle,
  getProcessViolationsIssueLabel,
} from "../../github/process-issue-formatter.js";
import { CONCURRENCY } from "../../constants.js";
import type {
  ProcessViolationsDetection,
  ProcessCheckSummary,
  ProcessViolation,
  ProcessRepoScanResult,
  ProcessOrgScanResults,
  ProcessOrgScanSummary,
} from "../../types.js";

export interface ProcessScanOptions {
  repo?: string;
  org?: string;
  config?: string;
  json?: boolean;
  dryRun?: boolean;
  all?: boolean;
  since?: string;
}

/**
 * Map @standards-kit/conform ValidateProcessResult to @standards-kit/drift ProcessViolationsDetection
 */
function mapToDetection(
  result: ValidateProcessResult,
  repo: string
): ProcessViolationsDetection {
  // Group checks by category (extract from check name, e.g., "branches.protection" -> "branches")
  const categoryMap = new Map<string, { passed: number; failed: number }>();
  const violations: ProcessViolation[] = [];

  for (const check of result.checks) {
    // Extract category from check name (e.g., "branches.protection" -> "branches")
    const category = check.name.split(".")[0] || check.name;

    // Update category counts
    const stats = categoryMap.get(category) || { passed: 0, failed: 0 };
    if (check.passed) {
      stats.passed++;
    } else {
      stats.failed++;
    }
    categoryMap.set(category, stats);

    // Collect violations from failed checks
    if (!check.passed && check.violations) {
      for (const v of check.violations) {
        violations.push({
          category,
          check: check.name,
          rule: v.rule,
          message: v.message,
          severity: v.severity,
          file: v.file,
        });
      }
    }
  }

  // Convert category map to summary array
  const summary: ProcessCheckSummary[] = [];
  for (const [category, stats] of categoryMap) {
    summary.push({
      category,
      passed: stats.passed,
      failed: stats.failed,
    });
  }

  return {
    repository: repo,
    scanTime: new Date().toISOString(),
    summary,
    violations,
  };
}

/**
 * Run async tasks with a concurrency limit.
 * Executes tasks in parallel while respecting the max concurrent limit.
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

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

/**
 * Create empty org scan summary
 */
function createEmptySummary(): ProcessOrgScanSummary {
  return {
    reposScanned: 0,
    reposWithViolations: 0,
    reposSkipped: 0,
    issuesCreated: 0,
  };
}

/**
 * Print scan results to console
 */
function printResults(detection: ProcessViolationsDetection): void {
  console.log(`\n${COLORS.bold}Process Scan Results${COLORS.reset}`);
  console.log(`Repository: ${detection.repository}`);
  console.log(`Scan time: ${detection.scanTime}\n`);

  // Print summary table
  console.log(`${COLORS.bold}Summary${COLORS.reset}`);
  console.log("─".repeat(40));
  console.log(
    `${"Category".padEnd(20)} ${"Passed".padEnd(8)} ${"Failed".padEnd(8)}`
  );
  console.log("─".repeat(40));

  for (const cat of detection.summary) {
    const passedColor = cat.passed > 0 ? COLORS.green : "";
    const failedColor = cat.failed > 0 ? COLORS.red : "";
    console.log(
      `${cat.category.padEnd(20)} ${passedColor}${String(cat.passed).padEnd(8)}${COLORS.reset} ${failedColor}${String(cat.failed).padEnd(8)}${COLORS.reset}`
    );
  }
  console.log("─".repeat(40));

  // Print violations if any
  if (detection.violations.length > 0) {
    console.log(`\n${COLORS.bold}${COLORS.red}Violations${COLORS.reset}`);
    console.log("─".repeat(60));

    for (const v of detection.violations) {
      const severityColor = v.severity === "error" ? COLORS.red : COLORS.yellow;
      const severityIcon = v.severity === "error" ? "✗" : "⚠";
      console.log(
        `${severityColor}${severityIcon}${COLORS.reset} [${v.category}] ${v.check}`
      );
      console.log(`  ${v.message}`);
      if (v.file) {
        console.log(`  File: ${v.file}`);
      }
      console.log("");
    }
  } else {
    console.log(`\n${COLORS.green}✓ All process checks passed${COLORS.reset}`);
  }
}

interface SingleRepoScanOptions {
  repo: string;
  config?: string;
  json: boolean;
  dryRun: boolean;
  token: string;
}

/**
 * Scan a single repository for process violations.
 */
async function scanSingleRepo(
  options: SingleRepoScanOptions
): Promise<boolean> {
  const { repo, config, json, dryRun, token } = options;
  const [owner, repoName] = repo.split("/");

  if (!json) {
    console.log(`Scanning process standards for: ${repo}`);
    if (config) {
      console.log(`Using config: ${config}`);
    }
  }

  // Call @standards-kit/conform's validateProcess
  const result = await validateProcess({
    repo,
    config,
  });

  // Map to @standards-kit/drift detection format
  const detection = mapToDetection(result, repo);

  // Output results
  if (json) {
    console.log(JSON.stringify(detection, null, 2));
  } else {
    printResults(detection);
  }

  // Create issue if there are violations
  if (detection.violations.length > 0) {
    if (dryRun) {
      if (!json) {
        console.log(
          `\n${COLORS.yellow}[DRY RUN] Would create issue in ${repo}${COLORS.reset}`
        );
      }
      actionsOutput.warning(`Process violations detected in ${repo}`);
    } else {
      const issueResult = await createIssue(
        {
          owner,
          repo: repoName,
          title: getProcessViolationsIssueTitle(),
          body: formatProcessViolationsIssueBody(detection),
          labels: [getProcessViolationsIssueLabel()],
        },
        token
      );
      if (!json) {
        console.log(
          `\n${COLORS.green}✓ Created issue #${issueResult.number}${COLORS.reset}`
        );
        console.log(`  ${issueResult.html_url}`);
      }
      actionsOutput.notice(
        `Created issue #${issueResult.number} for process violations`
      );
    }
    return true; // violations found
  }

  actionsOutput.notice(`Process scan passed for ${repo}`);
  return false; // no violations
}

interface ScanOrgReposOptions {
  org: string;
  token: string;
  json: boolean;
  dryRun: boolean;
  includeAll: boolean;
  sinceHours: number;
}

interface ScanRepoContext {
  repo: string;
  token: string;
  dryRun: boolean;
}

/**
 * Scan a single repo for process violations (for parallel execution).
 * Returns ProcessRepoScanResult instead of printing directly.
 */
async function scanRepoForOrg(
  ctx: ScanRepoContext
): Promise<ProcessRepoScanResult> {
  const { repo, token, dryRun } = ctx;
  const [owner, repoName] = repo.split("/");

  try {
    const result = await validateProcess({ repo });
    const detection = mapToDetection(result, repo);

    const scanResult: ProcessRepoScanResult = {
      repo,
      detection,
    };

    // Create issue if there are violations
    if (detection.violations.length > 0) {
      if (dryRun) {
        scanResult.issueCreated = false;
      } else {
        const issueResult = await createIssue(
          {
            owner,
            repo: repoName,
            title: getProcessViolationsIssueTitle(),
            body: formatProcessViolationsIssueBody(detection),
            labels: [getProcessViolationsIssueLabel()],
          },
          token
        );
        scanResult.issueCreated = true;
        scanResult.issueNumber = issueResult.number;
        scanResult.issueUrl = issueResult.html_url;
      }
    }

    return scanResult;
  } catch (error) {
    return {
      repo,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Print org-wide scan results
 */
function printOrgResults(results: ProcessOrgScanResults): void {
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

    const hasViolations =
      repoResult.detection && repoResult.detection.violations.length > 0;

    if (!hasViolations) {
      continue; // Skip repos with no violations
    }

    console.log(`\n${repoResult.repo}`);
    console.log("─".repeat(60));

    if (repoResult.detection) {
      console.log(
        `  ${COLORS.red}✗ ${repoResult.detection.violations.length} violation(s)${COLORS.reset}`
      );
      for (const v of repoResult.detection.violations) {
        const severityIcon = v.severity === "error" ? "✗" : "⚠";
        console.log(`    ${severityIcon} [${v.category}] ${v.message}`);
      }
    }

    if (repoResult.issueCreated && repoResult.issueNumber) {
      console.log(
        `  ${COLORS.green}✓ Created issue #${repoResult.issueNumber}${COLORS.reset}`
      );
    }
  }

  // Summary
  console.log("");
  console.log(`${COLORS.bold}SUMMARY${COLORS.reset}`);
  console.log("═".repeat(60));
  console.log(`  Organization: ${results.org}`);
  console.log(
    `  Repos: ${results.summary.reposScanned} scanned` +
      (results.summary.reposSkipped > 0
        ? `, ${results.summary.reposSkipped} skipped`
        : "") +
      (results.summary.reposWithViolations > 0
        ? `, ${COLORS.red}${results.summary.reposWithViolations} with violations${COLORS.reset}`
        : "")
  );
  if (results.summary.issuesCreated > 0) {
    console.log(
      `  Issues created: ${COLORS.green}${results.summary.issuesCreated}${COLORS.reset}`
    );
  }

  console.log("");

  if (results.summary.reposWithViolations > 0) {
    console.log(
      `${COLORS.red}✗ VIOLATIONS DETECTED IN ${results.summary.reposWithViolations} REPO${results.summary.reposWithViolations > 1 ? "S" : ""}${COLORS.reset}`
    );
    actionsOutput.error(
      `Process violations detected in ${results.summary.reposWithViolations} repository(s)`
    );
  } else {
    console.log(`${COLORS.green}✓ All repos passed${COLORS.reset}`);
    actionsOutput.notice("All repositories passed process checks");
  }
}

/**
 * Scan all repos in an organization for process violations.
 */
async function scanOrgRepos(
  options: ScanOrgReposOptions
): Promise<ProcessOrgScanResults> {
  const { org, token, json, dryRun, includeAll, sinceHours } = options;

  // Initialize results
  const results: ProcessOrgScanResults = {
    org,
    timestamp: new Date().toISOString(),
    repos: [],
    summary: createEmptySummary(),
  };

  // Discover repos with standards.toml
  if (!json) {
    if (includeAll) {
      console.log(`Discovering repos with standards.toml in ${org}...`);
    } else {
      console.log(
        `Discovering repos with standards.toml in ${org} (commits in last ${sinceHours}h)...`
      );
    }
  }

  const discoveryResult = await discoverProcessRepos({
    org,
    token,
    includeAll,
    sinceHours,
    onProgress: (checked, total) => {
      if (!json) {
        process.stdout.write(
          `\rChecking repos for standards.toml: ${checked}/${total}`
        );
      }
    },
    onActivityProgress: (checked, total) => {
      if (!json) {
        process.stdout.write(
          `\rFiltering by recent activity: ${checked}/${total}`
        );
      }
    },
  });

  if (!json) {
    process.stdout.write("\r" + " ".repeat(50) + "\r");
  }

  const repoNames = discoveryResult.repos.map((r) => r.full_name);

  if (!json) {
    if (discoveryResult.filteredByActivity) {
      console.log(
        `Found ${discoveryResult.reposWithCheckToml}/${discoveryResult.totalRepos} repos with standards.toml`
      );
      console.log(
        `Active in last ${discoveryResult.activityWindowHours}h: ${repoNames.length} repos`
      );
    } else {
      console.log(
        `Found ${repoNames.length}/${discoveryResult.totalRepos} repos with standards.toml`
      );
    }
  }

  if (repoNames.length === 0) {
    if (json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log("\nNo repos to scan.");
    }
    return results;
  }

  // Scan repos in parallel
  if (!json) {
    console.log(
      `\nScanning ${repoNames.length} repos with concurrency: ${Math.min(CONCURRENCY.maxRepoScans, repoNames.length)}\n`
    );
  }

  const repoResults = await parallelLimit(
    repoNames,
    async (repo) => {
      if (!json) {
        process.stdout.write(`Scanning ${repo}... `);
      }

      const result = await scanRepoForOrg({ repo, token, dryRun });

      // Print inline status
      if (!json) {
        if (result.error) {
          console.log(
            `${COLORS.yellow}⚠ skipped (${result.error})${COLORS.reset}`
          );
        } else if (result.detection && result.detection.violations.length > 0) {
          const issueInfo = result.issueCreated
            ? ` → issue #${result.issueNumber}`
            : dryRun
              ? " [dry-run]"
              : "";
          console.log(
            `${COLORS.red}✗ ${result.detection.violations.length} violation(s)${issueInfo}${COLORS.reset}`
          );
          actionsOutput.warning(`Process violations detected in ${repo}`);
        } else {
          console.log(`${COLORS.green}✓ ok${COLORS.reset}`);
        }
      }

      return result;
    },
    CONCURRENCY.maxRepoScans
  );

  // Aggregate results
  for (const repoResult of repoResults) {
    if (repoResult.error) {
      results.summary.reposSkipped++;
    } else {
      results.summary.reposScanned++;
      if (repoResult.detection && repoResult.detection.violations.length > 0) {
        results.summary.reposWithViolations++;
      }
      if (repoResult.issueCreated) {
        results.summary.issuesCreated++;
      }
    }
    results.repos.push(repoResult);
  }

  // Output results
  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printOrgResults(results);
  }

  return results;
}

export async function scan(options: ProcessScanOptions): Promise<void> {
  const { repo, org, config, json, dryRun, all, since } = options;
  const sinceHours = parseInt(since ?? "24", 10);

  // Validate options: need either --repo or --org
  if (!repo && !org) {
    const errorMsg = "Either --repo or --org must be specified";
    console.error(`Error: ${errorMsg}`);
    actionsOutput.error(errorMsg);
    process.exit(1);
    return;
  }

  // Get GitHub token (required for validateProcess to fetch repo data)
  const token = getGitHubToken();
  if (!token) {
    const errorMsg =
      "GitHub token required. Set GITHUB_TOKEN environment variable or use --github-token";
    console.error(`Error: ${errorMsg}`);
    actionsOutput.error(errorMsg);
    process.exit(1);
    return;
  }

  if (!json) {
    console.log(`Drift v${version}`);
  }

  try {
    // Case 1: Single repo scan (--repo without --org, or --org with --repo)
    if (repo) {
      // Validate repo format
      if (!repo.includes("/")) {
        const errorMsg = "Repository must be in owner/repo format";
        console.error(`Error: ${errorMsg}`);
        actionsOutput.error(errorMsg);
        process.exit(1);
        return;
      }

      const hasViolations = await scanSingleRepo({
        repo,
        config,
        json: json ?? false,
        dryRun: dryRun ?? false,
        token,
      });

      if (hasViolations) {
        process.exit(1);
      }
      return;
    }

    // Case 2: Org-wide scanning (--org without --repo)
    if (org) {
      const results = await scanOrgRepos({
        org,
        token,
        json: json ?? false,
        dryRun: dryRun ?? false,
        includeAll: all ?? false,
        sinceHours,
      });

      // Exit with error code if there are violations
      if (results.summary.reposWithViolations > 0) {
        process.exit(1);
      }
    }
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`\n${COLORS.red}Error: ${errorMsg}${COLORS.reset}`);
    actionsOutput.error(errorMsg);
    process.exit(1);
  }
}
