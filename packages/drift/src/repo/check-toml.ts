/**
 * TOML validation utilities for standards.toml files.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { parse as parseToml } from "smol-toml";

export interface CheckTomlValidation {
  path: string;
  valid: boolean;
  error?: string;
}

export interface CheckTomlValidationResult {
  validations: CheckTomlValidation[];
  allValid: boolean;
  firstError?: string;
}

/**
 * Validate a standards.toml file by parsing its TOML content.
 * Returns validation result with any parse errors.
 */
export function validateCheckToml(
  repoPath: string,
  checkTomlPath: string
): CheckTomlValidation {
  const fullPath = join(repoPath, checkTomlPath);
  try {
    const content = readFileSync(fullPath, "utf-8");
    parseToml(content);
    return { path: checkTomlPath, valid: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown parse error";
    return { path: checkTomlPath, valid: false, error: msg };
  }
}

/**
 * Validate all standards.toml files in a repository.
 */
export function validateAllCheckToml(
  repoPath: string,
  checkTomlPaths: string[]
): CheckTomlValidationResult {
  const validations = checkTomlPaths.map((path) =>
    validateCheckToml(repoPath, path)
  );
  const invalid = validations.find((v) => !v.valid);
  return {
    validations,
    allValid: !invalid,
    firstError: invalid
      ? `Invalid TOML in ${invalid.path}: ${invalid.error}`
      : undefined,
  };
}
