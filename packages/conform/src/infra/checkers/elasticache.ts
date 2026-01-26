/**
 * ElastiCache resource checker
 *
 * Supports:
 * - Cache clusters
 * - Subnet groups
 * - Replication groups
 */

import {
  DescribeCacheClustersCommand,
  DescribeCacheSubnetGroupsCommand,
  DescribeReplicationGroupsCommand,
  ElastiCacheClient,
} from "@aws-sdk/client-elasticache";

import type { ParsedArn, ResourceCheckResult } from "../types.js";
import type { ResourceChecker } from "./types.js";

/**
 * Cache of ElastiCache clients by region
 */
const clientCache = new Map<string, ElastiCacheClient>();

/**
 * Get or create an ElastiCache client for a region
 */
function getClient(region: string): ElastiCacheClient {
  let client = clientCache.get(region);
  if (!client) {
    client = new ElastiCacheClient({ region });
    clientCache.set(region, client);
  }
  return client;
}

/**
 * Check if an ElastiCache cluster exists
 */
async function checkCacheCluster(
  client: ElastiCacheClient,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeCacheClustersCommand({ CacheClusterId: resourceId })
    );

    const cluster = response.CacheClusters?.[0];
    const exists = !!cluster && cluster.CacheClusterStatus !== "deleting";

    return {
      arn: raw,
      exists,
      service: "elasticache",
      resourceType: "cluster",
      resourceId,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "CacheClusterNotFoundFault") {
      return {
        arn: raw,
        exists: false,
        service: "elasticache",
        resourceType: "cluster",
        resourceId,
      };
    }

    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "elasticache",
      resourceType: "cluster",
      resourceId,
    };
  }
}

/**
 * Check if an ElastiCache subnet group exists
 */
async function checkSubnetGroup(
  client: ElastiCacheClient,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeCacheSubnetGroupsCommand({ CacheSubnetGroupName: resourceId })
    );

    const subnetGroup = response.CacheSubnetGroups?.[0];
    const exists = !!subnetGroup;

    return {
      arn: raw,
      exists,
      service: "elasticache",
      resourceType: "subnetgroup",
      resourceId,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "CacheSubnetGroupNotFoundFault") {
      return {
        arn: raw,
        exists: false,
        service: "elasticache",
        resourceType: "subnetgroup",
        resourceId,
      };
    }

    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "elasticache",
      resourceType: "subnetgroup",
      resourceId,
    };
  }
}

/**
 * Check if an ElastiCache replication group exists
 */
async function checkReplicationGroup(
  client: ElastiCacheClient,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeReplicationGroupsCommand({ ReplicationGroupId: resourceId })
    );

    const replicationGroup = response.ReplicationGroups?.[0];
    const exists = !!replicationGroup && replicationGroup.Status !== "deleting";

    return {
      arn: raw,
      exists,
      service: "elasticache",
      resourceType: "replicationgroup",
      resourceId,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "ReplicationGroupNotFoundFault") {
      return {
        arn: raw,
        exists: false,
        service: "elasticache",
        resourceType: "replicationgroup",
        resourceId,
      };
    }

    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "elasticache",
      resourceType: "replicationgroup",
      resourceId,
    };
  }
}

/**
 * ElastiCache resource checker
 */
export const ElastiCacheChecker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceType, resourceId, region, raw } = arn;
    const client = getClient(region);

    switch (resourceType) {
      case "cluster":
        return checkCacheCluster(client, arn);

      case "subnetgroup":
        return checkSubnetGroup(client, arn);

      case "replicationgroup":
        return checkReplicationGroup(client, arn);

      default:
        return {
          arn: raw,
          exists: false,
          error: `Unsupported ElastiCache resource type: ${resourceType}`,
          service: "elasticache",
          resourceType,
          resourceId,
        };
    }
  },
};
