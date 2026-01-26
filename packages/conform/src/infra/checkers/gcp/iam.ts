/**
 * GCP IAM Service Account resource checker
 */

import { GoogleAuth } from "google-auth-library";

import type { ParsedGcpResource, ResourceCheckResult } from "../../types.js";
import type { GcpResourceChecker } from "../types.js";

let auth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  auth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return auth;
}

function result(
  raw: string,
  resourceId: string,
  exists: boolean,
  error?: string
): ResourceCheckResult {
  return {
    arn: raw,
    exists,
    error,
    service: "iam",
    resourceType: "serviceAccounts",
    resourceId,
  };
}

export const ServiceAccountChecker: GcpResourceChecker = {
  async check(resource: ParsedGcpResource): Promise<ResourceCheckResult> {
    const { project, resourceId, raw } = resource;
    const url = `https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${resourceId}`;

    try {
      const authClient = getAuth();
      const client = await authClient.getClient();
      await client.request({ url, method: "GET" });
      return result(raw, resourceId, true);
    } catch (error) {
      const err = error as { code?: number; message?: string; response?: { status?: number } };
      if (err.response?.status === 404 || err.code === 404 || err.message?.includes("NOT_FOUND")) {
        return result(raw, resourceId, false);
      }
      return result(raw, resourceId, false, err.message ?? "Unknown error");
    }
  },
};
