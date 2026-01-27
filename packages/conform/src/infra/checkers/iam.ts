/**
 * IAM resource checker
 */

import { GetPolicyCommand, GetRoleCommand, IAMClient } from "@aws-sdk/client-iam";

import { AWS_DEFAULTS } from "../../constants.js";
import type { ParsedArn, ResourceCheckResult } from "../types.js";
import type { ResourceChecker } from "./types.js";

/**
 * IAM is global, so we only need one client
 */
let client: IAMClient | null = null;

/**
 * Get or create the IAM client
 */
function getClient(): IAMClient {
  // IAM is global, use the default global region
  client ??= new IAMClient({ region: AWS_DEFAULTS.globalRegion });
  return client;
}

/**
 * IAM resource checker (roles and policies)
 */
export const IAMChecker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceType, resourceId, raw } = arn;

    switch (resourceType) {
      case "role":
        return checkRole(resourceId, raw);
      case "policy":
        return checkPolicy(raw);
      default:
        return {
          arn: raw,
          exists: false,
          error: `Unsupported IAM resource type: ${resourceType}`,
          service: "iam",
          resourceType,
          resourceId,
        };
    }
  },
};

/**
 * Check if an IAM role exists
 */
async function checkRole(roleName: string, arn: string): Promise<ResourceCheckResult> {
  const iamClient = getClient();

  try {
    await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
    return {
      arn,
      exists: true,
      service: "iam",
      resourceType: "role",
      resourceId: roleName,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "NoSuchEntityException") {
      return {
        arn,
        exists: false,
        service: "iam",
        resourceType: "role",
        resourceId: roleName,
      };
    }

    return {
      arn,
      exists: false,
      error: err.message || "Unknown error",
      service: "iam",
      resourceType: "role",
      resourceId: roleName,
    };
  }
}

/**
 * Check if an IAM policy exists
 */
async function checkPolicy(policyArn: string): Promise<ResourceCheckResult> {
  const iamClient = getClient();

  // Extract policy name from ARN for display
  const policyName = policyArn.split("/").pop() ?? policyArn;

  try {
    await iamClient.send(new GetPolicyCommand({ PolicyArn: policyArn }));
    return {
      arn: policyArn,
      exists: true,
      service: "iam",
      resourceType: "policy",
      resourceId: policyName,
    };
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "NoSuchEntityException") {
      return {
        arn: policyArn,
        exists: false,
        service: "iam",
        resourceType: "policy",
        resourceId: policyName,
      };
    }

    return {
      arn: policyArn,
      exists: false,
      error: err.message || "Unknown error",
      service: "iam",
      resourceType: "policy",
      resourceId: policyName,
    };
  }
}
