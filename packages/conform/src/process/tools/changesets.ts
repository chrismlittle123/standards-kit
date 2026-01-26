import * as fs from "node:fs";
import * as path from "node:path";

import { execa } from "execa";
import { minimatch } from "minimatch";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";

/** Valid changeset bump types */
type BumpType = "patch" | "minor" | "major";

/** Changesets configuration from standards.toml */
interface ChangesetsConfig {
  enabled?: boolean;
  require_for_paths?: string[];
  exclude_paths?: string[];
  validate_format?: boolean;
  allowed_bump_types?: BumpType[];
  require_description?: boolean;
  min_description_length?: number;
}

/** Parsed changeset file */
interface ParsedChangeset {
  filePath: string;
  packages: Map<string, BumpType>;
  description: string;
  parseError?: string;
}

/** Find frontmatter boundaries in content lines */
function findFrontmatterBounds(lines: string[]): { start: number; end: number } {
  let start = -1;
  let end = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      if (start === -1) {
        start = i;
      } else {
        end = i;
        break;
      }
    }
  }

  return { start, end };
}

/** Parse frontmatter lines to extract packages and bump types */
function parseFrontmatterPackages(
  lines: string[],
  start: number,
  end: number
): Map<string, BumpType> {
  const packages = new Map<string, BumpType>();

  for (let i = start + 1; i < end; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }

    // Match: "package-name": bump-type
    const match = /^["']([^"']+)["']:\s*(patch|minor|major)\s*$/.exec(line);
    if (match) {
      packages.set(match[1], match[2] as BumpType);
    }
  }

  return packages;
}

/** Check if a git branch exists */
async function branchExists(projectRoot: string, branch: string): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--verify", branch], { cwd: projectRoot });
    return true;
  } catch {
    return false;
  }
}

/** Try to find the base branch (main or master) */
async function findBaseBranch(projectRoot: string): Promise<string | null> {
  const branches = ["origin/main", "origin/master", "main", "master"];

  // Check branches in parallel to avoid await-in-loop
  const results = await Promise.all(branches.map((b) => branchExists(projectRoot, b)));
  const index = results.findIndex(Boolean);

  if (index === -1) {
    return null;
  }

  return branches[index].replace("origin/", "");
}

/**
 * Changeset validation runner.
 * Validates that changeset files exist and are properly formatted.
 */
export class ChangesetsRunner extends BaseProcessToolRunner {
  readonly name = "Changesets";
  readonly rule = "process.changesets";
  readonly toolId = "changesets";

  private config: ChangesetsConfig = {
    enabled: false,
    validate_format: true,
    require_description: true,
  };

  /**
   * Set configuration from standards.toml
   */
  setConfig(config: ChangesetsConfig): void {
    this.config = { ...this.config, ...config };
  }

  /** Get list of changeset files (excluding config.json) */
  private getChangesetFiles(projectRoot: string): string[] {
    const changesetDir = path.join(projectRoot, ".changeset");

    if (!fs.existsSync(changesetDir)) {
      return [];
    }

    try {
      const files = fs.readdirSync(changesetDir);
      return files
        .filter((f) => f.endsWith(".md") && f !== "README.md")
        .map((f) => path.join(".changeset", f));
    } catch {
      return [];
    }
  }

  /** Parse a changeset file and extract frontmatter and description */
  private parseChangesetFile(projectRoot: string, filePath: string): ParsedChangeset {
    const fullPath = path.join(projectRoot, filePath);
    const result: ParsedChangeset = { filePath, packages: new Map(), description: "" };

    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      return this.parseChangesetContent(content, result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      result.parseError = `Failed to read file: ${msg}`;
      return result;
    }
  }

  /** Parse changeset content and populate result */
  private parseChangesetContent(content: string, result: ParsedChangeset): ParsedChangeset {
    const lines = content.split("\n");
    const { start, end } = findFrontmatterBounds(lines);

    if (start === -1) {
      result.parseError = "Missing frontmatter: no opening '---' delimiter found";
      return result;
    }
    if (end === -1) {
      result.parseError =
        "Invalid frontmatter: opening '---' found but missing closing '---' delimiter";
      return result;
    }

    result.packages = parseFrontmatterPackages(lines, start, end);
    result.description = lines
      .slice(end + 1)
      .join("\n")
      .trim();
    return result;
  }

  /** Get files changed in current branch vs main/master */
  private async getChangedFiles(projectRoot: string): Promise<string[] | null> {
    const baseBranch = await findBaseBranch(projectRoot);
    if (!baseBranch) {
      return null;
    }

    try {
      const result = await execa("git", ["diff", "--name-only", `${baseBranch}...HEAD`], {
        cwd: projectRoot,
      });
      return result.stdout.trim().split("\n").filter(Boolean);
    } catch {
      return null;
    }
  }

  /** Check if any changed files match the require_for_paths patterns */
  private hasChangesRequiringChangeset(changedFiles: string[]): boolean {
    const requirePaths = this.config.require_for_paths;
    const excludePaths = this.config.exclude_paths ?? [];

    if (!requirePaths || requirePaths.length === 0) {
      return false;
    }

    return changedFiles.some((file) => {
      const isExcluded = excludePaths.some((pattern) => minimatch(file, pattern));
      if (isExcluded) {
        return false;
      }
      return requirePaths.some((pattern) => minimatch(file, pattern));
    });
  }

