import { join } from "node:path";
import {
  loadConfig,
  scanInfra,
  type InfraScanResult,
  type ScanInfraOptions,
} from "@standards-kit/conform";
import { version } from "../../version.js";
import { actionsOutput, COLORS } from "../../utils/index.js";
import {
  createIssue,
  getGitHubToken,
  cloneRepo,
  createTempDir,
  removeTempDir,
} from "../../github/client.js";
import { discoverInfraRepos } from "../../github/infra-repo-discovery.js";
import {
  formatInfraDriftIssueBody,
  getInfraDriftIssueTitle,
  getInfraDriftIssueLabel,
} from "../../github/infra-issue-formatter.js";
import { CONCURRENCY } from "../../constants.js";
import type {
  InfraDriftDetection,
  InfraScanSummary,
  InfraResourceResult,
  InfraRepoScanResult,
  InfraOrgScanResults,
  InfraOrgScanSummary,
} from "../../types.js";

export interface InfraScanCommandOptions {
  repo?: string;
  org?: string;
  account?: string;
  json?: boolean;
  dryRun?: boolean;
  all?: boolean;
  since?: string;
}

/**
 * Map @standards-kit/conform InfraScanResult to @standards-kit/drift InfraDriftDetection
 */
function mapToDetection(
  result: InfraScanResult,
  repo: string
): InfraDriftDetection {
  const summary: InfraScanSummary = {
    total: result.summary.total,
    found: result.summary.found,
    missing: result.summary.missing,
    errors: result.summary.errors,
  };

  const resources: InfraResourceResult[] = result.results.map((r) => ({
    arn: r.arn,
    exists: r.exists,
    error: r.error,
    service: r.service,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
  }));

  return {
    repository: repo,
    scanTime: new Date().toISOString(),
    manifest: result.manifest,
    summary,
    resources,
  };
}

/**
 * Run async tasks with a concurrency limit.
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
function createEmptySummary(): InfraOrgScanSummary {
  return {
    reposScanned: 0,
    reposWithDrift: 0,
    reposSkipped: 0,
    issuesCreated: 0,
  };
}

/**
 * Check if drift was detected (missing resources or errors)
 */
function hasDrift(detection: InfraDriftDetection): boolean {
  return detection.summary.missing > 0 || detection.summary.errors > 0;
}

/**
 * Read the infra manifest path from standards.toml via conform's config loader.
 */
function getManifestPath(repoDir: string): string {
  const configPath = join(repoDir, "standards.toml");
  const { config } = loadConfig(configPath);

  if (!config.infra?.enabled) {
    throw new Error("Infra scanning is not enabled in standards.toml");
  }

  const manifestFile = config.infra.manifest ?? "infra-manifest.json";
  return join(repoDir, manifestFile);
}

/**
 * Print scan results to console
 */
function printResults(detection: InfraDriftDetection): void {
  console.log(`\n${COLORS.bold}Infrastructure Scan Results${COLORS.reset}`);
  console.log(`Repository: ${detection.repository}`);
  console.log(`Scan time: ${detection.scanTime}\n`);

  // Print summary table
  console.log(`${COLORS.bold}Summary${COLORS.reset}`);
  console.log("─".repeat(50));
  console.log(
    `${"Total".padEnd(12)} ${"Found".padEnd(12)} ${"Missing".padEnd(12)} ${"Errors".padEnd(12)}`
  );
  console.log("─".repeat(50));

  const { summary } = detection;
  const foundColor = summary.found > 0 ? COLORS.green : "";
  const missingColor = summary.missing > 0 ? COLORS.red : "";
  const errorsColor = summary.errors > 0 ? COLORS.yellow : "";

  console.log(
    `${String(summary.total).padEnd(12)} ` +
      `${foundColor}${String(summary.found).padEnd(12)}${COLORS.reset} ` +
      `${missingColor}${String(summary.missing).padEnd(12)}${COLORS.reset} ` +
      `${errorsColor}${String(summary.errors).padEnd(12)}${COLORS.reset}`
  );
  console.log("─".repeat(50));

  // Print missing resources if any
  const missing = detection.resources.filter((r) => !r.exists && !r.error);
  if (missing.length > 0) {
    console.log(
      `\n${COLORS.bold}${COLORS.red}Missing Resources${COLORS.reset}`
    );
    console.log("─".repeat(80));

    for (const r of missing) {
      console.log(`${COLORS.red}✗${COLORS.reset} ${r.arn}`);
      console.log(`  Service: ${r.service}, Type: ${r.resourceType}`);
    }
  }

  // Print errors if any
  const errors = detection.resources.filter((r) => r.error);
  if (errors.length > 0) {
    console.log(`\n${COLORS.bold}${COLORS.yellow}Errors${COLORS.reset}`);
    console.log("─".repeat(80));

    for (const r of errors) {
      console.log(`${COLORS.yellow}⚠${COLORS.reset} ${r.arn}`);
      console.log(`  Error: ${r.error}`);
    }
  }

  if (!hasDrift(detection)) {
    console.log(
      `\n${COLORS.green}✓ All infrastructure resources found${COLORS.reset}`
    );
  }
}

