/**
 * GCP resource path parsing utilities
 *
 * GCP resource paths follow patterns like:
 * - projects/{project}/locations/{location}/services/{service} (Cloud Run)
 * - projects/{project}/serviceAccounts/{email} (IAM Service Accounts)
 * - projects/{project}/secrets/{secret} (Secret Manager)
 * - projects/{project}/locations/{location}/repositories/{repo} (Artifact Registry)
 */

import type { ParsedGcpResource } from "./types.js";

/**
 * Validate that a string is a valid GCP resource path
 */
export function isValidGcpResource(path: string): boolean {
  return path.startsWith("projects/") && path.split("/").length >= 3;
}

/**
 * Parse a GCP resource path into its components
 */
export function parseGcpResource(path: string): ParsedGcpResource | null {
  if (!isValidGcpResource(path)) {
    return null;
  }

  const parts = path.split("/");
  if (parts[0] !== "projects" || parts.length < 3) {
    return null;
  }

  const project = parts[1];
  const result = parseResourcePath(parts.slice(2), path, project);
  return result;
}

/**
 * Parse the resource-specific part of the path
 */
function parseResourcePath(
  parts: string[],
  raw: string,
  project: string
): ParsedGcpResource | null {
  // Service Accounts: projects/{project}/serviceAccounts/{email}
  if (parts[0] === "serviceAccounts" && parts.length >= 2) {
    return gcpResource({
      project,
      service: "iam",
      location: "global",
      resourceType: "serviceAccounts",
      resourceId: parts.slice(1).join("/"),
      raw,
    });
  }

  // Secrets: projects/{project}/secrets/{secret}
  if (parts[0] === "secrets" && parts.length >= 2) {
    return gcpResource({
      project,
      service: "secretmanager",
      location: "global",
      resourceType: "secrets",
      resourceId: parts[1],
      raw,
    });
  }

  // Location-based resources
  if (parts[0] === "locations" && parts.length >= 4) {
    const location = parts[1];
    const resourceType = parts[2];
    const resourceId = parts.slice(3).join("/");

    const service = getServiceFromResourceType(resourceType);
    return gcpResource({
      project,
      service,
      location,
      resourceType,
      resourceId,
      raw,
    });
  }

  // Unknown format
  return null;
}

/**
 * Map resource types to GCP service names
 */
function getServiceFromResourceType(resourceType: string): string {
  const serviceMap: Record<string, string> = {
    services: "run",
    repositories: "artifactregistry",
    functions: "cloudfunctions",
    buckets: "storage",
    instances: "compute",
    clusters: "container",
  };
  return serviceMap[resourceType] ?? resourceType;
}

interface GcpResourceParams {
  project: string;
  service: string;
  location: string;
  resourceType: string;
  resourceId: string;
  raw: string;
}

/**
 * Create a ParsedGcpResource object
 */
function gcpResource(params: GcpResourceParams): ParsedGcpResource {
  return { cloud: "gcp", ...params };
}
