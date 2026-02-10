vi.mock("@aws-sdk/client-sns");

import { GetTopicAttributesCommand, SNSClient } from "@aws-sdk/client-sns";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { SNSChecker } from "../../../../src/infra/checkers/sns.js";

const mockSend = vi.fn();
vi.mocked(SNSClient).mockImplementation(() => ({ send: mockSend }) as unknown as SNSClient);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "sns",
    region: "us-east-1",
    accountId: "123456789012",
    resourceType: "topic",
    resourceId: "my-topic",
    raw: "arn:aws:sns:us-east-1:123456789012:my-topic",
    ...overrides,
  };
}

describe("SNSChecker", () => {
  it("returns exists=true when topic is found", async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await SNSChecker.check(makeArn());

    expect(result.exists).toBe(true);
    expect(result.service).toBe("sns");
    expect(result.resourceType).toBe("topic");
  });

  it("returns exists=false when NotFoundException", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { name: "NotFoundException" })
    );

    const result = await SNSChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false when NotFound", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { name: "NotFound" })
    );

    const result = await SNSChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false with error for unexpected errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("access denied"));

    const result = await SNSChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("access denied");
  });
});