interface SingleRepoScanOptions {
  repo: string;
  json: boolean;
  dryRun: boolean;
  token: string;
}

/**
 * Scan a single repository for infrastructure drift.
 * Clones the repo, runs scanInfra, and cleans up.
 */
async function scanSingleRepo(
  options: SingleRepoScanOptions
): Promise<boolean> {
  const { repo, json, dryRun, token } = options;
  const [owner, repoName] = repo.split("/");

  if (!json) {
    console.log(`Scanning infrastructure for: ${repo}`);
  }

  // Clone the repo to a temp directory
  const tempDir = createTempDir(`infra-${repoName}`);

  try {
    if (!json) {
      console.log(`Cloning ${repo}...`);
    }
    cloneRepo(owner, repoName, tempDir, token);

    // Read manifest path from standards.toml
    const manifestPath = getManifestPath(tempDir);

    // Call @standards-kit/conform's scanInfra with the manifest path
    const scanOptions: ScanInfraOptions = {
      manifestPath,
    };

    const result = await scanInfra(scanOptions);

    // Map to @standards-kit/drift detection format
    const detection = mapToDetection(result, repo);

    // Output results
    if (json) {
      console.log(JSON.stringify(detection, null, 2));
    } else {
      printResults(detection);
    }

    // Create issue if there is drift
    if (hasDrift(detection)) {
      if (dryRun) {
        if (!json) {
          console.log(
            `\n${COLORS.yellow}[DRY RUN] Would create issue in ${repo}${COLORS.reset}`
          );
        }
        actionsOutput.warning(`Infrastructure drift detected in ${repo}`);
      } else {
        const issueResult = await createIssue(
          {
            owner,
            repo: repoName,
            title: getInfraDriftIssueTitle(),
            body: formatInfraDriftIssueBody(detection),
            labels: [getInfraDriftIssueLabel()],
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
          `Created issue #${issueResult.number} for infrastructure drift`
        );
      }
      return true; // drift found
    }

    actionsOutput.notice(`Infrastructure scan passed for ${repo}`);
    return false; // no drift
  } finally {
    // Clean up temp directory
    removeTempDir(tempDir);
  }
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
 * Scan a single repo for infrastructure drift (for parallel execution).
 */
async function scanRepoForOrg(
  ctx: ScanRepoContext
): Promise<InfraRepoScanResult> {
  const { repo, token, dryRun } = ctx;
  const [owner, repoName] = repo.split("/");

  // Clone the repo to a temp directory
  const tempDir = createTempDir(`infra-${repoName}`);

  try {
    cloneRepo(owner, repoName, tempDir, token);

    // Read manifest path from standards.toml
    const manifestPath = getManifestPath(tempDir);

    const scanOptions: ScanInfraOptions = {
      manifestPath,
    };

    const result = await scanInfra(scanOptions);
    const detection = mapToDetection(result, repo);

    const scanResult: InfraRepoScanResult = {
      repo,
      detection,
    };

    // Create issue if there is drift
    if (hasDrift(detection)) {
      if (dryRun) {
        scanResult.issueCreated = false;
      } else {
        const issueResult = await createIssue(
          {
            owner,
            repo: repoName,
            title: getInfraDriftIssueTitle(),
            body: formatInfraDriftIssueBody(detection),
            labels: [getInfraDriftIssueLabel()],
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
  } finally {
    // Clean up temp directory
    removeTempDir(tempDir);
  }
}

/**
 * Print org-wide scan results
 */
function printOrgResults(results: InfraOrgScanResults): void {
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

    const driftDetected =
      repoResult.detection && hasDrift(repoResult.detection);

    if (!driftDetected) {
      continue; // Skip repos with no drift
    }

    console.log(`\n${repoResult.repo}`);
    console.log("─".repeat(60));

    if (repoResult.detection) {
      const { summary } = repoResult.detection;
      console.log(
        `  ${COLORS.red}✗ ${summary.missing} missing, ${summary.errors} errors${COLORS.reset}`
      );
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
      (results.summary.reposWithDrift > 0
        ? `, ${COLORS.red}${results.summary.reposWithDrift} with drift${COLORS.reset}`
        : "")
  );
  if (results.summary.issuesCreated > 0) {
    console.log(
      `  Issues created: ${COLORS.green}${results.summary.issuesCreated}${COLORS.reset}`
    );
  }

  console.log("");

  if (results.summary.reposWithDrift > 0) {
    console.log(
      `${COLORS.red}✗ DRIFT DETECTED IN ${results.summary.reposWithDrift} REPO${results.summary.reposWithDrift > 1 ? "S" : ""}${COLORS.reset}`
    );
    actionsOutput.error(
      `Infrastructure drift detected in ${results.summary.reposWithDrift} repository(s)`
    );
  } else {
    console.log(`${COLORS.green}✓ All repos passed${COLORS.reset}`);
    actionsOutput.notice("All repositories passed infrastructure checks");
  }
}

/**
 * Scan all repos in an organization for infrastructure drift.
 */
async function scanOrgRepos(
  options: ScanOrgReposOptions
): Promise<InfraOrgScanResults> {
  const { org, token, json, dryRun, includeAll, sinceHours } = options;

  // Initialize results
  const results: InfraOrgScanResults = {
    org,
    timestamp: new Date().toISOString(),
    repos: [],
    summary: createEmptySummary(),
  };

  // Discover repos with [infra] config
  if (!json) {
    if (includeAll) {
      console.log(`Discovering repos with [infra] config in ${org}...`);
    } else {
      console.log(
        `Discovering repos with [infra] config in ${org} (commits in last ${sinceHours}h)...`
      );
    }
  }

  const discoveryResult = await discoverInfraRepos({
    org,
    token,
    includeAll,
    sinceHours,
    onProgress: (checked, total) => {
      if (!json) {
        process.stdout.write(
          `\rChecking repos for [infra] config: ${checked}/${total}`
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
        `Found ${discoveryResult.reposWithInfra}/${discoveryResult.totalRepos} repos with [infra] config`
      );
      console.log(
        `Active in last ${discoveryResult.activityWindowHours}h: ${repoNames.length} repos`
      );
    } else {
      console.log(
        `Found ${repoNames.length}/${discoveryResult.totalRepos} repos with [infra] config`
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

      const result = await scanRepoForOrg({
        repo,
        token,
        dryRun,
      });

      // Print inline status
      if (!json) {
        if (result.error) {
          console.log(
            `${COLORS.yellow}⚠ skipped (${result.error})${COLORS.reset}`
          );
        } else if (result.detection && hasDrift(result.detection)) {
          const issueInfo = result.issueCreated
            ? ` → issue #${result.issueNumber}`
            : dryRun
              ? " [dry-run]"
              : "";
          console.log(
            `${COLORS.red}✗ drift detected${issueInfo}${COLORS.reset}`
          );
          actionsOutput.warning(`Infrastructure drift detected in ${repo}`);
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
      if (repoResult.detection && hasDrift(repoResult.detection)) {
        results.summary.reposWithDrift++;
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

export async function scan(options: InfraScanCommandOptions): Promise<void> {
  const { repo, org, json, dryRun, all, since } = options;
  const sinceHours = parseInt(since ?? "24", 10);

  // Validate options: need either --repo or --org
  if (!repo && !org) {
    const errorMsg = "Either --repo or --org must be specified";
    console.error(`Error: ${errorMsg}`);
    actionsOutput.error(errorMsg);
    process.exit(1);
    return;
  }

  // Get GitHub token
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

      const hasDriftDetected = await scanSingleRepo({
        repo,
        json: json ?? false,
        dryRun: dryRun ?? false,
        token,
      });

      if (hasDriftDetected) {
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

      // Exit with error code if there is drift
      if (results.summary.reposWithDrift > 0) {
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
