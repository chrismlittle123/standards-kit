vi.mock("@aws-sdk/client-ecs");

import {
  ECSClient,
} from "@aws-sdk/client-ecs";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { ECSChecker } from "../../../../src/infra/checkers/ecs.js";

const mockSend = vi.fn();
vi.mocked(ECSClient).mockImplementation(() => ({ send: mockSend }) as unknown as ECSClient);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "ecs",
    region: "us-east-1",
    accountId: "123456789012",
    resourceType: "cluster",
    resourceId: "my-cluster",
    raw: "arn:aws:ecs:us-east-1:123456789012:cluster/my-cluster",
    ...overrides,
  };
}

describe("ECSChecker", () => {
  describe("cluster", () => {
    it("returns exists=true when cluster is ACTIVE", async () => {
      mockSend.mockResolvedValueOnce({
        clusters: [{ status: "ACTIVE" }],
      });

      const result = await ECSChecker.check(makeArn());

      expect(result.exists).toBe(true);
      expect(result.service).toBe("ecs");
      expect(result.resourceType).toBe("cluster");
    });

    it("returns exists=false when cluster is INACTIVE", async () => {
      mockSend.mockResolvedValueOnce({
        clusters: [{ status: "INACTIVE" }],
      });

      const result = await ECSChecker.check(makeArn());

      expect(result.exists).toBe(false);
    });

    it("returns exists=false with error on API error", async () => {
      mockSend.mockRejectedValueOnce(new Error("timeout"));

      const result = await ECSChecker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBe("timeout");
    });
  });

  describe("service", () => {
    const serviceArn = makeArn({
      resourceType: "service",
      resourceId: "my-cluster/my-service",
      raw: "arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service",
    });

    it("returns exists=true when service is ACTIVE", async () => {
      mockSend.mockResolvedValueOnce({
        services: [{ status: "ACTIVE" }],
      });

      const result = await ECSChecker.check(serviceArn);

      expect(result.exists).toBe(true);
      expect(result.resourceType).toBe("service");
    });

    it("returns exists=false when service is DRAINING", async () => {
      mockSend.mockResolvedValueOnce({
        services: [{ status: "DRAINING" }],
      });

      const result = await ECSChecker.check(serviceArn);

      expect(result.exists).toBe(false);
    });

    it("returns exists=false with error for invalid service ARN format", async () => {
      const badServiceArn = makeArn({
        resourceType: "service",
        resourceId: "no-slash",
        raw: "arn:aws:ecs:us-east-1:123456789012:service/no-slash",
      });

      const result = await ECSChecker.check(badServiceArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBe("Invalid service ARN format");
    });

    it("returns exists=false with error on API error", async () => {
      mockSend.mockRejectedValueOnce(new Error("cluster not found"));

      const result = await ECSChecker.check(serviceArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBe("cluster not found");
    });
  });

  describe("task-definition", () => {
    const taskDefArn = makeArn({
      resourceType: "task-definition",
      resourceId: "my-task:1",
      raw: "arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:1",
    });

    it("returns exists=true when task definition is ACTIVE", async () => {
      mockSend.mockResolvedValueOnce({
        taskDefinition: { status: "ACTIVE" },
      });

      const result = await ECSChecker.check(taskDefArn);

      expect(result.exists).toBe(true);
      expect(result.resourceType).toBe("task-definition");
    });

    it("returns exists=false when task definition is INACTIVE", async () => {
      mockSend.mockResolvedValueOnce({
        taskDefinition: { status: "INACTIVE" },
      });

      const result = await ECSChecker.check(taskDefArn);

      expect(result.exists).toBe(false);
    });

    it("returns exists=false with error on API error", async () => {
      mockSend.mockRejectedValueOnce(new Error("not found"));

      const result = await ECSChecker.check(taskDefArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBe("not found");
    });
  });

  describe("unsupported resource type", () => {
    it("returns exists=false with error for unsupported type", async () => {
      const arn = makeArn({ resourceType: "container-instance", resourceId: "ci-123" });

      const result = await ECSChecker.check(arn);

      expect(result.exists).toBe(false);
      expect(result.error).toContain("Unsupported ECS resource type: container-instance");
    });
  });
});
