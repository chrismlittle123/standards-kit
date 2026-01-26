/**
 * Utilities for creating and summarizing drift results.
 */

import type { DriftResults, OrgScanSummary } from "../types.js";

/**
 * Create an empty drift results object
 *
 * @param path - The path being scanned
 * @returns A new DriftResults object
 */
export function createEmptyResults(path: string): DriftResults {
  return {
    path,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create an empty organization scan summary
 */
export function createEmptyOrgSummary(): OrgScanSummary {
  return {
    reposScanned: 0,
    reposWithIssues: 0,
    reposSkipped: 0,
  };
}
