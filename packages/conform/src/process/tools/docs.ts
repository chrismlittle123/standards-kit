import * as fs from "node:fs";
import * as path from "node:path";

import { execa } from "execa";
import { glob } from "glob";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";
import {
  type DocsConfig,
  type DocTypeConfig,
  escapeRegex,
  type ExportInfo,
  extractFileExports,
  getTrackedPath,
  type ParsedDoc,
  parseMarkdownFile,
} from "./docs-helpers.js";

/**
 * Documentation governance runner.
 * Validates documentation structure, content, freshness, and API coverage.
 */
export class DocsRunner extends BaseProcessToolRunner {
  readonly name = "Documentation";
  readonly rule = "process.docs";
  readonly toolId = "docs";

  private config: DocsConfig = {
    enabled: false,
    path: "docs/",
    enforcement: "warn",
    staleness_days: 30,
  };

  setConfig(config: DocsConfig): void {
    this.config = { ...this.config, ...config };
  }

  private getSeverity(): "error" | "warning" {
    return this.config.enforcement === "block" ? "error" : "warning";
  }

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    const violations: Violation[] = [];
    violations.push(...(await this.checkStructure(projectRoot)));
    violations.push(...(await this.checkContent(projectRoot)));
    violations.push(...(await this.checkFreshness(projectRoot)));
    violations.push(...(await this.checkApiCoverage(projectRoot)));

