import * as fs from "node:fs";

import { minimatch } from "minimatch";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";

/** PR configuration from standards.toml */
interface PrConfig {
  enabled?: boolean;
  max_files?: number;
  max_lines?: number;
  require_issue?: boolean;
  issue_keywords?: string[];
  exclude?: string[];
}

/** Default keywords that link PRs to issues */
const DEFAULT_ISSUE_KEYWORDS = ["Closes", "Fixes", "Resolves"];

/** GitHub PR event payload structure (partial) */
interface GitHubPrEventPayload {
  pull_request?: {
    number?: number;
    changed_files?: number;
    additions?: number;
    deletions?: number;
    title?: string;
    body?: string;
  };
  repository?: {
    full_name?: string;
  };
}

/** GitHub PR file from API response */
interface GitHubPrFile {
  filename: string;
  additions: number;
  deletions: number;
}

/**
 * PR size validation runner.
 * Checks that the PR does not exceed configured size limits.
 * Reads PR data from GITHUB_EVENT_PATH environment variable (GitHub Actions context).
 */
export class PrRunner extends BaseProcessToolRunner {
  readonly name = "PR";
  readonly rule = "process.pr";
  readonly toolId = "pr";

  private config: PrConfig = {
    enabled: false,
    require_issue: false,
  };

  /**
   * Set configuration from standards.toml
   */
  setConfig(config: PrConfig): void {
    this.config = { ...this.config, ...config };
  }

  /** Read PR data from GitHub event payload */
  private readPrEventPayload(): GitHubPrEventPayload | null {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      return null;
    }

