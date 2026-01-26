import * as path from "node:path";

import { glob } from "glob";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseToolRunner } from "./base.js";

/** Supported case types */
type CaseType = "kebab-case" | "snake_case" | "camelCase" | "PascalCase";

/** Single naming rule configuration */
interface NamingRule {
  extensions: string[];
  file_case: CaseType;
  folder_case: CaseType;
  exclude?: string[];
  allow_dynamic_routes?: boolean;
}

/** Configuration for naming validation */
interface NamingConfig {
  enabled?: boolean;
  rules?: NamingRule[];
}

/** Default directories to exclude */
const DEFAULT_EXCLUDE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  ".nuxt",
  "coverage",
];

/**
 * Check if a string matches kebab-case (lowercase with hyphens)
 * Also allows pure numeric names like "404" for Next.js pages
 */
function isKebabCase(str: string): boolean {
  // Allow pure numeric names (e.g., 404, 500)
  if (/^\d+$/.test(str)) {
    return true;
  }
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(str);
}

/**
 * Check if a string matches snake_case (lowercase with underscores)
 * Also allows pure numeric names like "404" for Next.js pages
 */
function isSnakeCase(str: string): boolean {
  // Allow pure numeric names (e.g., 404, 500)
  if (/^\d+$/.test(str)) {
    return true;
  }
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(str);
}

/**
 * Check if a string matches camelCase (starts lowercase, no separators)
 * Also allows pure numeric names like "404" for Next.js pages
 */
function isCamelCase(str: string): boolean {
  // Allow pure numeric names (e.g., 404, 500)
  if (/^\d+$/.test(str)) {
    return true;
  }
  return /^[a-z][a-zA-Z0-9]*$/.test(str);
}

/**
 * Check if a string matches PascalCase (starts uppercase, no separators)
 * Also allows pure numeric names like "404" for Next.js pages
 */
function isPascalCase(str: string): boolean {
  // Allow pure numeric names (e.g., 404, 500)
  if (/^\d+$/.test(str)) {
    return true;
  }
  return /^[A-Z][a-zA-Z0-9]*$/.test(str);
}

/**
 * Check if a string matches the specified case type
 */
