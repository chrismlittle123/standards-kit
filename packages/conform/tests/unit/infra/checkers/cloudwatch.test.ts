vi.mock("@aws-sdk/client-cloudwatch-logs");

import { CloudWatchLogsClient, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { CloudWatchLogsChecker } from "../../../../src/infra/checkers/cloudwatch.js";

const mockSend = vi.fn();
vi.mocked(CloudWatchLogsClient).mockImplementation(
  () => ({ send: mockSend }) as unknown as CloudWatchLogsClient
);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "logs",
    region: "us-east-1",
    accountId: "123456789012",
    resourceType: "log-group",
    resourceId: "/my/log-group",
    raw: "arn:aws:logs:us-east-1:123456789012:log-group:/my/log-group",
    ...overrides,
  };
}

describe("CloudWatchLogsChecker", () => {
  it("returns exists=true when log group is found with exact match", async () => {
    mockSend.mockResolvedValueOnce({
      logGroups: [{ logGroupName: "/my/log-group" }],
    });

    const result = await CloudWatchLogsChecker.check(makeArn());

    expect(result.exists).toBe(true);
    expect(result.service).toBe("logs");
    expect(result.resourceType).toBe("log-group");
  });

  it("returns exists=false when log group prefix matches but no exact match", async () => {
    mockSend.mockResolvedValueOnce({
      logGroups: [{ logGroupName: "/my/log-group-other" }],
    });

    const result = await CloudWatchLogsChecker.check(makeArn());

    expect(result.exists).toBe(false);
  });

  it("returns exists=false when no log groups returned", async () => {
    mockSend.mockResolvedValueOnce({
      logGroups: [],
    });

    const result = await CloudWatchLogsChecker.check(makeArn());

    expect(result.exists).toBe(false);
  });

  it("returns exists=false when ResourceNotFoundException", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { name: "ResourceNotFoundException" })
    );

    const result = await CloudWatchLogsChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns exists=false with error for unexpected errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("timeout"));

    const result = await CloudWatchLogsChecker.check(makeArn());

    expect(result.exists).toBe(false);
    expect(result.error).toBe("timeout");
  });
});
