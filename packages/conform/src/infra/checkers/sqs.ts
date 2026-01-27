/**
 * SQS resource checker
 */

import { GetQueueAttributesCommand, GetQueueUrlCommand, SQSClient } from "@aws-sdk/client-sqs";

import type { ParsedArn, ResourceCheckResult } from "../types.js";
import { createClientFactory } from "./client-factory.js";
import type { ResourceChecker } from "./types.js";

/**
 * Get or create an SQS client for a region
 */
const getClient = createClientFactory(SQSClient);

/**
 * SQS queue checker
 */
export const SQSChecker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceId, region, accountId, raw } = arn;

    const client = getClient(region);

    try {
      // First, get the queue URL from the queue name and account ID
      const urlResponse = await client.send(
        new GetQueueUrlCommand({
          QueueName: resourceId,
          QueueOwnerAWSAccountId: accountId || undefined,
        })
      );

      // Then verify the queue exists by getting its attributes
      await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: urlResponse.QueueUrl,
          AttributeNames: ["QueueArn"],
        })
      );

      return {
        arn: raw,
        exists: true,
        service: "sqs",
        resourceType: "queue",
        resourceId,
      };
    } catch (error) {
      const err = error as Error & { name?: string };

      if (
        err.name === "QueueDoesNotExist" ||
        err.name === "AWS.SimpleQueueService.NonExistentQueue"
      ) {
        return {
          arn: raw,
          exists: false,
          service: "sqs",
          resourceType: "queue",
          resourceId,
        };
      }

      return {
        arn: raw,
        exists: false,
        error: err.message || "Unknown error",
        service: "sqs",
        resourceType: "queue",
        resourceId,
      };
    }
  },
};
