/**
 * EC2 resource checker
 *
 * Supports:
 * - Instances
 * - Security groups
 * - Key pairs
 */

import {
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeKeyPairsCommand,
  EC2Client,
} from "@aws-sdk/client-ec2";

import type { ParsedArn, ResourceCheckResult } from "../types.js";
import type { ResourceChecker } from "./types.js";

/**
 * Cache of EC2 clients by region
 */
const clientCache = new Map<string, EC2Client>();

/**
 * Get or create an EC2 client for a region
 */
function getClient(region: string): EC2Client {
  let client = clientCache.get(region);
  if (!client) {
    client = new EC2Client({ region });
    clientCache.set(region, client);
  }
  return client;
}

/**
 * Check if an EC2 instance exists
 */
async function checkInstance(
  client: EC2Client,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeInstancesCommand({ InstanceIds: [resourceId] })
    );

    const instance = response.Reservations?.[0]?.Instances?.[0];
    const exists = !!instance && instance.State?.Name !== "terminated";

    return {
      arn: raw,
      exists,
      service: "ec2",
      resourceType: "instance",
      resourceId,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "InvalidInstanceID.NotFound") {
      return {
        arn: raw,
        exists: false,
        service: "ec2",
        resourceType: "instance",
        resourceId,
      };
    }

    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "ec2",
      resourceType: "instance",
      resourceId,
    };
  }
}

/**
 * Check if an EC2 security group exists
 */
async function checkSecurityGroup(
  client: EC2Client,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeSecurityGroupsCommand({ GroupIds: [resourceId] })
    );

    const securityGroup = response.SecurityGroups?.[0];
    const exists = !!securityGroup;

    return {
      arn: raw,
      exists,
      service: "ec2",
      resourceType: "security-group",
      resourceId,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "InvalidGroup.NotFound") {
      return {
        arn: raw,
        exists: false,
        service: "ec2",
        resourceType: "security-group",
        resourceId,
      };
    }

    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "ec2",
      resourceType: "security-group",
      resourceId,
    };
  }
}

/**
 * Check if an EC2 key pair exists
 */
async function checkKeyPair(
  client: EC2Client,
  arn: ParsedArn
): Promise<ResourceCheckResult> {
  const { resourceId, raw } = arn;

  try {
    const response = await client.send(
      new DescribeKeyPairsCommand({ KeyNames: [resourceId] })
    );

    const keyPair = response.KeyPairs?.[0];
    const exists = !!keyPair;

    return {
      arn: raw,
      exists,
      service: "ec2",
      resourceType: "key-pair",
      resourceId,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "InvalidKeyPair.NotFound") {
      return {
        arn: raw,
        exists: false,
        service: "ec2",
        resourceType: "key-pair",
        resourceId,
      };
    }

    return {
      arn: raw,
      exists: false,
      error: err.message || "Unknown error",
      service: "ec2",
      resourceType: "key-pair",
      resourceId,
    };
  }
}

/**
 * EC2 resource checker
 */
export const EC2Checker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceType, resourceId, region, raw } = arn;
    const client = getClient(region);

    switch (resourceType) {
      case "instance":
        return checkInstance(client, arn);

      case "security-group":
        return checkSecurityGroup(client, arn);

      case "key-pair":
        return checkKeyPair(client, arn);

      default:
        return {
          arn: raw,
          exists: false,
          error: `Unsupported EC2 resource type: ${resourceType}`,
          service: "ec2",
          resourceType,
          resourceId,
        };
    }
  },
};
