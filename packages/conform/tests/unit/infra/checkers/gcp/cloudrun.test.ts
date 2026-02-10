vi.mock("@google-cloud/run");

import { ServicesClient } from "@google-cloud/run";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedGcpResource } from "../../../../../src/infra/types.js";
import { CloudRunChecker } from "../../../../../src/infra/checkers/gcp/cloudrun.js";

const mockGetService = vi.fn();
vi.mocked(ServicesClient).mockImplementation(
  () => ({ getService: mockGetService }) as unknown as ServicesClient
);

beforeEach(() => vi.clearAllMocks());

function makeResource(overrides: Partial<ParsedGcpResource> = {}): ParsedGcpResource {
  return {
    cloud: "gcp",
    project: "my-project",
    service: "run",
    resourceType: "services",
    resourceId: "my-service",
    location: "us-central1",
    raw: "projects/my-project/locations/us-central1/services/my-service",
    ...overrides,
  };
}

describe("CloudRunChecker", () => {
  it("returns exists=true when service is found", async () => {
    mockGetService.mockResolvedValueOnce([{}]);

    const result = await CloudRunChecker.check(makeResource());

    expect(result.exists).toBe(true);
    expect(result.service).toBe("run");
    expect(result.resourceType).toBe("services");
  });

  it("returns exists=false when error code is 5 (NOT_FOUND)", async () => {
    mockGetService.mockRejectedValueOnce({ code: 5, message: "not found" });

    const result = await CloudRunChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false when message contains NOT_FOUND", async () => {
    mockGetService.mockRejectedValueOnce({ message: "NOT_FOUND: service not found" });

    const result = await CloudRunChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false with error for unexpected errors", async () => {
    mockGetService.mockRejectedValueOnce({ message: "Permission denied" });

    const result = await CloudRunChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("Permission denied");
  });

  it("returns exists=false with 'Unknown error' when no message", async () => {
    mockGetService.mockRejectedValueOnce({});

    const result = await CloudRunChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("Unknown error");
  });

  it("constructs the correct service name for the API call", async () => {
    mockGetService.mockResolvedValueOnce([{}]);

    await CloudRunChecker.check(makeResource());

    expect(mockGetService).toHaveBeenCalledWith({
      name: "projects/my-project/locations/us-central1/services/my-service",
    });
  });
});