  /** Validate changeset format (packages in frontmatter) */
  private validateFormat(changeset: ParsedChangeset): Violation[] {
    const violations: Violation[] = [];

    if (changeset.packages.size === 0) {
      violations.push({
        rule: `${this.rule}.format`,
        tool: this.toolId,
        message: "Changeset has no package entries in frontmatter",
        severity: "error",
        file: changeset.filePath,
      });
    }

    return violations;
  }

  /** Validate bump types against allowed list */
  private validateBumpTypes(changeset: ParsedChangeset): Violation[] {
    const violations: Violation[] = [];
    const allowed = this.config.allowed_bump_types;

    if (!allowed || allowed.length === 0) {
      return violations;
    }

    for (const [pkg, bumpType] of changeset.packages) {
      if (!allowed.includes(bumpType)) {
        violations.push({
          rule: `${this.rule}.bump_type`,
          tool: this.toolId,
          message: `Package "${pkg}" has bump type "${bumpType}" but only ${allowed.join(", ")} are allowed`,
          severity: "error",
          file: changeset.filePath,
        });
      }
    }

    return violations;
  }

  /** Validate description requirements */
  private validateDescription(changeset: ParsedChangeset): Violation[] {
    const violations: Violation[] = [];

    if (this.config.require_description === false) {
      return violations;
    }

    if (!changeset.description) {
      violations.push({
        rule: `${this.rule}.description`,
        tool: this.toolId,
        message: "Changeset has no description",
        severity: "error",
        file: changeset.filePath,
      });
      return violations;
    }

    const minLen = this.config.min_description_length;
    if (minLen && changeset.description.length < minLen) {
      violations.push({
        rule: `${this.rule}.description`,
        tool: this.toolId,
        message: `Changeset description is ${changeset.description.length} characters, minimum is ${minLen}`,
        severity: "error",
        file: changeset.filePath,
      });
    }

    return violations;
  }

  /** Validate a single changeset file */
  private validateChangeset(changeset: ParsedChangeset): Violation[] {
    if (changeset.parseError) {
      return [
        {
          rule: `${this.rule}.format`,
          tool: this.toolId,
          message: `Invalid changeset format: ${changeset.parseError}`,
          severity: "error",
          file: changeset.filePath,
        },
      ];
    }

    const violations: Violation[] = [];

    if (this.config.validate_format !== false) {
      violations.push(...this.validateFormat(changeset));
      violations.push(...this.validateBumpTypes(changeset));
    }

    violations.push(...this.validateDescription(changeset));

    return violations;
  }

  /** Check if changeset directory exists */
  private checkDirectoryExists(projectRoot: string, elapsed: () => number): CheckResult | null {
    if (!this.directoryExists(projectRoot, ".changeset")) {
      return this.fromViolations(
        [
          {
            rule: `${this.rule}.directory`,
            tool: this.toolId,
            message: "No .changeset directory found. Run 'pnpm exec changeset init' to initialize.",
            severity: "error",
          },
        ],
        elapsed()
      );
    }
    return null;
  }

  /** Check if changes require a changeset */
  private async checkChangesRequireChangeset(
    projectRoot: string,
    changesetFiles: string[],
    _elapsed: () => number
  ): Promise<{ skip?: string; violations: Violation[] }> {
    const requirePaths = this.config.require_for_paths;

    if (!requirePaths || requirePaths.length === 0) {
      return { violations: [] };
    }

    const changedFiles = await this.getChangedFiles(projectRoot);

    if (changedFiles === null) {
      return {
        skip: "Could not determine changed files (not on a branch or no base branch found)",
        violations: [],
      };
    }

    const violations: Violation[] = [];

    if (this.hasChangesRequiringChangeset(changedFiles) && changesetFiles.length === 0) {
      violations.push({
        rule: `${this.rule}.required`,
        tool: this.toolId,
        message: `Changes to files matching ${requirePaths.join(", ")} require a changeset. Run 'pnpm exec changeset' to create one.`,
        severity: "error",
      });
    }

    return { violations };
  }

  /** Run changeset validation */
  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    // Check directory exists
    const dirCheck = this.checkDirectoryExists(projectRoot, elapsed);
    if (dirCheck) {
      return dirCheck;
    }

    // Get changeset files
    const changesetFiles = this.getChangesetFiles(projectRoot);

    // Check if changes require changeset
    const { skip, violations } = await this.checkChangesRequireChangeset(
      projectRoot,
      changesetFiles,
      elapsed
    );
    if (skip) {
      return this.skip(skip, elapsed());
    }

    // Validate each changeset file
    for (const file of changesetFiles) {
      const parsed = this.parseChangesetFile(projectRoot, file);
      violations.push(...this.validateChangeset(parsed));
    }

    return violations.length > 0
      ? this.fromViolations(violations, elapsed())
      : this.pass(elapsed());
  }
}
