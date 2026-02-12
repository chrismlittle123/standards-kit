vi.mock("@aws-sdk/client-elastic-load-balancing-v2");

import {
  ElasticLoadBalancingV2Client,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { ELBChecker } from "../../../../src/infra/checkers/elb.js";

const mockSend = vi.fn();
vi.mocked(ElasticLoadBalancingV2Client).mockImplementation(
  () => ({ send: mockSend }) as unknown as ElasticLoadBalancingV2Client
);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "elasticloadbalancing",
    region: "us-east-1",
    accountId: "123456789012",
    resourceType: "loadbalancer",
    resourceId: "app/my-lb/abc123",
    raw: "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-lb/abc123",
    ...overrides,
  };
}

describe("ELBChecker", () => {
  describe("loadbalancer", () => {
    it("returns exists=true when load balancer is active", async () => {
      mockSend.mockResolvedValueOnce({
        LoadBalancers: [{ State: { Code: "active" } }],
      });

      const result = await ELBChecker.check(makeArn());

      expect(result.exists).toBe(true);
      expect(result.service).toBe("elasticloadbalancing");
      expect(result.resourceType).toBe("loadbalancer");
    });

    it("returns exists=false when load balancer state is failed", async () => {
      mockSend.mockResolvedValueOnce({
        LoadBalancers: [{ State: { Code: "failed" } }],
      });

      const result = await ELBChecker.check(makeArn());

      expect(result.exists).toBe(false);
    });

    it("returns exists=false when load balancer state is active_impaired", async () => {
      mockSend.mockResolvedValueOnce({
        LoadBalancers: [{ State: { Code: "active_impaired" } }],
      });

      const result = await ELBChecker.check(makeArn());

      expect(result.exists).toBe(false);
    });

    it("returns exists=false when LoadBalancerNotFoundException", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "LoadBalancerNotFoundException" })
      );

      const result = await ELBChecker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("timeout"));

      const result = await ELBChecker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBe("timeout");
    });
  });

  describe("targetgroup", () => {
    const tgArn = makeArn({
      resourceType: "targetgroup",
      resourceId: "my-tg/abc123",
      raw: "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-tg/abc123",
    });

    it("returns exists=true when target group is found", async () => {
      mockSend.mockResolvedValueOnce({
        TargetGroups: [{ TargetGroupName: "my-tg" }],
      });

      const result = await ELBChecker.check(tgArn);

      expect(result.exists).toBe(true);
      expect(result.resourceType).toBe("targetgroup");
    });

    it("returns exists=false when TargetGroupNotFoundException", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "TargetGroupNotFoundException" })
      );

      const result = await ELBChecker.check(tgArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("access denied"));

      const result = await ELBChecker.check(tgArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBe("access denied");
    });
  });

  describe("listener", () => {
    const listenerArn = makeArn({
      resourceType: "listener",
      resourceId: "app/my-lb/abc123/def456",
      raw: "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-lb/abc123/def456",
    });

    it("returns exists=true when listener is found", async () => {
      mockSend.mockResolvedValueOnce({
        Listeners: [{ ListenerArn: listenerArn.raw }],
      });

      const result = await ELBChecker.check(listenerArn);

      expect(result.exists).toBe(true);
      expect(result.resourceType).toBe("listener");
    });

    it("returns exists=false when ListenerNotFoundException", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "ListenerNotFoundException" })
      );

      const result = await ELBChecker.check(listenerArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("throttle"));

      const result = await ELBChecker.check(listenerArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBe("throttle");
    });
  });

  describe("unsupported resource type", () => {
    it("returns exists=false with error for unsupported type", async () => {
      const arn = makeArn({ resourceType: "rule", resourceId: "rule-123" });

      const result = await ELBChecker.check(arn);

      expect(result.exists).toBe(false);
      expect(result.error).toContain("Unsupported ELB resource type: rule");
    });
  });
});
