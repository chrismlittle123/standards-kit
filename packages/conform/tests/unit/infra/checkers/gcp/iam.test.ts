vi.mock("google-auth-library");

import { GoogleAuth } from "google-auth-library";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedGcpResource } from "../../../../../src/infra/types.js";
import { ServiceAccountChecker } from "../../../../../src/infra/checkers/gcp/iam.js";

const mockRequest = vi.fn();
const mockGetClient = vi.fn().mockResolvedValue({ request: mockRequest });
vi.mocked(GoogleAuth).mockImplementation(
  () => ({ getClient: mockGetClient }) as unknown as GoogleAuth
);

beforeEach(() => vi.clearAllMocks());

function makeResource(overrides: Partial<ParsedGcpResource> = {}): ParsedGcpResource {
  return {
    cloud: "gcp",
    project: "my-project",
    service: "iam",
    resourceType: "serviceAccounts",
    resourceId: "sa@my-project.iam.gserviceaccount.com",
    location: "",
    raw: "projects/my-project/serviceAccounts/sa@my-project.iam.gserviceaccount.com",
    ...overrides,
  };
}

describe("ServiceAccountChecker", () => {
  it("returns exists=true when service account is found", async () => {
    mockRequest.mockResolvedValueOnce({});

    const result = await ServiceAccountChecker.check(makeResource());

    expect(result.exists).toBe(true);
    expect(result.service).toBe("iam");
    expect(result.resourceType).toBe("serviceAccounts");
  });

  it("returns exists=false when response status is 404", async () => {
    mockRequest.mockRejectedValueOnce({ response: { status: 404 }, message: "Not found" });

    const result = await ServiceAccountChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false when error code is 404", async () => {
    mockRequest.mockRejectedValueOnce({ code: 404, message: "Not found" });

    const result = await ServiceAccountChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false when message contains NOT_FOUND", async () => {
    mockRequest.mockRejectedValueOnce({ message: "NOT_FOUND: resource not found" });

    const result = await ServiceAccountChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false with error for unexpected errors", async () => {
    mockRequest.mockRejectedValueOnce({ message: "Permission denied" });

    const result = await ServiceAccountChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("Permission denied");
  });

  it("returns exists=false with 'Unknown error' when no message", async () => {
    mockRequest.mockRejectedValueOnce({});

    const result = await ServiceAccountChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("Unknown error");
  });
});