    return this.fromViolations(violations, elapsed());
  }

  // ===========================================================================
  // Structure Enforcement
  // ===========================================================================

  private async checkStructure(projectRoot: string): Promise<Violation[]> {
    const docsPath = this.config.path ?? "docs/";
    const allowlist = new Set(this.config.allowlist ?? []);

    const allMdFiles = await glob("**/*.md", {
      cwd: projectRoot,
      ignore: ["node_modules/**", ".git/**", "dist/**", ".changeset/**"],
      nodir: true,
    });

    const violations = this.checkAllowlist(allMdFiles, docsPath, allowlist);
    const docsFiles = allMdFiles.filter((f) => f.startsWith(docsPath));

    violations.push(...this.checkFileLimits(projectRoot, docsFiles));

    return violations;
  }

  private checkAllowlist(files: string[], docsPath: string, allowlist: Set<string>): Violation[] {
    const violations: Violation[] = [];
    for (const file of files) {
      const isInDocs = file.startsWith(docsPath);
      const isAllowlisted = allowlist.has(file) || allowlist.has(path.basename(file));
      if (!isInDocs && !isAllowlisted) {
        violations.push({
          rule: `${this.rule}.structure`,
          tool: this.toolId,
          file,
          message: `Markdown file outside ${docsPath} is not allowlisted`,
          severity: this.getSeverity(),
        });
      }
    }
    return violations;
  }

  private checkFileLimits(projectRoot: string, docsFiles: string[]): Violation[] {
    const violations: Violation[] = [];

    if (this.config.max_files !== undefined && docsFiles.length > this.config.max_files) {
      violations.push({
        rule: `${this.rule}.structure`,
        tool: this.toolId,
        message: `Documentation has ${docsFiles.length} files, max allowed is ${this.config.max_files}`,
        severity: this.getSeverity(),
      });
    }

    let totalKb = 0;
    for (const file of docsFiles) {
      const result = this.checkSingleFileLimit(projectRoot, file);
      totalKb += result.sizeKb;
      violations.push(...result.violations);
    }

    if (this.config.max_total_kb !== undefined && totalKb > this.config.max_total_kb) {
      violations.push({
        rule: `${this.rule}.structure`,
        tool: this.toolId,
        message: `Total docs size is ${totalKb.toFixed(1)}KB, max allowed is ${this.config.max_total_kb}KB`,
        severity: this.getSeverity(),
      });
    }

    return violations;
  }

  private checkSingleFileLimit(
    projectRoot: string,
    file: string
  ): { sizeKb: number; violations: Violation[] } {
    const violations: Violation[] = [];
    const fullPath = path.join(projectRoot, file);

    try {
      const stats = fs.statSync(fullPath);
      const sizeKb = stats.size / 1024;

      if (this.config.max_file_lines !== undefined) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lineCount = content.split("\n").length;
        if (lineCount > this.config.max_file_lines) {
          violations.push({
            rule: `${this.rule}.structure`,
            tool: this.toolId,
            file,
            message: `File has ${lineCount} lines, max allowed is ${this.config.max_file_lines}`,
            severity: this.getSeverity(),
          });
        }
      }

      return { sizeKb, violations };
    } catch {
      return { sizeKb: 0, violations };
    }
  }

  // ===========================================================================
  // Content Validation
  // ===========================================================================

  private async checkContent(projectRoot: string): Promise<Violation[]> {
    const types = this.config.types ?? {};
    if (Object.keys(types).length === 0) {
      return [];
    }

    const docsPath = this.config.path ?? "docs/";
    const docsFiles = await glob(`${docsPath}**/*.md`, { cwd: projectRoot, nodir: true });
    const violations: Violation[] = [];

    for (const file of docsFiles) {
      violations.push(...this.validateDocFile(projectRoot, file, types));
    }

    return violations;
  }

  private validateDocFile(
    projectRoot: string,
    file: string,
    types: Record<string, DocTypeConfig>
  ): Violation[] {
    const parsed = this.parseDocFile(projectRoot, file);
    if (!parsed) {
      return [];
    }

    const violations: Violation[] = [];
    const docType = parsed.frontmatter.type as string | undefined;
    const typeConfig = docType ? types[docType] : undefined;

    if (typeConfig) {
      violations.push(
        ...this.validateFrontmatter(file, parsed.frontmatter, typeConfig.frontmatter ?? [])
      );
      violations.push(
        ...this.validateSections(file, parsed.headings, typeConfig.required_sections ?? [])
      );
    }

    violations.push(...this.validateInternalLinks(projectRoot, file, parsed.content));

    return violations;
  }

  private parseDocFile(projectRoot: string, filePath: string): ParsedDoc | null {
    const fullPath = path.join(projectRoot, filePath);
    try {
      const raw = fs.readFileSync(fullPath, "utf-8");
      return parseMarkdownFile(raw, filePath);
    } catch {
      return null;
    }
  }

  private validateFrontmatter(
    file: string,
    frontmatter: Record<string, unknown>,
    required: string[]
  ): Violation[] {
    return required
      .filter((field) => !(field in frontmatter))
      .map((field) => ({
        rule: `${this.rule}.content`,
        tool: this.toolId,
        file,
        message: `Missing required frontmatter field: ${field}`,
        severity: this.getSeverity(),
      }));
  }

  private validateSections(file: string, headings: string[], required: string[]): Violation[] {
    const headingSet = new Set(headings.map((h) => h.toLowerCase()));
    return required
      .filter((section) => !headingSet.has(section.toLowerCase()))
      .map((section) => ({
        rule: `${this.rule}.content`,
        tool: this.toolId,
        file,
        message: `Missing required section: ${section}`,
        severity: this.getSeverity(),
      }));
  }

  private validateInternalLinks(projectRoot: string, file: string, content: string): Violation[] {
    const violations: Violation[] = [];
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      const violation = this.checkSingleLink(projectRoot, file, match[2]);
      if (violation) {
        violations.push(violation);
      }
    }

    return violations;
  }

  private checkSingleLink(projectRoot: string, file: string, linkTarget: string): Violation | null {
    if (
      linkTarget.startsWith("http") ||
      linkTarget.startsWith("#") ||
      linkTarget.startsWith("mailto:")
    ) {
      return null;
    }

    const targetPath = linkTarget.split("#")[0];
    if (!targetPath) {
      return null;
    }

    const resolvedPath = path.join(projectRoot, path.dirname(file), targetPath);
    if (!fs.existsSync(resolvedPath)) {
      return {
        rule: `${this.rule}.links`,
        tool: this.toolId,
        file,
        message: `Broken internal link: ${linkTarget}`,
        severity: "warning",
      };
    }

    return null;
  }

  // ===========================================================================
  // Freshness Tracking
  // ===========================================================================

  private async checkFreshness(projectRoot: string): Promise<Violation[]> {
    const docsPath = this.config.path ?? "docs/";
    const docsFiles = await glob(`${docsPath}**/*.md`, { cwd: projectRoot, nodir: true });

    const results = await Promise.all(
      docsFiles.map((file) => this.checkFileFreshness(projectRoot, file, docsPath))
    );

    return results.filter((v): v is Violation => v !== null);
  }

  private async getTimestamps(
    projectRoot: string,
    file: string,
    trackedPath: string
  ): Promise<{ docTime: number; sourceTime: number } | null> {
    const docTime = await this.getGitLastModified(projectRoot, file);
    const sourceTime = await this.getGitLastModified(projectRoot, trackedPath);
    if (docTime === null || sourceTime === null) {
      return null;
    }
    return { docTime, sourceTime };
  }

  private createStalenessViolation(file: string, daysDiff: number, trackedPath: string): Violation {
    return {
      rule: `${this.rule}.freshness`,
      tool: this.toolId,
      file,
      message: `Doc is ${Math.round(daysDiff)} days behind tracked source: ${trackedPath}`,
      severity: this.getSeverity(),
    };
  }

  private async checkFileFreshness(
    projectRoot: string,
    file: string,
    docsPath: string
  ): Promise<Violation | null> {
    const parsed = this.parseDocFile(projectRoot, file);
    if (!parsed) {
      return null;
    }

    const staleMappings = this.config.stale_mappings ?? {};
    const trackedPath = getTrackedPath(file, parsed.frontmatter, staleMappings, docsPath);
    if (!trackedPath || !fs.existsSync(path.join(projectRoot, trackedPath))) {
      return null;
    }

    const timestamps = await this.getTimestamps(projectRoot, file, trackedPath);
    if (!timestamps) {
      return null;
    }

    const stalenessDays = this.config.staleness_days ?? 30;
    const daysDiff = (timestamps.sourceTime - timestamps.docTime) / (1000 * 60 * 60 * 24);

    return daysDiff > stalenessDays
      ? this.createStalenessViolation(file, daysDiff, trackedPath)
      : null;
  }

  private async getGitLastModified(projectRoot: string, filePath: string): Promise<number | null> {
    try {
      const result = await execa("git", ["log", "-1", "--format=%ct", "--", filePath], {
        cwd: projectRoot,
      });
      const timestamp = parseInt(result.stdout.trim(), 10);
      return isNaN(timestamp) ? null : timestamp * 1000;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // API Coverage
  // ===========================================================================

  private async checkApiCoverage(projectRoot: string): Promise<Violation[]> {
    const minCoverage = this.config.min_coverage;
    if (minCoverage === undefined) {
      return [];
    }

    const sourceFiles = await this.getSourceFiles(projectRoot);
    const exports = this.extractExports(projectRoot, sourceFiles);
    if (exports.length === 0) {
      return [];
    }

    const allDocsContent = await this.getAllDocsContent(projectRoot);
    const undocumented = exports.filter(
      (exp) => !this.isExportDocumented(exp.name, allDocsContent)
    );

    return this.buildCoverageViolations(exports.length, undocumented, minCoverage);
  }

  private async getSourceFiles(projectRoot: string): Promise<string[]> {
    const coveragePaths = this.config.coverage_paths ?? ["src/**/*.ts"];
    const excludePatterns = this.config.exclude_patterns ?? ["**/*.test.ts", "**/*.spec.ts"];

    const fileArrays = await Promise.all(
      coveragePaths.map((pattern) =>
        glob(pattern, {
          cwd: projectRoot,
          ignore: ["node_modules/**", ...excludePatterns],
          nodir: true,
        })
      )
    );

    return fileArrays.flat();
  }

  private async getAllDocsContent(projectRoot: string): Promise<string> {
    const docsPath = this.config.path ?? "docs/";
    const docsFiles = await glob(`${docsPath}**/*.md`, { cwd: projectRoot, nodir: true });

    return docsFiles.map((f) => this.readFile(projectRoot, f) ?? "").join("\n");
  }

  private isExportDocumented(exportName: string, docsContent: string): boolean {
    const regex = new RegExp(`\\b${escapeRegex(exportName)}\\b`);
    return regex.test(docsContent);
  }

  private buildCoverageViolations(
    totalExports: number,
    undocumented: ExportInfo[],
    minCoverage: number
  ): Violation[] {
    const documented = totalExports - undocumented.length;
    const coverage = (documented / totalExports) * 100;

    if (coverage >= minCoverage) {
      return [];
    }

    const violations: Violation[] = [
      {
        rule: `${this.rule}.coverage`,
        tool: this.toolId,
        message: `API documentation coverage is ${coverage.toFixed(1)}% (min: ${minCoverage}%). ${undocumented.length} undocumented exports.`,
        severity: this.getSeverity(),
      },
    ];

    const limit = 10;
    for (const exp of undocumented.slice(0, limit)) {
      violations.push({
        rule: `${this.rule}.coverage`,
        tool: this.toolId,
        file: exp.file,
        line: exp.line,
        message: `Export "${exp.name}" is not documented`,
        severity: "warning",
      });
    }

    if (undocumented.length > limit) {
      violations.push({
        rule: `${this.rule}.coverage`,
        tool: this.toolId,
        message: `...and ${undocumented.length - limit} more undocumented exports`,
        severity: "warning",
      });
    }

    return violations;
  }

  private extractExports(projectRoot: string, files: string[]): ExportInfo[] {
    const exports: ExportInfo[] = [];

    for (const file of files) {
      const content = this.readFile(projectRoot, file);
      if (!content) {
        continue;
      }
      exports.push(...extractFileExports(file, content));
    }

    return exports;
  }
}
