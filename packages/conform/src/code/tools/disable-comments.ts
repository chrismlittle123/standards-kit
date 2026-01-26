import * as fs from "node:fs";
import * as path from "node:path";

import { glob } from "glob";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseToolRunner } from "./base.js";
import {
  findBlockEnd,
  findCommentInLine,
  findFirstPattern,
  KNOWN_EXTENSIONS,
} from "./comment-utils.js";

/** Default patterns to detect disable comments */
const DEFAULT_PATTERNS = [
  // ESLint
  "eslint-disable",
  "eslint-disable-line",
  "eslint-disable-next-line",
  // TypeScript
  "@ts-ignore",
  "@ts-expect-error",
  "@ts-nocheck",
  // Python
  "# noqa",
  "# type: ignore",
  "# pylint: disable",
  "# pragma: no cover",
];

/** Default file extensions to scan */
const DEFAULT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "py"];

/** Default directories to exclude */
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/coverage/**",
];

/** Configuration for disable-comments validation */
interface DisableCommentsConfig {
  enabled?: boolean;
  patterns?: string[];
  extensions?: string[];
  exclude?: string[];
}

/** Context for scanning a file */
interface ScanContext {
  file: string;
  patterns: string[];
  inBlockComment: boolean;
}

/** Violation data */
interface ViolationData {
  line: number;
  pattern: string;
  content: string;
}

/** Line scan result */
interface LineScanResult {
  violation: ViolationData | null;
  inBlockComment: boolean;
}

/** Line scan parameters */
interface LineScanParams {
  line: string;
  lineNum: number;
  ext: string;
  patterns: string[];
}

/**
 * Disable comments runner for detecting linter/type-checker disable comments
 */
export class DisableCommentsRunner extends BaseToolRunner {
  readonly name = "Disable Comments";
  readonly rule = "code.quality";
  readonly toolId = "disable-comments";
  readonly configFiles: string[] = []; // No config file needed

  private config: DisableCommentsConfig = {};

  setConfig(config: DisableCommentsConfig): void {
    this.config = config;
  }

  private getPatterns(): string[] {
    return this.config.patterns ?? DEFAULT_PATTERNS;
  }

  private getExtensions(): string[] {
    return this.config.extensions ?? DEFAULT_EXTENSIONS;
  }

  private getExcludePatterns(): string[] {
    return [...DEFAULT_EXCLUDE, ...(this.config.exclude ?? [])];
  }

  private buildGlobPattern(): string {
    const extensions = this.getExtensions();
    const unique = [...new Set(extensions)];
    if (unique.length === 1) {
      return `**/*.${unique[0]}`;
    }
    return `**/*.{${unique.join(",")}}`;
  }

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    try {
      const files = await glob(this.buildGlobPattern(), {
        cwd: projectRoot,
        ignore: this.getExcludePatterns(),
        nodir: true,
      });

      if (files.length === 0) {
        return this.pass(Date.now() - startTime);
      }

      const violations = this.scanAllFiles(projectRoot, files);
      return this.fromViolations(violations, Date.now() - startTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return this.fail(
        [this.createErrorViolation(`Disable comments check error: ${message}`)],
        Date.now() - startTime
      );
    }
  }

  private scanAllFiles(projectRoot: string, files: string[]): Violation[] {
    const violations: Violation[] = [];
    const patterns = this.getPatterns();

    for (const file of files) {
      const filePath = path.join(projectRoot, file);
      violations.push(...this.scanFile(filePath, { file, patterns, inBlockComment: false }));
    }

    return violations;
  }

  private scanFile(absolutePath: string, ctx: ScanContext): Violation[] {
    try {
      const content = fs.readFileSync(absolutePath, "utf-8");
      return this.scanContent(content, ctx);
    } catch {
      return []; // Skip unreadable files
    }
  }

  private scanContent(content: string, ctx: ScanContext): Violation[] {
    const lines = content.split("\n");
    const ext = path.extname(ctx.file).slice(1).toLowerCase();
    const violations: Violation[] = [];
    let inBlock = ctx.inBlockComment;

    for (let i = 0; i < lines.length; i++) {
      const params: LineScanParams = {
        line: lines[i],
        lineNum: i + 1,
        ext,
        patterns: ctx.patterns,
      };
      const result = this.scanLine(params, inBlock);
      if (result.violation) {
        violations.push(this.createViolation(ctx.file, result.violation));
      }
      inBlock = result.inBlockComment;
    }

    return violations;
  }

  private scanLine(params: LineScanParams, inBlock: boolean): LineScanResult {
    const { ext } = params;
    if (ext === "py" || !KNOWN_EXTENSIONS.has(ext)) {
      return { violation: this.scanSimpleLine(params), inBlockComment: false };
    }
    return this.scanJsLine(params, inBlock);
  }

  private scanSimpleLine(params: LineScanParams): ViolationData | null {
    const { line, lineNum, ext, patterns } = params;
    for (const pattern of patterns) {
      if (this.isPatternInComment(line, pattern, ext)) {
        return { line: lineNum, pattern, content: line };
      }
    }
    return null;
  }