    try {
      const content = fs.readFileSync(eventPath, "utf-8");
      return JSON.parse(content) as GitHubPrEventPayload;
    } catch {
      return null;
    }
  }

  /** Get PR data from payload, returns null if not available */
  private getPrData(
    payload: GitHubPrEventPayload | null
  ): GitHubPrEventPayload["pull_request"] | null {
    return payload?.pull_request ?? null;
  }

  /** Fetch a single page of PR files from GitHub API */
  private async fetchPrFilesPage(
    repo: string,
    prNumber: number,
    page: number,
    token: string
  ): Promise<GitHubPrFile[] | null> {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );
    return response.ok ? ((await response.json()) as GitHubPrFile[]) : null;
  }

  /**
   * Fetch PR files from GitHub API with pagination support.
   * Returns empty array if GITHUB_TOKEN is not available or API fails.
   */
  private async fetchPrFiles(repo: string, prNumber: number): Promise<GitHubPrFile[]> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return [];
    }

    const fetchPage = async (
      page: number,
      accumulated: GitHubPrFile[]
    ): Promise<GitHubPrFile[]> => {
      const pageFiles = await this.fetchPrFilesPage(repo, prNumber, page, token);
      if (!pageFiles) {
        return [];
      }
      const allFiles = [...accumulated, ...pageFiles];
      return pageFiles.length < 100 ? allFiles : fetchPage(page + 1, allFiles);
    };

    try {
      return await fetchPage(1, []);
    } catch {
      return [];
    }
  }

  /**
   * Filter files that match exclude patterns.
   * Returns only files that do NOT match any exclude pattern.
   */
  private filterExcludedFiles(files: GitHubPrFile[], excludePatterns: string[]): GitHubPrFile[] {
    if (excludePatterns.length === 0) {
      return files;
    }

    return files.filter(
      (file) => !excludePatterns.some((pattern) => minimatch(file.filename, pattern))
    );
  }

  /** Check if any validation is configured */
  private hasValidationConfigured(): boolean {
    return (
      this.config.max_files !== undefined ||
      this.config.max_lines !== undefined ||
      this.config.require_issue === true
    );
  }

  /** Check if PR body contains issue reference with keyword */
  private findIssueReference(text: string | undefined): string | null {
    if (!text) {
      return null;
    }

    const keywords = this.config.issue_keywords ?? DEFAULT_ISSUE_KEYWORDS;
    // Build pattern: \b(Closes|Fixes|Resolves)\s+#(\d+)
    // Word boundary \b prevents matching "Closes" in "ClosesFile"
    const keywordPattern = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const regex = new RegExp(`\\b(?:${keywordPattern})\\s+#(\\d+)`, "i");
    const match = text.match(regex);
    return match ? match[1] : null;
  }

  /** Validate that PR contains issue reference */
  private validateIssueReference(pr: NonNullable<GitHubPrEventPayload["pull_request"]>): {
    passed: boolean;
    error?: string;
  } {
    if (!this.config.require_issue) {
      return { passed: true };
    }

    // Check body first (primary location for issue links)
    const bodyIssue = this.findIssueReference(pr.body);
    if (bodyIssue) {
      return { passed: true };
    }

    // Also check title as fallback
    const titleIssue = this.findIssueReference(pr.title);
    if (titleIssue) {
      return { passed: true };
    }

    const keywords = this.config.issue_keywords ?? DEFAULT_ISSUE_KEYWORDS;
    return {
      passed: false,
      error: `PR does not contain issue reference. Include "${keywords[0]} #<issue-number>" in the PR description.`,
    };
  }

  /** Get PR counts, applying exclusions if configured */
  private async getPrCounts(
    pr: NonNullable<GitHubPrEventPayload["pull_request"]>,
    repo: string | undefined
  ): Promise<{ fileCount: number; lineCount: number }> {
    const defaultCounts = {
      fileCount: pr.changed_files ?? 0,
      lineCount: (pr.additions ?? 0) + (pr.deletions ?? 0),
    };

    if (!this.config.exclude?.length || !repo || !pr.number) {
      return defaultCounts;
    }

    const files = await this.fetchPrFiles(repo, pr.number);
    if (files.length === 0) {
      return defaultCounts; // API failed, fall back
    }

    const filtered = this.filterExcludedFiles(files, this.config.exclude);
    return {
      fileCount: filtered.length,
      lineCount: filtered.reduce((sum, f) => sum + f.additions + f.deletions, 0),
    };
  }

  /** Check size limits and return violations */
  private checkSizeLimits(fileCount: number, lineCount: number): Violation[] {
    const violations: Violation[] = [];

    if (this.config.max_files !== undefined && fileCount > this.config.max_files) {
      violations.push({
        rule: `${this.rule}.max_files`,
        tool: this.toolId,
        message: `PR has ${fileCount} files changed (max: ${this.config.max_files})`,
        severity: "error",
      });
    }

    if (this.config.max_lines !== undefined && lineCount > this.config.max_lines) {
      violations.push({
        rule: `${this.rule}.max_lines`,
        tool: this.toolId,
        message: `PR has ${lineCount} lines changed (max: ${this.config.max_lines})`,
        severity: "error",
      });
    }

    return violations;
  }

  /** Validate PR size against configured limits */
  private async validatePrSize(
    pr: NonNullable<GitHubPrEventPayload["pull_request"]>,
    repo: string | undefined,
    elapsed: () => number
  ): Promise<CheckResult> {
    const { fileCount, lineCount } = await this.getPrCounts(pr, repo);
    const violations = this.checkSizeLimits(fileCount, lineCount);
    return violations.length > 0
      ? this.fromViolations(violations, elapsed())
      : this.pass(elapsed());
  }

  /** Collect all violations from PR validations */
  private async collectViolations(
    prData: NonNullable<GitHubPrEventPayload["pull_request"]>,
    repo: string | undefined,
    elapsed: () => number
  ): Promise<Violation[]> {
    const violations: Violation[] = [];

    const sizeResult = await this.validatePrSize(prData, repo, elapsed);
    if (!sizeResult.passed) {
      violations.push(...sizeResult.violations);
    }

    const issueResult = this.validateIssueReference(prData);
    if (!issueResult.passed && issueResult.error) {
      violations.push({
        rule: `${this.rule}.require_issue`,
        tool: this.toolId,
        message: issueResult.error,
        severity: "error",
      });
    }

    return violations;
  }

  /** Run PR validation */
  async run(_projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    if (!this.hasValidationConfigured()) {
      return this.skip("No PR validation configured", elapsed());
    }

    const payload = this.readPrEventPayload();
    const prData = this.getPrData(payload);
    if (!prData) {
      return this.skip("Not in a PR context (GITHUB_EVENT_PATH not set or no PR data)", elapsed());
    }

    const repo = payload?.repository?.full_name;
    const violations = await this.collectViolations(prData, repo, elapsed);
    return violations.length > 0
      ? this.fromViolations(violations, elapsed())
      : this.pass(elapsed());
  }
}
