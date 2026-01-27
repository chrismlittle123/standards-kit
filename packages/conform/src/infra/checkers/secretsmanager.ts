/**
 * Secrets Manager resource checker
 */

import { DescribeSecretCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

import type { ParsedArn, ResourceCheckResult } from "../types.js";
import { createClientFactory } from "./client-factory.js";
import type { ResourceChecker } from "./types.js";

/**
 * Get or create a Secrets Manager client for a region
 */
const getClient = createClientFactory(SecretsManagerClient);

/**
 * Secrets Manager secret checker
 */
export const SecretsManagerChecker: ResourceChecker = {
  async check(arn: ParsedArn): Promise<ResourceCheckResult> {
    const { resourceId, region, raw } = arn;

    const client = getClient(region);

    try {
      // Use the full ARN to get the secret
      await client.send(new DescribeSecretCommand({ SecretId: raw }));

      return {
        arn: raw,
        exists: true,
        service: "secretsmanager",
        resourceType: "secret",
        resourceId,
      };
    } catch (error) {
      const err = error as Error & { name?: string };

      if (err.name === "ResourceNotFoundException") {
        return {
          arn: raw,
          exists: false,
          service: "secretsmanager",
          resourceType: "secret",
          resourceId,
        };
      }

      return {
        arn: raw,
        exists: false,
        error: err.message || "Unknown error",
        service: "secretsmanager",
        resourceType: "secret",
        resourceId,
      };
    }
  },
};
