/**
 * Elastic Load Balancing v2 resource checker
 *
 * Supports:
 * - Load balancers (ALB, NLB, GLB)
 * - Target groups
 * - Listeners
 */

import {
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeListenersCommand,
  ElasticLoadBalancingV2Client,
} from "@aws-sdk/client-elastic-load-balancing-v2";

import type { ParsedArn, ResourceCheckResult } from "../types.js";
import { createClientFactory } from "./client-factory.js";
import type { ResourceChecker } from "./types.js";

/**
 * Get or create an ELBv2 client for a region
 */
const getClient = createClientFactory(ElasticLoadBalancingV2Client);

/**
 * Check if a load balancer exists
 */
async function checkLoadBalancer(
  client: ElasticLoadBalancingV2Client,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeLoadBalancersCommand({ LoadBalancerArns: [raw] })
    );

    const loadBalancer = response.LoadBalancers?.[0];
    const exists =
      !!loadBalancer &&
      loadBalancer.State?.Code !== "failed" &&
      loadBalancer.State?.Code !== "active_impaired";

    return {
      arn: raw,
      exists,
      service: "elasticloadbalancing",
      resourceType: "loadbalancer",
      resourceId,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "LoadBalancerNotFoundException") {
      return {
        arn: raw,
        exists: false,
        service: "elasticloadbalancing",
        resourceType: "loadbalancer",
        resourceId,
      };
    }

    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "elasticloadbalancing",
      resourceType: "loadbalancer",
      resourceId,
    };
  }
}

/**
 * Check if a target group exists
 */
async function checkTargetGroup(
  client: ElasticLoadBalancingV2Client,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeTargetGroupsCommand({ TargetGroupArns: [raw] })
    );

    const targetGroup = response.TargetGroups?.[0];
    const exists = !!targetGroup;

    return {
      arn: raw,
      exists,
      service: "elasticloadbalancing",
      resourceType: "targetgroup",
      resourceId,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "TargetGroupNotFoundException") {
      return {
        arn: raw,
        exists: false,
        service: "elasticloadbalancing",
        resourceType: "targetgroup",
        resourceId,
      };
    }

    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "elasticloadbalancing",
      resourceType: "targetgroup",
      resourceId,
    };
  }
}

/**
 * Check if a listener exists
 */
async function checkListener(
  client: ElasticLoadBalancingV2Client,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeListenersCommand({ ListenerArns: [raw] })
    );

    const listener = response.Listeners?.[0];
    const exists = !!listener;

    return {
      arn: raw,
      exists,
      service: "elasticloadbalancing",
      resourceType: "listener",
      resourceId,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "ListenerNotFoundException") {
      return {
        arn: raw,
        exists: false,
        service: "elasticloadbalancing",
        resourceType: "listener",
        resourceId,
      };
    }

    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "elasticloadbalancing",
      resourceType: "listener",
      resourceId,
    };
  }
}

/**
 * Elastic Load Balancing resource checker
 */
export const ELBChecker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceType, resourceId, region, raw } = arn;
    const client = getClient(region);

    switch (resourceType) {
      case "loadbalancer":
        return checkLoadBalancer(client, arn);

      case "targetgroup":
        return checkTargetGroup(client, arn);

      case "listener":
        return checkListener(client, arn);

      default:
        return {
          arn: raw,
          exists: false,
          error: `Unsupported ELB resource type: ${resourceType}`,
          service: "elasticloadbalancing",
          resourceType,
          resourceId,
        };
    }
  },
};
