/**
 * GCP Cloud Run resource checker
 */

import { ServicesClient } from "@google-cloud/run";

import type { ParsedGcpResource, ResourceCheckResult } from "../../types.js";
import type { GcpResourceChecker } from "../types.js";

let client: ServicesClient | null = null;

function getClient(): ServicesClient {
  client ??= new ServicesClient();
  return client;
}

function result(
  raw: string,
  resourceId: string,
  exists: boolean,
  error?: string
): ResourceCheckResult {
  return { arn: raw, exists, error, service: "run", resourceType: "services", resourceId };
}

export const CloudRunChecker: GcpResourceChecker = {
  async check(resource: ParsedGcpResource): Promise<ResourceCheckResult> {
    const { project, location, resourceId, raw } = resource;
    const serviceName = `projects/${project}/locations/${location}/services/${resourceId}`;

    try {
      const runClient = getClient();
      await runClient.getService({ name: serviceName });
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
