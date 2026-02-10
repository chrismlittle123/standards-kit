vi.mock("@aws-sdk/client-iam");

import { GetPolicyCommand, GetRoleCommand, IAMClient } from "@aws-sdk/client-iam";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { IAMChecker } from "../../../../src/infra/checkers/iam.js";

const mockSend = vi.fn();
vi.mocked(IAMClient).mockImplementation(() => ({ send: mockSend }) as unknown as IAMClient);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "iam",
    region: "",
    accountId: "123456789012",
    resourceType: "role",
    resourceId: "my-role",
    raw: "arn:aws:iam::123456789012:role/my-role",
    ...overrides,
  };
}

describe("IAMChecker", () => {
  describe("role", () => {
    it("returns exists=true when role is found", async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await IAMChecker.check(makeArn());

      expect(result.exists).toBe(true);
      expect(result.service).toBe("iam");
      expect(result.resourceType).toBe("role");
    });

    it("returns exists=false when NoSuchEntityException", async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error("not found"), { name: "NoSuchEntityException" }));

      const result = await IAMChecker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }));

      const result = await IAMChecker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBe("timeout");
    });
  });

  describe("policy", () => {
    const policyArn = makeArn({
      resourceType: "policy",
      resourceId: "my-policy",
      raw: "arn:aws:iam::123456789012:policy/my-policy",
    });

    it("returns exists=true when policy is found", async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await IAMChecker.check(policyArn);

      expect(result.exists).toBe(true);
      expect(result.resourceType).toBe("policy");
    });

    it("returns exists=false when NoSuchEntityException", async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error("not found"), { name: "NoSuchEntityException" }));

      const result = await IAMChecker.check(policyArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error("access denied"), { name: "AccessDenied" }));

      const result = await IAMChecker.check(policyArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBe("access denied");
    });
  });

  describe("unsupported resource type", () => {
    it("returns exists=false with error for unsupported type", async () => {
      const arn = makeArn({ resourceType: "group", resourceId: "my-group" });

      const result = await IAMChecker.check(arn);

      expect(result.exists).toBe(false);
      expect(result.error).toContain("Unsupported IAM resource type: group");
    });
  });
});
