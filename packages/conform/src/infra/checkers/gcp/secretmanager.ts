/**
 * GCP Secret Manager resource checker
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

import type { ParsedGcpResource, ResourceCheckResult } from "../../types.js";
import type { GcpResourceChecker } from "../types.js";

let client: SecretManagerServiceClient | null = null;

function getClient(): SecretManagerServiceClient {
  client ??= new SecretManagerServiceClient();
  return client;
}

function result(
  raw: string,
  resourceId: string,
  exists: boolean,
  error?: string
): ResourceCheckResult {
  return { arn: raw, exists, error, service: "secretmanager", resourceType: "secrets", resourceId };
}

export const SecretManagerChecker: GcpResourceChecker = {
  async check(resource: ParsedGcpResource): Promise<ResourceCheckResult> {
    const { project, resourceId, raw } = resource;
    const secretName = `projects/${project}/secrets/${resourceId}`;

    try {
      const smClient = getClient();
      await smClient.getSecret({ name: secretName });
      return result(raw, resourceId, true);
    } catch (error) {
      const err = error as { code?: number; message?: string };
      if (err.code === 5 || err.message?.includes("NOT_FOUND")) {
        return result(raw, resourceId, false);
      }
      return result(raw, resourceId, false, err.message ?? "Unknown error");
    }
  },
};
