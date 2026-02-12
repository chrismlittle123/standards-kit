vi.mock("@aws-sdk/client-s3");

import { S3Client } from "@aws-sdk/client-s3";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { S3Checker } from "../../../../src/infra/checkers/s3.js";

const mockSend = vi.fn();
vi.mocked(S3Client).mockImplementation(() => ({ send: mockSend }) as unknown as S3Client);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "s3",
    region: "",
    accountId: "",
    resourceType: "bucket",
    resourceId: "my-bucket",
    raw: "arn:aws:s3:::my-bucket",
    ...overrides,
  };
}

describe("S3Checker", () => {
  describe("bucket", () => {
    it("returns exists=true when bucket is found", async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await S3Checker.check(makeArn());

      expect(result.exists).toBe(true);
      expect(result.service).toBe("s3");
      expect(result.resourceType).toBe("bucket");
    });

    it("returns exists=false when NotFound", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "NotFound", $metadata: {} })
      );

      const result = await S3Checker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false when NoSuchBucket", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("no such bucket"), { name: "NoSuchBucket", $metadata: {} })
      );

      const result = await S3Checker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false when httpStatusCode is 404", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "SomeError", $metadata: { httpStatusCode: 404 } })
      );

      const result = await S3Checker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false when Forbidden (bucket enumeration prevention)", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("forbidden"), { name: "Forbidden", $metadata: {} })
      );

      const result = await S3Checker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false when AccessDenied", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("access denied"), { name: "AccessDenied", $metadata: {} })
      );

      const result = await S3Checker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false when httpStatusCode is 403", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("forbidden"), { name: "SomeError", $metadata: { httpStatusCode: 403 } })
      );

      const result = await S3Checker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("timeout"), { name: "TimeoutError", $metadata: { httpStatusCode: 500 } })
      );

      const result = await S3Checker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBe("timeout");
    });
  });

  describe("object", () => {
    it("checks the bucket for object ARNs", async () => {
      mockSend.mockResolvedValueOnce({});

      const arn = makeArn({
        resourceType: "object",
        resourceId: "my-bucket/path/to/key",
        raw: "arn:aws:s3:::my-bucket/path/to/key",
      });

      const result = await S3Checker.check(arn);

      expect(result.exists).toBe(true);
      expect(result.resourceType).toBe("bucket");
      expect(result.resourceId).toBe("my-bucket");
    });
  });
});
