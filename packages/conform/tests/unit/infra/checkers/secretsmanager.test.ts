vi.mock("@aws-sdk/client-secrets-manager");

import { DescribeSecretCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { SecretsManagerChecker } from "../../../../src/infra/checkers/secretsmanager.js";

const mockSend = vi.fn();
vi.mocked(SecretsManagerClient).mockImplementation(
  () => ({ send: mockSend }) as unknown as SecretsManagerClient
);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "secretsmanager",
    region: "us-east-1",
    accountId: "123456789012",
    resourceType: "secret",
    resourceId: "my-secret",
    raw: "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret",
    ...overrides,
  };
}

describe("SecretsManagerChecker", () => {
  it("returns exists=true when secret is found", async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await SecretsManagerChecker.check(makeArn());

    expect(result.exists).toBe(true);
    expect(result.service).toBe("secretsmanager");
    expect(result.resourceType).toBe("secret");
  });

  it("returns exists=false when ResourceNotFoundException", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { name: "ResourceNotFoundException" })
    );

    const result = await SecretsManagerChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false with error for unexpected errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("throttle"));

    const result = await SecretsManagerChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("throttle");
  });
});