  private scanJsLine(params: LineScanParams, inBlock: boolean): LineScanResult {
    const { line, lineNum, patterns } = params;
    return this.processJsLineComments(line, lineNum, patterns, inBlock);
  }

  private processJsLineComments(
    line: string,
    lineNum: number,
    patterns: string[],
    inBlock: boolean
  ): LineScanResult {
    let state = { pos: 0, inBlock };

    while (state.pos < line.length) {
      const r = state.inBlock
        ? this.handleInsideBlock(line, lineNum, patterns, state.pos)
        : this.handleOutsideBlock(line, lineNum, patterns, state.pos);

      if (r.done) {
        return r.result;
      }
      state = { pos: r.nextPos, inBlock: r.enterBlock ?? false };
      if (r.enterBlock) {
        break;
      }
    }

    return { violation: null, inBlockComment: state.inBlock };
  }

  private handleInsideBlock(
    line: string,
    lineNum: number,
    patterns: string[],
    pos: number
  ): { done: boolean; result: LineScanResult; nextPos: number; enterBlock?: boolean } {
    const blockEnd = findBlockEnd(line, pos);
    const text = line.slice(pos, blockEnd === -1 ? line.length : blockEnd);
    const pattern = findFirstPattern(text, patterns);

    if (pattern) {
      return {
        done: true,
        result: {
          violation: { line: lineNum, pattern, content: line },
          inBlockComment: blockEnd === -1,
        },
        nextPos: 0,
      };
    }
    if (blockEnd === -1) {
      return { done: true, result: { violation: null, inBlockComment: true }, nextPos: 0 };
    }
    return { done: false, result: { violation: null, inBlockComment: false }, nextPos: blockEnd };
  }

  private handleOutsideBlock(
    line: string,
    lineNum: number,
    patterns: string[],
    pos: number
  ): { done: boolean; result: LineScanResult; nextPos: number; enterBlock: boolean } {
    const comment = findCommentInLine(line, pos, false);
    if (!comment) {
      return {
        done: true,
        result: { violation: null, inBlockComment: false },
        nextPos: 0,
        enterBlock: false,
      };
    }
    if (!comment.isBlock) {
      return this.handleLineComment(line, lineNum, patterns, comment.index);
    }
    return this.handleBlockCommentStart(line, lineNum, patterns, comment.index);
  }

  private handleLineComment(
    line: string,
    lineNum: number,
    patterns: string[],
    index: number
  ): { done: boolean; result: LineScanResult; nextPos: number; enterBlock: boolean } {
    const pattern = findFirstPattern(line.slice(index), patterns);
    const result: LineScanResult = pattern
      ? { violation: { line: lineNum, pattern, content: line }, inBlockComment: false }
      : { violation: null, inBlockComment: false };
    return { done: true, result, nextPos: 0, enterBlock: false };
  }

  private handleBlockCommentStart(
    line: string,
    lineNum: number,
    patterns: string[],
    index: number
  ): { done: boolean; result: LineScanResult; nextPos: number; enterBlock: boolean } {
    const blockEnd = findBlockEnd(line, index + 2);
    const text = line.slice(index + 2, blockEnd === -1 ? line.length : blockEnd);
    const pattern = findFirstPattern(text, patterns);

    if (pattern) {
      return {
        done: true,
        result: {
          violation: { line: lineNum, pattern, content: line },
          inBlockComment: blockEnd === -1,
        },
        nextPos: 0,
        enterBlock: false,
      };
    }
    if (blockEnd === -1) {
      return {
        done: false,
        result: { violation: null, inBlockComment: true },
        nextPos: 0,
        enterBlock: true,
      };
    }
    return {
      done: false,
      result: { violation: null, inBlockComment: false },
      nextPos: blockEnd,
      enterBlock: false,
    };
  }

  /** Check if a pattern appears in a comment (not in a string) - for simple line detection */
  private isPatternInComment(line: string, pattern: string, extension: string): boolean {
    if (!line.includes(pattern)) {
      return false;
    }
    if (!KNOWN_EXTENSIONS.has(extension)) {
      return true;
    }

    const comment = findCommentInLine(line, 0, extension === "py");
    if (!comment) {
      return false;
    }

    const patternIndex = line.indexOf(pattern);
    return comment.index <= patternIndex;
  }

  private createViolation(file: string, data: ViolationData): Violation {
    const trimmed = data.content.trim();
    const display = trimmed.length > 60 ? `${trimmed.substring(0, 60)}...` : trimmed;

    return {
      rule: `${this.rule}.${this.toolId}`,
      tool: this.toolId,
      file,
      line: data.line,
      message: `Found "${data.pattern}" comment: ${display}`,
      code: data.pattern,
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

  override async audit(_projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();

    const patterns = this.getPatterns();
    if (patterns.length === 0) {
      return this.fail(
        [
          {
            rule: `${this.rule}.${this.toolId}`,
            tool: "audit",
            message: "At least one pattern must be configured",
            severity: "error",
          },
        ],
        Date.now() - startTime
      );
    }

    return this.pass(Date.now() - startTime);
  }
}
