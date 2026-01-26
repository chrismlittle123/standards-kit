/**
 * S3 resource checker
 */

import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

import type { ParsedArn, ResourceCheckResult } from "../types.js";
import type { ResourceChecker } from "./types.js";

/**
 * Cache of S3 clients by region
 */
const clientCache = new Map<string, S3Client>();

/**
 * Get or create an S3 client for a region
 */
function getClient(region: string): S3Client {
  // S3 is global, but we use us-east-1 for global operations
  const effectiveRegion = region || "us-east-1";

  let client = clientCache.get(effectiveRegion);
  if (!client) {
    client = new S3Client({
      region: effectiveRegion,
      followRegionRedirects: true,
    });
    clientCache.set(effectiveRegion, client);
  }
  return client;
}

/**
 * S3 bucket checker
 */
export const S3Checker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceType, resourceId, raw } = arn;

    // Only check bucket existence (not individual objects)
    if (resourceType === "object") {
      // For objects, we'd need to check if the key exists, which is expensive
      // For now, we just check if the bucket exists
      const bucketName = resourceId.split("/")[0];
      return checkBucket(bucketName, arn.region, raw);
    }

    return checkBucket(resourceId, arn.region, raw);
  },
};

/**
 * Create a bucket check result
 */
function bucketResult(
  arn: string,
  bucketName: string,
  exists: boolean,
  error?: string
): ResourceCheckResult {
  return { arn, exists, error, service: "s3", resourceType: "bucket", resourceId: bucketName };
}

/**
 * Check if error indicates bucket doesn't exist (404 or 403)
 */
function isBucketNotFound(err: Error & { name?: string; $metadata?: { httpStatusCode?: number } }): boolean {
  const httpStatus = err.$metadata?.httpStatusCode;
  // 404 = not found, 403 = access denied (S3 returns 403 for non-existent buckets to prevent enumeration)
  return err.name === "NotFound" || err.name === "NoSuchBucket" || httpStatus === 404 ||
         err.name === "Forbidden" || err.name === "AccessDenied" || httpStatus === 403;
}

/**
 * Check if an S3 bucket exists
 */
async function checkBucket(bucketName: string, region: string, arn: string): Promise<ResourceCheckResult> {
  const client = getClient(region);

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
    return bucketResult(arn, bucketName, true);
  } catch (error) {
    const err = error as Error & { name?: string; $metadata?: { httpStatusCode?: number } };
    if (isBucketNotFound(err)) {
      return bucketResult(arn, bucketName, false);
    }
    return bucketResult(arn, bucketName, false, err.message || "Unknown error");
  }
}
