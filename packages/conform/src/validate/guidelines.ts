/**
 * Validate guideline markdown files against the frontmatter schema
 */
import * as fs from "node:fs";
import * as path from "node:path";

import chalk from "chalk";
import matter from "gray-matter";

import { frontmatterSchema } from "../mcp/standards/index.js";
import { ExitCode } from "../core/index.js";

/** Single file validation error */
interface GuidelineValidationError {
  file: string;
  errors: string[];
}

/** Overall validation result */
interface GuidelineValidationResult {
  valid: boolean;
  validCount: number;
  invalidCount: number;
  errors: GuidelineValidationError[];
}

/** Format text output for validation result */
function formatTextOutput(result: GuidelineValidationResult): string {
  if (result.valid) {
    return chalk.green(`✓ All ${result.validCount} guideline(s) valid`);
  }
  const lines = [chalk.red(`✗ Found ${result.invalidCount} invalid guideline(s)`), ""];
  for (const err of result.errors) {
    lines.push(chalk.red(`  ${err.file}:`));
    for (const e of err.errors) {
      lines.push(chalk.red(`    - ${e}`));
    }
  }
  return lines.join("\n");
}

/** Validate a directory of guideline files */
function validateGuidelinesDir(dirPath: string): GuidelineValidationResult {
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".md"));
  const result: GuidelineValidationResult = {
    valid: true,
    validCount: 0,
    invalidCount: 0,
    errors: [],
  };

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const { data } = matter(content);

    const parseResult = frontmatterSchema.safeParse(data);
    if (parseResult.success) {
      result.validCount++;
    } else {
      result.valid = false;
      result.invalidCount++;
      result.errors.push({
        file,
        errors: parseResult.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`),
      });
    }
  }

  return result;
}

/** Output error and exit */
function exitWithError(error: string, format: string): never {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({ valid: false, error }, null, 2)}\n`);
  } else {
    console.error(chalk.red(`✗ ${error}`));
  }
  process.exit(ExitCode.CONFIG_ERROR);
}

/** Resolve and validate directory path */
function resolveAndValidatePath(dirPath: string, format: string): string {
  const resolvedPath = path.isAbsolute(dirPath) ? dirPath : path.resolve(process.cwd(), dirPath);

  if (!fs.existsSync(resolvedPath)) {
    exitWithError(`Path does not exist: ${resolvedPath}`, format);
  }

  const stats = fs.statSync(resolvedPath);
  if (!stats.isDirectory()) {
    exitWithError(`Path is not a directory: ${resolvedPath}`, format);
  }

  return resolvedPath;
}

/** Run the validate guidelines command */
export async function runValidateGuidelines(
  dirPath: string,
  options: { format: string }
): Promise<void> {
  const resolvedPath = resolveAndValidatePath(dirPath, options.format);
  const result = validateGuidelinesDir(resolvedPath);

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatTextOutput(result)}\n`);
  }

  process.exit(result.valid ? ExitCode.SUCCESS : ExitCode.CONFIG_ERROR);
}
