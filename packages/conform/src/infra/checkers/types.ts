/**
 * Types for resource checkers
 */

import type { ParsedArn, ParsedGcpResource, ResourceCheckResult } from "../types.js";

/**
 * Interface for AWS resource checkers
 */
export interface ResourceChecker {
  /**
   * Check if a resource exists
   *
   * @param arn - Parsed ARN of the resource
   * @returns Check result with exists status and optional error
   */
  check(arn: ParsedArn): Promise<ResourceCheckResult>;
}

/**
 * Interface for GCP resource checkers
 */
export interface GcpResourceChecker {
  /**
   * Check if a resource exists
   *
   * @param resource - Parsed GCP resource
   * @returns Check result with exists status and optional error
   */
  check(resource: ParsedGcpResource): Promise<ResourceCheckResult>;
}
