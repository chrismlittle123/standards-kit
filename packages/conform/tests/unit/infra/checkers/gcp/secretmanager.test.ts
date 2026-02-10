vi.mock("@google-cloud/secret-manager");

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedGcpResource } from "../../../../../src/infra/types.js";
import { SecretManagerChecker } from "../../../../../src/infra/checkers/gcp/secretmanager.js";

const mockGetSecret = vi.fn();
vi.mocked(SecretManagerServiceClient).mockImplementation(
  () => ({ getSecret: mockGetSecret }) as unknown as SecretManagerServiceClient
);

beforeEach(() => vi.clearAllMocks());

function makeResource(overrides: Partial<ParsedGcpResource> = {}): ParsedGcpResource {
  return {
    cloud: "gcp",
    project: "my-project",
    service: "secretmanager",
    resourceType: "secrets",
    resourceId: "my-secret",
    location: "",
    raw: "projects/my-project/secrets/my-secret",
    ...overrides,
  };
}

describe("SecretManagerChecker", () => {
  it("returns exists=true when secret is found", async () => {
    mockGetSecret.mockResolvedValueOnce([{}]);

    const result = await SecretManagerChecker.check(makeResource());

    expect(result.exists).toBe(true);
    expect(result.service).toBe("secretmanager");
    expect(result.resourceType).toBe("secrets");
  });

  it("returns exists=false when error code is 5 (NOT_FOUND)", async () => {
    mockGetSecret.mockRejectedValueOnce({ code: 5, message: "not found" });

    const result = await SecretManagerChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false when message contains NOT_FOUND", async () => {
    mockGetSecret.mockRejectedValueOnce({ message: "NOT_FOUND: secret not found" });

    const result = await SecretManagerChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false with error for unexpected errors", async () => {
    mockGetSecret.mockRejectedValueOnce({ message: "Permission denied" });

    const result = await SecretManagerChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("Permission denied");
  });

  it("returns exists=false with 'Unknown error' when no message", async () => {
    mockGetSecret.mockRejectedValueOnce({});

    const result = await SecretManagerChecker.check(makeResource());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("Unknown error");
  });

  it("constructs the correct secret name for the API call", async () => {
    mockGetSecret.mockResolvedValueOnce([{}]);

    await SecretManagerChecker.check(makeResource());

    expect(mockGetSecret).toHaveBeenCalledWith({
      name: "projects/my-project/secrets/my-secret",
    });
  });
});
