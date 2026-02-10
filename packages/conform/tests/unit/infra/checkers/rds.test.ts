vi.mock("@aws-sdk/client-rds");

import {
  DescribeDBInstancesCommand,
  DescribeDBClustersCommand,
  DescribeDBSubnetGroupsCommand,
  RDSClient,
} from "@aws-sdk/client-rds";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ParsedArn } from "../../../../src/infra/types.js";
import { RDSChecker } from "../../../../src/infra/checkers/rds.js";

const mockSend = vi.fn();
vi.mocked(RDSClient).mockImplementation(() => ({ send: mockSend }) as unknown as RDSClient);

beforeEach(() => vi.clearAllMocks());

function makeArn(overrides: Partial<ParsedArn> = {}): ParsedArn {
  return {
    cloud: "aws",
    partition: "aws",
    service: "rds",
    region: "us-east-1",
    accountId: "123456789012",
    resourceType: "db",
    resourceId: "my-db",
    raw: "arn:aws:rds:us-east-1:123456789012:db:my-db",
    ...overrides,
  };
}

describe("RDSChecker", () => {
  describe("db instance", () => {
    it("returns exists=true when instance is available", async () => {
      mockSend.mockResolvedValueOnce({
        DBInstances: [{ DBInstanceStatus: "available" }],
      });

      const result = await RDSChecker.check(makeArn());

      expect(result.exists).toBe(true);
      expect(result.service).toBe("rds");
      expect(result.resourceType).toBe("db");
    });

    it("returns exists=false when instance is deleting", async () => {
      mockSend.mockResolvedValueOnce({
        DBInstances: [{ DBInstanceStatus: "deleting" }],
      });

      const result = await RDSChecker.check(makeArn());

      expect(result.exists).toBe(false);
    });

    it("returns exists=false when DBInstanceNotFoundFault", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "DBInstanceNotFoundFault" })
      );

      const result = await RDSChecker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("timeout"));

      const result = await RDSChecker.check(makeArn());

      expect(result.exists).toBe(false);
      expect(result.error).toBe("timeout");
    });
  });

  describe("cluster", () => {
    const clusterArn = makeArn({
      resourceType: "cluster",
      resourceId: "my-cluster",
      raw: "arn:aws:rds:us-east-1:123456789012:cluster:my-cluster",
    });

    it("returns exists=true when cluster is available", async () => {
      mockSend.mockResolvedValueOnce({
        DBClusters: [{ Status: "available" }],
      });

      const result = await RDSChecker.check(clusterArn);

      expect(result.exists).toBe(true);
      expect(result.resourceType).toBe("cluster");
    });

    it("returns exists=false when cluster is deleting", async () => {
      mockSend.mockResolvedValueOnce({
        DBClusters: [{ Status: "deleting" }],
      });

      const result = await RDSChecker.check(clusterArn);

      expect(result.exists).toBe(false);
    });

    it("returns exists=false when DBClusterNotFoundFault", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "DBClusterNotFoundFault" })
      );

      const result = await RDSChecker.check(clusterArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("access denied"));

      const result = await RDSChecker.check(clusterArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBe("access denied");
    });
  });

  describe("subgrp", () => {
    const subgrpArn = makeArn({
      resourceType: "subgrp",
      resourceId: "my-subnet-group",
      raw: "arn:aws:rds:us-east-1:123456789012:subgrp:my-subnet-group",
    });

    it("returns exists=true when subnet group is found", async () => {
      mockSend.mockResolvedValueOnce({
        DBSubnetGroups: [{ DBSubnetGroupName: "my-subnet-group" }],
      });

      const result = await RDSChecker.check(subgrpArn);

      expect(result.exists).toBe(true);
      expect(result.resourceType).toBe("subgrp");
    });

    it("returns exists=false when DBSubnetGroupNotFoundFault", async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { name: "DBSubnetGroupNotFoundFault" })
      );

      const result = await RDSChecker.check(subgrpArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns exists=false with error for unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("throttle"));

      const result = await RDSChecker.check(subgrpArn);

      expect(result.exists).toBe(false);
      expect(result.error).toBe("throttle");
    });
  });

  describe("unsupported resource type", () => {
    it("returns exists=false with error for unsupported type", async () => {
      const arn = makeArn({ resourceType: "snapshot", resourceId: "snap-123" });

      const result = await RDSChecker.check(arn);

      expect(result.exists).toBe(false);
      expect(result.error).toContain("Unsupported RDS resource type: snapshot");
    });
  });
});
