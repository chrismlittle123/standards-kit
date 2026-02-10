import { describe, it, expect } from "vitest";

import { isValidGcpResource, parseGcpResource } from "../../../src/infra/gcp.js";

describe("isValidGcpResource", () => {
  it("returns true for a valid resource path", () => {
    expect(isValidGcpResource("projects/my-project/locations/us-central1/services/my-svc")).toBe(
      true
    );
  });

  it("returns true for minimal valid path (3 parts)", () => {
    expect(isValidGcpResource("projects/my-project/secrets")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isValidGcpResource("")).toBe(false);
  });

  it("returns false for non-projects prefix", () => {
    expect(isValidGcpResource("organizations/my-org/something")).toBe(false);
  });

  it("returns false for projects/ with only 2 parts", () => {
    expect(isValidGcpResource("projects/my-project")).toBe(false);
  });

  it("returns false for AWS ARN", () => {
    expect(isValidGcpResource("arn:aws:s3:::bucket")).toBe(false);
  });
});

describe("parseGcpResource", () => {
  it("returns null for invalid path", () => {
    expect(parseGcpResource("not-a-path")).toBeNull();
  });

  it("returns null for path that doesn't start with projects", () => {
    expect(parseGcpResource("other/my-project/locations/us/services/svc")).toBeNull();
  });

  it("parses Cloud Run service", () => {
    const result = parseGcpResource(
      "projects/my-project/locations/us-central1/services/my-service"
    );
    expect(result).toEqual({
      cloud: "gcp",
      project: "my-project",
      service: "run",
      location: "us-central1",
      resourceType: "services",
      resourceId: "my-service",
      raw: "projects/my-project/locations/us-central1/services/my-service",
    });
  });

  it("parses Artifact Registry repository", () => {
    const result = parseGcpResource(
      "projects/my-project/locations/us-central1/repositories/my-repo"
    );
    expect(result).toEqual({
      cloud: "gcp",
      project: "my-project",
      service: "artifactregistry",
      location: "us-central1",
      resourceType: "repositories",
      resourceId: "my-repo",
      raw: "projects/my-project/locations/us-central1/repositories/my-repo",
    });
  });

  it("parses Cloud Functions function", () => {
    const result = parseGcpResource(
      "projects/my-project/locations/us-central1/functions/my-func"
    );
    expect(result).toEqual({
      cloud: "gcp",
      project: "my-project",
      service: "cloudfunctions",
      location: "us-central1",
      resourceType: "functions",
      resourceId: "my-func",
      raw: "projects/my-project/locations/us-central1/functions/my-func",
    });
  });

  it("parses storage bucket", () => {
    const result = parseGcpResource(
      "projects/my-project/locations/us-central1/buckets/my-bucket"
    );
    expect(result).toEqual({
      cloud: "gcp",
      project: "my-project",
      service: "storage",
      location: "us-central1",
      resourceType: "buckets",
      resourceId: "my-bucket",
      raw: "projects/my-project/locations/us-central1/buckets/my-bucket",
    });
  });

  it("parses compute instance", () => {
    const result = parseGcpResource(
      "projects/my-project/locations/us-central1/instances/my-instance"
    );
    expect(result).toEqual({
      cloud: "gcp",
      project: "my-project",
      service: "compute",
      location: "us-central1",
      resourceType: "instances",
      resourceId: "my-instance",
      raw: "projects/my-project/locations/us-central1/instances/my-instance",
    });
  });

  it("parses GKE cluster", () => {
    const result = parseGcpResource(
      "projects/my-project/locations/us-central1/clusters/my-cluster"
    );
    expect(result).toEqual({
      cloud: "gcp",
      project: "my-project",
      service: "container",
      location: "us-central1",
      resourceType: "clusters",
      resourceId: "my-cluster",
      raw: "projects/my-project/locations/us-central1/clusters/my-cluster",
    });
  });

  it("parses unknown location-based resource type as-is", () => {
    const result = parseGcpResource(
      "projects/my-project/locations/us-central1/customType/my-resource"
    );
    expect(result).toEqual({
      cloud: "gcp",
      project: "my-project",
      service: "customType",
      location: "us-central1",
      resourceType: "customType",
      resourceId: "my-resource",
      raw: "projects/my-project/locations/us-central1/customType/my-resource",
    });
  });

  it("parses IAM service account", () => {
    const result = parseGcpResource(
      "projects/my-project/serviceAccounts/sa@my-project.iam.gserviceaccount.com"
    );
    expect(result).toEqual({
      cloud: "gcp",
      project: "my-project",
      service: "iam",
      location: "global",
      resourceType: "serviceAccounts",
      resourceId: "sa@my-project.iam.gserviceaccount.com",
      raw: "projects/my-project/serviceAccounts/sa@my-project.iam.gserviceaccount.com",
    });
  });

  it("parses Secret Manager secret", () => {
    const result = parseGcpResource("projects/my-project/secrets/my-secret");
    expect(result).toEqual({
      cloud: "gcp",
      project: "my-project",
      service: "secretmanager",
      location: "global",
      resourceType: "secrets",
      resourceId: "my-secret",
      raw: "projects/my-project/secrets/my-secret",
    });
  });

  it("returns null for unknown non-location non-service path", () => {
    const result = parseGcpResource("projects/my-project/unknownType");
    expect(result).toBeNull();
  });

  it("returns null for locations path with too few parts", () => {
    const result = parseGcpResource("projects/my-project/locations/us-central1");
    expect(result).toBeNull();
  });
});
