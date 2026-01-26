/**
 * RDS resource checker
 *
 * Supports:
 * - DB instances
 * - DB clusters (Aurora)
 * - DB subnet groups
 */

import {
  DescribeDBInstancesCommand,
  DescribeDBClustersCommand,
  DescribeDBSubnetGroupsCommand,
  RDSClient,
} from "@aws-sdk/client-rds";

import type { ParsedArn, ResourceCheckResult } from "../types.js";
import type { ResourceChecker } from "./types.js";

/**
 * Cache of RDS clients by region
 */
const clientCache = new Map<string, RDSClient>();

/**
 * Get or create an RDS client for a region
 */
function getClient(region: string): RDSClient {
  let client = clientCache.get(region);
  if (!client) {
    client = new RDSClient({ region });
    clientCache.set(region, client);
  }
  return client;
}

/**
 * Check if an RDS DB instance exists
 */
async function checkDBInstance(
  client: RDSClient,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: resourceId })
    );

    const instance = response.DBInstances?.[0];
    const exists = !!instance && instance.DBInstanceStatus !== "deleting";

    return {
      arn: raw,
      exists,
      service: "rds",
      resourceType: "db",
      resourceId,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "DBInstanceNotFoundFault") {
      return {
        arn: raw,
        exists: false,
        service: "rds",
        resourceType: "db",
        resourceId,
      };
    }

    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "rds",
      resourceType: "db",
      resourceId,
    };
  }
}

/**
 * Check if an RDS DB cluster exists (Aurora)
 */
async function checkDBCluster(
  client: RDSClient,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeDBClustersCommand({ DBClusterIdentifier: resourceId })
    );

    const cluster = response.DBClusters?.[0];
    const exists = !!cluster && cluster.Status !== "deleting";

    return {
      arn: raw,
      exists,
      service: "rds",
      resourceType: "cluster",
      resourceId,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "DBClusterNotFoundFault") {
      return {
        arn: raw,
        exists: false,
        service: "rds",
        resourceType: "cluster",
        resourceId,
      };
    }

    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "rds",
      resourceType: "cluster",
      resourceId,
    };
  }
}

/**
 * Check if an RDS DB subnet group exists
 */
async function checkDBSubnetGroup(
  client: RDSClient,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeDBSubnetGroupsCommand({ DBSubnetGroupName: resourceId })
    );

    const subnetGroup = response.DBSubnetGroups?.[0];
    const exists = !!subnetGroup;

    return {
      arn: raw,
      exists,
      service: "rds",
      resourceType: "subgrp",
      resourceId,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "DBSubnetGroupNotFoundFault") {
      return {
        arn: raw,
        exists: false,
        service: "rds",
        resourceType: "subgrp",
        resourceId,
      };
    }

    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "rds",
      resourceType: "subgrp",
      resourceId,
    };
  }
}

/**
 * RDS resource checker
 */
export const RDSChecker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceType, resourceId, region, raw } = arn;
    const client = getClient(region);

    switch (resourceType) {
      case "db":
        return checkDBInstance(client, arn);

      case "cluster":
        return checkDBCluster(client, arn);

      case "subgrp":
        return checkDBSubnetGroup(client, arn);

      default:
        return {
          arn: raw,
          exists: false,
          error: `Unsupported RDS resource type: ${resourceType}`,
          service: "rds",
          resourceType,
          resourceId,
        };
    }
  },
};
