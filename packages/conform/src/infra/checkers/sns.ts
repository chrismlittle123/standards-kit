/**
 * SNS resource checker
 */

import { GetTopicAttributesCommand, SNSClient } from "@aws-sdk/client-sns";

import type { ParsedArn, ResourceCheckResult } from "../types.js";
import { createClientFactory } from "./client-factory.js";
import type { ResourceChecker } from "./types.js";

/**
 * Get or create an SNS client for a region
 */
const getClient = createClientFactory(SNSClient);

/**
 * SNS topic checker
 */
export const SNSChecker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceId, region, raw } = arn;

    const client = getClient(region);

    try {
      // Use the full ARN to get topic attributes
      await client.send(new GetTopicAttributesCommand({ TopicArn: raw }));

      return {
        arn: raw,
        exists: true,
        service: "sns",
        resourceType: "topic",
        resourceId,
      };
    } catch (error) {
      const err = error as Error & { name?: string };

      if (err.name === "NotFoundException" || err.name === "NotFound") {
        return {
          arn: raw,
          exists: false,
          service: "sns",
          resourceType: "topic",
          resourceId,
        };
      }

      return {
        arn: raw,
        exists: false,
        error: err.message || "Unknown error",
        service: "sns",
        resourceType: "topic",
        resourceId,
      };
    }
  },
};
