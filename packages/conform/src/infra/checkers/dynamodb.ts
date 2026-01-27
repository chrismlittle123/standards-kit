/**
 * DynamoDB resource checker
 */

import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";

import type { ParsedArn, ResourceCheckResult } from "../types.js";
import { createClientFactory } from "./client-factory.js";
import type { ResourceChecker } from "./types.js";

/**
 * Get or create a DynamoDB client for a region
 */
const getClient = createClientFactory(DynamoDBClient);

/**
 * DynamoDB table checker
 */
export const DynamoDBChecker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceType, resourceId, region, raw } = arn;

    // Extract table name (might be "table-name" or "table-name/index/index-name")
    const tableName = resourceId.split("/")[0];

    const client = getClient(region);

    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
      return {
        arn: raw,
        exists: true,
        service: "dynamodb",
        resourceType,
        resourceId,
      };
    } catch (error) {
      const err = error as Error & { name?: string };

      if (err.name === "ResourceNotFoundException") {
        return {
          arn: raw,
          exists: false,
          service: "dynamodb",
          resourceType,
          resourceId,
        };
      }

      return {
        arn: raw,
        exists: false,
        error: err.message || "Unknown error",
        service: "dynamodb",
        resourceType,
        resourceId,
      };
    }
  },
};
