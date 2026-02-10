vi.mock("@aws-sdk/client-sqs");

import { GetQueueAttributesCommand, GetQueueUrlCommand, SQSClient } from "@aws-sdk/client-sqs";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { SQSChecker } from "../../../../src/infra/checkers/sqs.js";

const mockSend = vi.fn();
vi.mocked(SQSClient).mockImplementation(() => ({ send: mockSend }) as unknown as SQSClient);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "sqs",
    region: "us-east-1",
    accountId: "123456789012",
    resourceType: "queue",
    resourceId: "my-queue",
    raw: "arn:aws:sqs:us-east-1:123456789012:my-queue",
    ...overrides,
  };
}

describe("SQSChecker", () => {
  it("returns exists=true when queue is found", async () => {
    mockSend
      .mockResolvedValueOnce({ QueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/my-queue" })
      .mockResolvedValueOnce({});

    const result = await SQSChecker.check(makeArn());

    expect(result.exists).toBe(true);
    expect(result.service).toBe("sqs");
    expect(result.resourceType).toBe("queue");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("returns exists=false when QueueDoesNotExist", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("queue not found"), { name: "QueueDoesNotExist" })
    );

    const result = await SQSChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false when AWS.SimpleQueueService.NonExistentQueue", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("queue not found"), {
        name: "AWS.SimpleQueueService.NonExistentQueue",
      })
    );

    const result = await SQSChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false with error for unexpected errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("timeout"));

    const result = await SQSChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("timeout");
  });
});
