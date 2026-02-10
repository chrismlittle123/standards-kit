vi.mock("@aws-sdk/client-elasticache");

import {
  DescribeCacheClustersCommand,
  DescribeCacheSubnetGroupsCommand,
  DescribeReplicationGroupsCommand,
  ElastiCacheClient,
} from "@aws-sdk/client-elasticache";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { ElastiCacheChecker } from "../../../../src/infra/checkers/elasticache.js";

const mockSend = vi.fn();
vi.mocked(ElastiCacheClient).mockImplementation(
  () => ({ send: mockSend }) as unknown as ElastiCacheClient
);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "elasticache",
    region: "us-east-1",
    accountId: "123456789012",
    resourceType: "cluster",
    resourceId: "my-cluster",
    raw: "arn:aws:elasticache:us-east-1:123456789012:cluster:my-cluster",
    ...overrides,
  };
}

describe("ElastiCacheChecker", () => {
  describe("cluster", () => {
    it("returns exists=true when cluster is available", async () => {
      mockSend.mockResolvedValueOnce({
        CacheClusters: [{ CacheClusterStatus: "available" }],
      });

      const result = await ElastiCacheChecker.check(makeArn());

      expect(result.exists).toBe(true);
      expect(result.service).toBe("elasticache");
      expect(result.resourceType).toBe("cluster");
    });

    it("returns exists=false when cluster is deleting", async () => {
      mockSend.mockResolvedValueOnce({
        CacheClusters: [{ CacheClusterStatus: "deleting" }],
      });

      const result = await ElastiCacheChecker.check(makeArn());

      expect(result.exists).toBe(false);
    });

    it("returns exists=false when CacheClusterNotFoundFault", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "CacheClusterNotFoundFault" })
      );

      const result = await ElastiCacheChecker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("timeout"));

      const result = await ElastiCacheChecker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBe("timeout");
    });
  });

  describe("subnetgroup", () => {
    const subnetArn = makeArn({
      resourceType: "subnetgroup",
      resourceId: "my-subnet-group",
      raw: "arn:aws:elasticache:us-east-1:123456789012:subnetgroup:my-subnet-group",
    });

    it("returns exists=true when subnet group is found", async () => {
      mockSend.mockResolvedValueOnce({
        CacheSubnetGroups: [{ CacheSubnetGroupName: "my-subnet-group" }],
      });

      const result = await ElastiCacheChecker.check(subnetArn);

      expect(result.exists).toBe(true);
      expect(result.resourceType).toBe("subnetgroup");
    });

    it("returns exists=false when CacheSubnetGroupNotFoundFault", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "CacheSubnetGroupNotFoundFault" })
      );

      const result = await ElastiCacheChecker.check(subnetArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("access denied"));

      const result = await ElastiCacheChecker.check(subnetArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBe("access denied");
    });
  });

  describe("replicationgroup", () => {
    const replArn = makeArn({
      resourceType: "replicationgroup",
      resourceId: "my-repl-group",
      raw: "arn:aws:elasticache:us-east-1:123456789012:replicationgroup:my-repl-group",
    });

    it("returns exists=true when replication group is available", async () => {
      mockSend.mockResolvedValueOnce({
        ReplicationGroups: [{ Status: "available" }],
      });

      const result = await ElastiCacheChecker.check(replArn);

      expect(result.exists).toBe(true);
      expect(result.resourceType).toBe("replicationgroup");
    });

    it("returns exists=false when replication group is deleting", async () => {
      mockSend.mockResolvedValueOnce({
        ReplicationGroups: [{ Status: "deleting" }],
      });

      const result = await ElastiCacheChecker.check(replArn);

      expect(result.exists).toBe(false);
    });

    it("returns exists=false when ReplicationGroupNotFoundFault", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "ReplicationGroupNotFoundFault" })
      );

      const result = await ElastiCacheChecker.check(replArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("throttle"));

      const result = await ElastiCacheChecker.check(replArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBe("throttle");
    });
  });

  describe("unsupported resource type", () => {
    it("returns exists=false with error for unsupported type", async () => {
      const arn = makeArn({ resourceType: "parametergroup", resourceId: "pg-123" });

      const result = await ElastiCacheChecker.check(arn);

      expect(result.exists).toBe(false);
      expect(result.error).toContain("Unsupported ElastiCache resource type: parametergroup");
    });
  });
});
