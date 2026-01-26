/**
 * Tier validation using @standards-kit/conform's `conform validate tier` command.
 * Validates that repositories use tier-appropriate rulesets.
 */

import { execSync } from "child_process";
import type { TierValidationResult } from "../types.js";

/** Timeout for cm command execution (30 seconds) */
const CM_TIMEOUT = 30 * 1000;

/**
 * Raw JSON output format from `conform validate tier --format json`
 */
interface CmValidateTierOutput {
  valid: boolean;
  tier: string;
  tierSource: string;
  rulesets: string[];
  expectedPattern: string;
  matchedRulesets: string[];
  error?: string;
}

/**
 * Validate tier-ruleset alignment for a repository.
 * Uses the `conform validate tier` command from @standards-kit/conform.
 *
 * @param repoPath - Path to the repository root
 * @returns TierValidationResult or null if validation cannot be performed
 */
export function validateTierRuleset(
  repoPath: string
): TierValidationResult | null {
  try {
    const result = execSync("conform validate tier --format json", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: CM_TIMEOUT,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const parsed = JSON.parse(result) as CmValidateTierOutput;

    return {
      valid: parsed.valid,
      tier: parsed.tier,
      rulesets: parsed.rulesets,
      expectedPattern: parsed.expectedPattern,
      matchedRulesets: parsed.matchedRulesets,
      error: parsed.error,
    };
  } catch (error) {
    // Check if it's a command execution error with output
    if (error && typeof error === "object" && "stdout" in error) {
      const execError = error as { stdout?: string; stderr?: string };
      if (execError.stdout) {
        try {
          const parsed = JSON.parse(execError.stdout) as CmValidateTierOutput;
          return {
            valid: parsed.valid,
            tier: parsed.tier,
            rulesets: parsed.rulesets,
            expectedPattern: parsed.expectedPattern,
            matchedRulesets: parsed.matchedRulesets,
            error: parsed.error,
          };
        } catch {
          // JSON parse failed, fall through to null
        }
      }
    }
    // Graceful fallback if cm not available or command fails
    return null;
  }
}

/**
 * Check if a tier validation result indicates a mismatch.
 *
 * @param result - The tier validation result
 * @returns true if there's a tier-ruleset mismatch
 */
export function hasTierMismatch(result: TierValidationResult | null): boolean {
  return result !== null && !result.valid;
}
