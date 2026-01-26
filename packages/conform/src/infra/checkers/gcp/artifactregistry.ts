/**
 * GCP Artifact Registry resource checker
 */

import { ArtifactRegistryClient } from "@google-cloud/artifact-registry";

import type { ParsedGcpResource, ResourceCheckResult } from "../../types.js";
import type { GcpResourceChecker } from "../types.js";

let client: ArtifactRegistryClient | null = null;

function getClient(): ArtifactRegistryClient {
  client ??= new ArtifactRegistryClient();
  return client;
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
    service: "artifactregistry",
    resourceType: "repositories",
    resourceId,
  };
}

export const ArtifactRegistryChecker: GcpResourceChecker = {
  async check(resource: ParsedGcpResource): Promise<ResourceCheckResult> {
    const { project, location, resourceId, raw } = resource;
    const repoName = `projects/${project}/locations/${location}/repositories/${resourceId}`;

    try {
      const arClient = getClient();
      await arClient.getRepository({ name: repoName });
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
