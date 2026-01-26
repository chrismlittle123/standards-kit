/**
 * ECS resource checker
 *
 * Supports:
 * - Clusters
 * - Services
 * - Task definitions
 */

import {
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ECSClient,
} from "@aws-sdk/client-ecs";

import type { ParsedArn, ResourceCheckResult } from "../types.js";
import type { ResourceChecker } from "./types.js";

/**
 * Cache of ECS clients by region
 */
const clientCache = new Map<string, ECSClient>();

/**
 * Get or create an ECS client for a region
 */
function getClient(region: string): ECSClient {
  let client = clientCache.get(region);
  if (!client) {
    client = new ECSClient({ region });
    clientCache.set(region, client);
  }
  return client;
}

/**
 * Check if an ECS cluster exists
 */
async function checkCluster(
  client: ECSClient,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeClustersCommand({ clusters: [raw] })
    );

    const cluster = response.clusters?.[0];
    const exists = cluster?.status === "ACTIVE";

    return {
      arn: raw,
      exists,
      service: "ecs",
      resourceType: "cluster",
      resourceId,
    };
  } catch (error) {
    const err = error as Error;
    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "ecs",
      resourceType: "cluster",
      resourceId,
    };
  }
}

/**
 * Check if an ECS service exists
 *
 * Service ARN format: arn:aws:ecs:region:account:service/cluster/service-name
 */
async function checkService(
  client: ECSClient,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw, accountId, region } = arn;

  // resourceId format: cluster-name/service-name
  const parts = resourceId.split("/");
  if (parts.length < 2) {
    return {
      arn: raw,
      exists: false,
      error: "Invalid service ARN format",
      service: "ecs",
      resourceType: "service",
      resourceId,
    };
  }

  const clusterName = parts[0];
  const serviceName = parts[1];
  const clusterArn = `arn:aws:ecs:${region}:${accountId}:cluster/${clusterName}`;

  try {
    const response = await client.send(
      new DescribeServicesCommand({
        cluster: clusterArn,
        services: [serviceName],
      })
    );

    const service = response.services?.[0];
    const exists = service?.status === "ACTIVE";

    return {
      arn: raw,
      exists,
      service: "ecs",
      resourceType: "service",
      resourceId,
    };
  } catch (error) {
    const err = error as Error;
    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "ecs",
      resourceType: "service",
      resourceId,
    };
  }
}

/**
 * Check if an ECS task definition exists
 *
 * Task definition ARN format: arn:aws:ecs:region:account:task-definition/name:revision
 * or: arn:aws:ecs:region:account:task-definition/name (latest)
 */
async function checkTaskDefinition(
  client: ECSClient,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeTaskDefinitionCommand({ taskDefinition: raw })
    );

    const taskDef = response.taskDefinition;
    const exists = taskDef?.status === "ACTIVE";

    return {
      arn: raw,
      exists,
      service: "ecs",
      resourceType: "task-definition",
      resourceId,
    };
  } catch (error) {
    const err = error as Error;
    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "ecs",
      resourceType: "task-definition",
      resourceId,
    };
  }
}

/**
 * ECS resource checker
 */
export const ECSChecker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceType, resourceId, region, raw } = arn;
    const client = getClient(region);

    switch (resourceType) {
      case "cluster":
        return checkCluster(client, arn);

      case "service":
        return checkService(client, arn);

      case "task-definition":
        return checkTaskDefinition(client, arn);

      default:
        return {
          arn: raw,
          exists: false,
          error: `Unsupported ECS resource type: ${resourceType}`,
          service: "ecs",
          resourceType,
          resourceId,
        };
    }
  },
};
