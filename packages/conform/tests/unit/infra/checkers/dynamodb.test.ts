vi.mock("@aws-sdk/client-dynamodb");

import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { DynamoDBChecker } from "../../../../src/infra/checkers/dynamodb.js";

const mockSend = vi.fn();
vi.mocked(DynamoDBClient).mockImplementation(() => ({ send: mockSend }) as unknown as DynamoDBClient);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "dynamodb",
    region: "us-east-1",
    accountId: "123456789012",
    resourceType: "table",
    resourceId: "my-table",
    raw: "arn:aws:dynamodb:us-east-1:123456789012:table/my-table",
    ...overrides,
  };
}

describe("DynamoDBChecker", () => {
  it("returns exists=true when table is found", async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await DynamoDBChecker.check(makeArn());

    expect(result.exists).toBe(true);
    expect(result.service).toBe("dynamodb");
    expect(result.resourceType).toBe("table");
  });

  it("returns exists=false when ResourceNotFoundException", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { name: "ResourceNotFoundException" })
    );

    const result = await DynamoDBChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false with error for unexpected errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("timeout"));

    const result = await DynamoDBChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("extracts table name from resourceId with index path", async () => {
    mockSend.mockResolvedValueOnce({});

    const arn = makeArn({
      resourceType: "index",
      resourceId: "my-table/index/my-index",
      raw: "arn:aws:dynamodb:us-east-1:123456789012:table/my-table/index/my-index",
    });

    const result = await DynamoDBChecker.check(arn);

    expect(result.exists).toBe(true);
  });
});
