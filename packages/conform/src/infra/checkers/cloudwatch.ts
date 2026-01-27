/**
 * CloudWatch Logs resource checker
 */

import { CloudWatchLogsClient, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";

import type { ParsedArn, ResourceCheckResult } from "../types.js";
import { createClientFactory } from "./client-factory.js";
import type { ResourceChecker } from "./types.js";

/**
 * Get or create a CloudWatch Logs client for a region
 */
const getClient = createClientFactory(CloudWatchLogsClient);

/**
 * CloudWatch Logs log group checker
 */
export const CloudWatchLogsChecker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceId, region, raw } = arn;

    const client = getClient(region);

    try {
      // DescribeLogGroups filters by prefix, so we need to check the results
      const response = await client.send(
        new DescribeLogGroupsCommand({
          logGroupNamePrefix: resourceId,
          limit: 1,
        })
      );

      // Check if we found an exact match
      const found = response.logGroups?.some((lg) => lg.logGroupName === resourceId);

      return {
        arn: raw,
        exists: Boolean(found),
        service: "logs",
        resourceType: "log-group",
        resourceId,
      };
    } catch (error) {
      const err = error as Error & { name?: string };

      if (err.name === "ResourceNotFoundException") {
        return {
          arn: raw,
          exists: false,
          service: "logs",
          resourceType: "log-group",
          resourceId,
        };
      }

      return {
        arn: raw,
        exists: false,
        error: err.message || "Unknown error",
        service: "logs",
        resourceType: "log-group",
        resourceId,
      };
    }
  },
};
