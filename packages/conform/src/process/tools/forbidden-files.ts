import { glob } from "glob";

import { DEFAULT_FORBIDDEN_FILES_IGNORE } from "../../core/index.js";
import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";

/** Forbidden files configuration */
interface ForbiddenFilesConfig {
  enabled?: boolean;
  files?: string[];
  ignore?: string[];
  message?: string;
}

/**
 * Runner for forbidden files validation.
 * Validates that certain files do NOT exist anywhere in the repository.
 */
export class ForbiddenFilesRunner extends BaseProcessToolRunner {
  readonly name = "Forbidden Files";
  readonly rule = "process.forbidden_files";
  readonly toolId = "forbidden-files";

  private config: ForbiddenFilesConfig = { enabled: false };

  setConfig(config: ForbiddenFilesConfig): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Run check - scans for forbidden files using glob patterns
   */
  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    const patterns = this.config.files ?? [];
    if (patterns.length === 0) {
      return this.pass(elapsed());
    }

    // Process all patterns in parallel for better performance
    const results = await Promise.all(
      patterns.map(async (pattern) => {
        const foundFiles = await this.findForbiddenFiles(projectRoot, pattern);
        return foundFiles.map((file) => this.createViolation(file, pattern));
      })
    );

    // Deduplicate violations by file path (fix #181)
    // Keep only the first violation for each file
    const allViolations = results.flat();
    const seenFiles = new Set<string>();
    const violations: Violation[] = [];
    for (const violation of allViolations) {
      if (violation.file && !seenFiles.has(violation.file)) {
        seenFiles.add(violation.file);
        violations.push(violation);
      }
    }

    return this.fromViolations(violations, elapsed());
  }

  /**
   * Find files matching a forbidden pattern
   */
  private async findForbiddenFiles(projectRoot: string, pattern: string): Promise<string[]> {
    // Determine ignore patterns:
    // - If ignore is explicitly set (including empty array), use it (fix #185)
    // - If ignore is undefined (not set), use defaults
    const ignorePatterns = this.getIgnorePatterns();

    try {
      const matches = await glob(pattern, {
        cwd: projectRoot,
        dot: true,
        nodir: true,
        ignore: ignorePatterns,
      });
      return matches;
    } catch {
      return [];
    }
  }

  /**
   * Get ignore patterns, respecting explicit empty array override
   * - undefined: use defaults (node_modules, .git)
   * - []: no ignores (scan everything)
   * - [...]: use custom ignores
   */
  private getIgnorePatterns(): string[] {
    // Check if ignore was explicitly set (including empty array)
    // Object.hasOwn checks if the property exists, even if value is []
    if (Object.hasOwn(this.config, "ignore") && this.config.ignore !== undefined) {
      return this.config.ignore;
    }
    return DEFAULT_FORBIDDEN_FILES_IGNORE;
  }

  /**
   * Create a violation for a forbidden file
   */
  private createViolation(file: string, pattern: string): Violation {
    const customMessage = this.config.message;
    const baseMessage = `Forbidden file exists: ${file} (matched pattern: ${pattern})`;
    const message = customMessage ? `${baseMessage}. ${customMessage}` : baseMessage;

    return {
      rule: `${this.rule}.exists`,
      tool: this.toolId,
      file,
      message,
      severity: "error",
    };
  }
}
