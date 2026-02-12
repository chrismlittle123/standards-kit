vi.mock("@aws-sdk/client-ec2");

import {
  EC2Client,
} from "@aws-sdk/client-ec2";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { EC2Checker } from "../../../../src/infra/checkers/ec2.js";

const mockSend = vi.fn();
vi.mocked(EC2Client).mockImplementation(() => ({ send: mockSend }) as unknown as EC2Client);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "ec2",
    region: "us-east-1",
    accountId: "123456789012",
    resourceType: "instance",
    resourceId: "i-12345",
    raw: "arn:aws:ec2:us-east-1:123456789012:instance/i-12345",
    ...overrides,
  };
}

describe("EC2Checker", () => {
  describe("instance", () => {
    it("returns exists=true when instance is running", async () => {
      mockSend.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: "running" } }] }],
      });

      const result = await EC2Checker.check(makeArn());

      expect(result.exists).toBe(true);
      expect(result.service).toBe("ec2");
      expect(result.resourceType).toBe("instance");
    });

    it("returns exists=false when instance is terminated", async () => {
      mockSend.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: "terminated" } }] }],
      });

      const result = await EC2Checker.check(makeArn());

      expect(result.exists).toBe(false);
    });

    it("returns exists=false when InvalidInstanceID.NotFound", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "InvalidInstanceID.NotFound" })
      );

      const result = await EC2Checker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("timeout"));

      const result = await EC2Checker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBe("timeout");
    });
  });

  describe("security-group", () => {
    const sgArn = makeArn({
      resourceType: "security-group",
      resourceId: "sg-12345",
      raw: "arn:aws:ec2:us-east-1:123456789012:security-group/sg-12345",
    });

    it("returns exists=true when security group is found", async () => {
      mockSend.mockResolvedValueOnce({
        SecurityGroups: [{ GroupId: "sg-12345" }],
      });

      const result = await EC2Checker.check(sgArn);

      expect(result.exists).toBe(true);
      expect(result.resourceType).toBe("security-group");
    });

    it("returns exists=false when InvalidGroup.NotFound", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "InvalidGroup.NotFound" })
      );

      const result = await EC2Checker.check(sgArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("access denied"));

      const result = await EC2Checker.check(sgArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBe("access denied");
    });
  });

  describe("key-pair", () => {
    const kpArn = makeArn({
      resourceType: "key-pair",
      resourceId: "my-key",
      raw: "arn:aws:ec2:us-east-1:123456789012:key-pair/my-key",
    });

    it("returns exists=true when key pair is found", async () => {
      mockSend.mockResolvedValueOnce({
        KeyPairs: [{ KeyName: "my-key" }],
      });

      const result = await EC2Checker.check(kpArn);

      expect(result.exists).toBe(true);
      expect(result.resourceType).toBe("key-pair");
    });

    it("returns exists=false when InvalidKeyPair.NotFound", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "InvalidKeyPair.NotFound" })
      );

      const result = await EC2Checker.check(kpArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("timeout"));

      const result = await EC2Checker.check(kpArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBe("timeout");
    });
  });

  describe("unsupported resource type", () => {
    it("returns exists=false with error for unsupported type", async () => {
      const arn = makeArn({ resourceType: "vpc", resourceId: "vpc-123" });

      const result = await EC2Checker.check(arn);

      expect(result.exists).toBe(false);
      expect(result.error).toContain("Unsupported EC2 resource type: vpc");
    });
  });
});
