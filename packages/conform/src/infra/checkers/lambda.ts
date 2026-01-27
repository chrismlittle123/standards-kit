/**
 * Lambda resource checker
 */

import { GetFunctionCommand, LambdaClient } from "@aws-sdk/client-lambda";

import type { ParsedArn, ResourceCheckResult } from "../types.js";
import { createClientFactory } from "./client-factory.js";
import type { ResourceChecker } from "./types.js";

/**
 * Get or create a Lambda client for a region
 */
const getClient = createClientFactory(LambdaClient);

/**
 * Lambda function checker
 */
export const LambdaChecker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceType, resourceId, region, raw } = arn;

    // Only check functions (not layers for now)
    if (resourceType !== "function") {
      return {
        arn: raw,
        exists: false,
        error: `Unsupported Lambda resource type: ${resourceType}`,
        service: "lambda",
        resourceType,
        resourceId,
      };
    }

    const client = getClient(region);

    try {
      await client.send(new GetFunctionCommand({ FunctionName: resourceId }));
      return {
        arn: raw,
        exists: true,
        service: "lambda",
        resourceType: "function",
        resourceId,
      };
    } catch (error) {
      const err = error as Error & { name?: string };

      if (err.name === "ResourceNotFoundException") {
        return {
          arn: raw,
          exists: false,
          service: "lambda",
          resourceType: "function",
          resourceId,
        };
      }

      return {
        arn: raw,
        exists: false,
        error: err.message || "Unknown error",
        service: "lambda",
        resourceType: "function",
        resourceId,
      };
    }
  },
};
