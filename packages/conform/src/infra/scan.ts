/**
 * Scan logic for infra scan
 *
 * Orchestrates checking all resources in a manifest (AWS and GCP)
 */

import { isValidArn, parseArn } from "./arn.js";
import { getChecker, isSupportedService, SUPPORTED_SERVICES } from "./checkers/index.js";
import {
  getGcpChecker,
  isSupportedGcpService,
  SUPPORTED_GCP_SERVICES,
} from "./checkers/gcp/index.js";
import { isValidGcpResource, parseGcpResource } from "./gcp.js";
import { getAllResources, isMultiAccountManifest } from "./manifest.js";
import type {
  AccountScanResult,
  InfraScanResult,
  InfraScanSummary,
  Manifest,
  MultiAccountManifest,
  ResourceCheckResult,
} from "./types.js";

/**
 * Default concurrency for parallel checks
 */
const DEFAULT_CONCURRENCY = 10;

/**
 * Options for scanning
 */
interface ScanOptions {
  /** Max number of parallel checks */
  concurrency?: number;
  /** Filter to specific account (by alias or account key) */
  account?: string;
}

/**
 * Scan all resources in a manifest
 *
 * @param manifest - The manifest containing resources to check
 * @param manifestPath - Path to the manifest file (for result metadata)
 * @param options - Scan options
 * @returns Scan result with all resource check results and summary
 */
export async function scanManifest(
  manifest: Manifest,
  manifestPath: string,
  options: ScanOptions = {}
): Promise<InfraScanResult> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  // For multi-account manifests, scan by account
  if (isMultiAccountManifest(manifest)) {
    return scanMultiAccountManifest(manifest, manifestPath, options);
  }

  // Legacy manifest - simple flat scan
  const resources = getAllResources(manifest);
  const results = await checkResourcesWithConcurrency(resources, concurrency);
  const summary = calculateSummary(results);

  return {
    manifest: manifestPath,
    project: manifest.project,
    results,
    summary,
  };
}

/**
 * Scan a multi-account manifest
 */
async function scanMultiAccountManifest(
  manifest: MultiAccountManifest,
  manifestPath: string,
  options: ScanOptions = {}
): Promise<InfraScanResult> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const accountResults: Record<string, AccountScanResult> = {};
  const allResults: ResourceCheckResult[] = [];

  // Get accounts to scan (filter by account if specified)
  const accountsToScan = filterAccounts(manifest, options.account);

  for (const [accountKey, account] of Object.entries(accountsToScan)) {
    const results = await checkResourcesWithConcurrency(account.resources, concurrency);
    const summary = calculateSummary(results);

    accountResults[accountKey] = {
      alias: account.alias,
      results,
      summary,
    };

    allResults.push(...results);
  }

  // Calculate overall summary
  const overallSummary = calculateSummary(allResults);

  return {
    manifest: manifestPath,
    project: manifest.project,
    results: allResults,
    summary: overallSummary,
    accountResults,
  };
}

/**
 * Filter accounts based on account filter
 * Returns matching accounts or all accounts if no filter
 */
function filterAccounts(
  manifest: MultiAccountManifest,
  accountFilter?: string
): Record<string, { alias?: string; resources: string[] }> {
  if (!accountFilter) {
    return manifest.accounts;
  }

  // Check if filter is an account key (e.g., "aws:123456")
  if (accountFilter in manifest.accounts) {
    return { [accountFilter]: manifest.accounts[accountFilter] };
  }

  // Check if filter matches an alias
  for (const [key, account] of Object.entries(manifest.accounts)) {
    if (account.alias === accountFilter) {
      return { [key]: account };
    }
  }

  // No match found - return empty
  return {};
}

/**
 * Check resources with controlled concurrency using a simple batching approach
 */
async function checkResourcesWithConcurrency(
  arns: string[],
  concurrency: number
): Promise<ResourceCheckResult[]> {
  const results: ResourceCheckResult[] = [];

  // Process in batches
  for (let i = 0; i < arns.length; i += concurrency) {
    const batch = arns.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((arn) => checkResource(arn)));
    results.push(...batchResults);
  }

  // Sort results to maintain consistent order (by ARN)
  results.sort((a, b) => a.arn.localeCompare(b.arn));

  return results;
}

/**
 * Check a single resource (AWS or GCP)
 */
async function checkResource(resource: string): Promise<ResourceCheckResult> {
  // Detect cloud provider and route to appropriate checker
  if (isValidArn(resource)) {
    return checkAwsResource(resource);
  }
  if (isValidGcpResource(resource)) {
    return checkGcpResource(resource);
  }

  return {
    arn: resource,
    exists: false,
    error: "Invalid resource format (not a valid AWS ARN or GCP resource path)",
    service: "unknown",
    resourceType: "unknown",
    resourceId: resource,
  };
}

/**
 * Check an AWS resource
 */
async function checkAwsResource(arn: string): Promise<ResourceCheckResult> {
  const parsed = parseArn(arn);
  if (!parsed) {
    return errorResult({ arn, error: "Invalid ARN format" });
  }

  if (!isSupportedService(parsed.service)) {
    const msg = `Unsupported AWS service: ${parsed.service}. Supported: ${SUPPORTED_SERVICES.join(", ")}`;
    return errorResult({
      arn,
      error: msg,
      service: parsed.service,
      resourceType: parsed.resourceType,
      resourceId: parsed.resourceId,
    });
  }

  const checker = await getChecker(parsed.service);
  if (!checker) {
    return errorResult({ arn, error: `No checker for AWS service: ${parsed.service}`, service: parsed.service });
  }

  return checker.check(parsed);
}

/**
 * Check a GCP resource
 */
async function checkGcpResource(resource: string): Promise<ResourceCheckResult> {
  const parsed = parseGcpResource(resource);
  if (!parsed) {
    return errorResult({ arn: resource, error: "Invalid GCP resource path format" });
  }

  if (!isSupportedGcpService(parsed.service)) {
    const msg = `Unsupported GCP service: ${parsed.service}. Supported: ${SUPPORTED_GCP_SERVICES.join(", ")}`;
    return errorResult({
      arn: resource,
      error: msg,
      service: parsed.service,
      resourceType: parsed.resourceType,
      resourceId: parsed.resourceId,
    });
  }

  const checker = await getGcpChecker(parsed.service);
  if (!checker) {
    return errorResult({ arn: resource, error: `No checker for GCP service: ${parsed.service}`, service: parsed.service });
  }

  return checker.check(parsed);
}

interface ErrorResultParams {
  arn: string;
  error: string;
  service?: string;
  resourceType?: string;
  resourceId?: string;
}

/**
 * Create an error result
 */
function errorResult(params: ErrorResultParams): ResourceCheckResult {
  const { arn, error, service = "unknown", resourceType = "unknown", resourceId = arn } = params;
  return { arn, exists: false, error, service, resourceType, resourceId };
}

/**
 * Calculate summary statistics from check results
 */
function calculateSummary(results: ResourceCheckResult[]): InfraScanSummary {
  let found = 0;
  let missing = 0;
  let errors = 0;

  for (const result of results) {
    if (result.error) {
      errors++;
    } else if (result.exists) {
      found++;
    } else {
      missing++;
    }
  }

  return {
    total: results.length,
    found,
    missing,
    errors,
  };
}