function matchesCase(str: string, caseType: CaseType): boolean {
  switch (caseType) {
    case "kebab-case":
      return isKebabCase(str);
    case "snake_case":
      return isSnakeCase(str);
    case "camelCase":
      return isCamelCase(str);
    case "PascalCase":
      return isPascalCase(str);
    default: {
      const exhaustiveCheck: never = caseType;
      throw new Error(`Unknown case type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Get the base name of a file without extension
 * Handles multiple extensions like .test.ts, .spec.js
 */
function getBaseName(filePath: string): string {
  const fileName = path.basename(filePath);
  // Remove all extensions (e.g., foo.test.ts -> foo)
  const parts = fileName.split(".");
  return parts[0];
}

/**
 * Check if a file should be skipped (special files like __init__.py)
 */
function isSpecialFile(baseName: string): boolean {
  // Skip files that start with underscore (Python special files like __init__, __main__)
  if (baseName.startsWith("_")) {
    return true;
  }
  return false;
}

/**
 * Dynamic route patterns for Next.js/Remix folder names.
 * Order matters: more specific patterns must come first.
 */
const DYNAMIC_ROUTE_PATTERNS = [
  /^\[\[\.\.\.([^\]]+)\]\]$/, // [[...slug]] - optional catch-all
  /^\[\.\.\.([^\]]+)\]$/, // [...slug] - catch-all
  /^\[([^\]]+)\]$/, // [id] - dynamic segment
  /^\(([^)]+)\)$/, // (group) - route group
];

/**
 * Extract the inner content from a dynamic route folder pattern.
 * Handles Next.js/Remix patterns:
 * - [id] → "id"
 * - [...slug] → "slug"
 * - [[...slug]] → "slug"
 * - (group) → "group"
 * - @parallel → "parallel"
 *
 * Returns null if the folder is not a dynamic route pattern.
 */
function extractDynamicRouteContent(folderName: string): string | null {
  // @parallel - parallel route (prefix pattern, not regex)
  if (folderName.startsWith("@")) {
    return folderName.slice(1);
  }

  // Try each pattern in order
  for (const pattern of DYNAMIC_ROUTE_PATTERNS) {
    const match = pattern.exec(folderName);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Naming conventions runner for checking file and folder names
 */
export class NamingRunner extends BaseToolRunner {
  readonly name = "Naming";
  readonly rule = "code.naming";
  readonly toolId = "naming";
  readonly configFiles: string[] = []; // No config file needed

  private config: NamingConfig = {};

  /**
   * Set the configuration for this runner
   */
  setConfig(config: NamingConfig): void {
    this.config = config;
  }

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    const rules = this.config.rules ?? [];
    if (rules.length === 0) {
      return this.pass(Date.now() - startTime);
    }

    try {
      const ruleResults = await Promise.all(rules.map((rule) => this.checkRule(projectRoot, rule)));
      const violations = ruleResults.flat();

      if (violations.length === 0) {
        return this.pass(Date.now() - startTime);
      }

      return this.fail(violations, Date.now() - startTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return this.fail(
        [this.createErrorViolation(`Naming validation error: ${message}`)],
        Date.now() - startTime
      );
    }
  }

  /**
   * Check a single naming rule against the project
   */
  private async checkRule(projectRoot: string, rule: NamingRule): Promise<Violation[]> {
    const pattern = this.buildGlobPattern(rule.extensions);

    // Combine default excludes with rule-specific excludes
    const ignorePatterns = DEFAULT_EXCLUDE.map((dir) => `**/${dir}/**`);
    if (rule.exclude) {
      ignorePatterns.push(...rule.exclude);
    }

    const files = await glob(pattern, {
      cwd: projectRoot,
      ignore: ignorePatterns,
      nodir: true,
    });

    const { violations: fileViolations, folders } = this.checkFiles(files, rule);
    const folderViolations = this.checkFolders(
      folders,
      rule.folder_case,
      rule.allow_dynamic_routes
    );

    return [...fileViolations, ...folderViolations];
  }

  /**
   * Check file names and collect folders containing matching files
   */
  private checkFiles(
    files: string[],
    rule: NamingRule
  ): { violations: Violation[]; folders: Set<string> } {
    const violations: Violation[] = [];
    const folders = new Set<string>();

    for (const file of files) {
      const baseName = getBaseName(file);

      if (!baseName || isSpecialFile(baseName)) {
        continue;
      }

      if (!matchesCase(baseName, rule.file_case)) {
        violations.push(this.createFileViolation(file, baseName, rule.file_case));
      }

      const folderPath = path.dirname(file);
      if (folderPath && folderPath !== ".") {
        folders.add(folderPath);
      }
    }

    return { violations, folders };
  }

  /**
   * Check folder names for all folders containing matching files
   */
  private checkFolders(
    foldersWithMatchingFiles: Set<string>,
    expectedCase: CaseType,
    allowDynamicRoutes?: boolean
  ): Violation[] {
    const violations: Violation[] = [];
    const checkedFolders = new Set<string>();

    for (const folderPath of foldersWithMatchingFiles) {
      const folderViolations = this.checkFolderPath(
        folderPath,
        expectedCase,
        checkedFolders,
        allowDynamicRoutes
      );
      violations.push(...folderViolations);
    }

    return violations;
  }

  /**
   * Get the name to validate from a folder segment, handling dynamic routes
   */
  private getNameToValidate(segment: string, allowDynamicRoutes?: boolean): string {
    if (!allowDynamicRoutes) {
      return segment;
    }
    const innerContent = extractDynamicRouteContent(segment);
    return innerContent ?? segment;
  }

  /**
   * Check all segments of a folder path
   */
  private checkFolderPath(
    folderPath: string,
    expectedCase: CaseType,
    checkedFolders: Set<string>,
    allowDynamicRoutes?: boolean
  ): Violation[] {
    const violations: Violation[] = [];
    const segments = folderPath.split(path.sep);
    let currentPath = "";

    for (const segment of segments) {
      currentPath = currentPath ? path.join(currentPath, segment) : segment;

      if (checkedFolders.has(currentPath) || DEFAULT_EXCLUDE.includes(segment)) {
        continue;
      }
      checkedFolders.add(currentPath);

      const nameToValidate = this.getNameToValidate(segment, allowDynamicRoutes);
      if (!matchesCase(nameToValidate, expectedCase)) {
        violations.push(this.createFolderViolation(currentPath, segment, expectedCase));
      }
    }

    return violations;
  }

  /**
   * Build a glob pattern for the given extensions
   */
  private buildGlobPattern(extensions: string[]): string {
    // Deduplicate extensions to avoid glob pattern issues
    const unique = [...new Set(extensions)];
    if (unique.length === 1) {
      return `**/*.${unique[0]}`;
    }
    return `**/*.{${unique.join(",")}}`;
  }

  private createFileViolation(file: string, baseName: string, expectedCase: CaseType): Violation {
    return {
      rule: `${this.rule}.${this.toolId}`,
      tool: this.toolId,
      file,
      message: `File "${baseName}" should be ${expectedCase}`,
      code: "file-case",
      severity: "error",
    };
  }

  private createFolderViolation(
    folderPath: string,
    folderName: string,
    expectedCase: CaseType
  ): Violation {
    return {
      rule: `${this.rule}.${this.toolId}`,
      tool: this.toolId,
      file: folderPath,
      message: `Folder "${folderName}" should be ${expectedCase}`,
      code: "folder-case",
      severity: "error",
    };
  }

  private createErrorViolation(message: string): Violation {
    return {
      rule: `${this.rule}.${this.toolId}`,
      tool: this.toolId,
      message,
      severity: "error",
    };
  }

  /**
   * Audit - for naming, we just verify the config is valid
   */
  override async audit(_projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    // Naming validation doesn't require external config files
    // Just verify the rules are valid
    const rules = this.config.rules ?? [];

    for (const rule of rules) {
      if (rule.extensions.length === 0) {
        return {
          name: `${this.name} Config`,
          rule: this.rule,
          passed: false,
          violations: [
            {
              rule: `${this.rule}.${this.toolId}`,
              tool: "audit",
              message: "Naming rule must have at least one extension",
              severity: "error",
            },
          ],
          skipped: false,
          duration: Date.now() - startTime,
        };
      }
    }

    return {
      name: `${this.name} Config`,
      rule: this.rule,
      passed: true,
      violations: [],
      skipped: false,
      duration: Date.now() - startTime,
    };
  }
}
