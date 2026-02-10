vi.mock("@google-cloud/artifact-registry");

import { ArtifactRegistryClient } from "@google-cloud/artifact-registry";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedGcpResource } from "../../../../../src/infra/types.js";
import { ArtifactRegistryChecker } from "../../../../../src/infra/checkers/gcp/artifactregistry.js";

const mockGetRepository = vi.fn();
vi.mocked(ArtifactRegistryClient).mockImplementation(
  () => ({ getRepository: mockGetRepository }) as unknown as ArtifactRegistryClient
);

beforeEach(() => vi.clearAllMocks());

function makeResource(overrides: Partial<ParsedGcpResource> = {}): ParsedGcpResource {
  return {
    cloud: "gcp",
    project: "my-project",
    service: "artifactregistry",
    resourceType: "repositories",
    resourceId: "my-repo",
    location: "us-central1",
    raw: "projects/my-project/locations/us-central1/repositories/my-repo",
    ...overrides,
  };
}

describe("ArtifactRegistryChecker", () => {
  it("returns exists=true when repository is found", async () => {
    mockGetRepository.mockResolvedValueOnce([{}]);

    const result = await ArtifactRegistryChecker.check(makeResource());

    expect(result.exists).toBe(true);
    expect(result.service).toBe("artifactregistry");
    expect(result.resourceType).toBe("repositories");
  });

  it("returns exists=false when error code is 5 (NOT_FOUND)", async () => {
    mockGetRepository.mockRejectedValueOnce({ code: 5, message: "not found" });

    const result = await ArtifactRegistryChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false when message contains NOT_FOUND", async () => {
    mockGetRepository.mockRejectedValueOnce({ message: "NOT_FOUND: repository not found" });

    const result = await ArtifactRegistryChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false with error for unexpected errors", async () => {
    mockGetRepository.mockRejectedValueOnce({ message: "Permission denied" });

    const result = await ArtifactRegistryChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("Permission denied");
  });

  it("returns exists=false with 'Unknown error' when no message", async () => {
    mockGetRepository.mockRejectedValueOnce({});

    const result = await ArtifactRegistryChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("Unknown error");
  });

  it("constructs the correct repository name for the API call", async () => {
    mockGetRepository.mockResolvedValueOnce([{}]);

    await ArtifactRegistryChecker.check(makeResource());

    expect(mockGetRepository).toHaveBeenCalledWith({
      name: "projects/my-project/locations/us-central1/repositories/my-repo",
    });
  });
});
