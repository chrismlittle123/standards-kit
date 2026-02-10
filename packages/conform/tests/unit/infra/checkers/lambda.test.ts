vi.mock("@aws-sdk/client-lambda");

import { GetFunctionCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { LambdaChecker } from "../../../../src/infra/checkers/lambda.js";

const mockSend = vi.fn();
vi.mocked(LambdaClient).mockImplementation(() => ({ send: mockSend }) as unknown as LambdaClient);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "lambda",
    region: "us-east-1",
    accountId: "123456789012",
    resourceType: "function",
    resourceId: "my-func",
    raw: "arn:aws:lambda:us-east-1:123456789012:function:my-func",
    ...overrides,
  };
}

describe("LambdaChecker", () => {
  it("returns exists=true when function is found", async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await LambdaChecker.check(makeArn());

    expect(result.exists).toBe(true);
    expect(result.service).toBe("lambda");
    expect(result.resourceType).toBe("function");
  });

  it("returns exists=false when ResourceNotFoundException", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { name: "ResourceNotFoundException" })
    );

    const result = await LambdaChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false with error for unexpected errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("timeout"));

    const result = await LambdaChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("returns exists=false with error for unsupported resource type", async () => {
    const arn = makeArn({ resourceType: "layer", resourceId: "my-layer" });

    const result = await LambdaChecker.check(arn);

    expect(result.exists).toBe(false);
    expect(result.error).toContain("Unsupported Lambda resource type: layer");
  });
});
