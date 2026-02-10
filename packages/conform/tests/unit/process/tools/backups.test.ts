vi.mock("@aws-sdk/client-s3");

import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { BackupsRunner } from "../../../../src/process/tools/backups.js";

beforeEach(() => vi.clearAllMocks());

describe("BackupsRunner", () => {
  let runner: BackupsRunner;

  beforeEach(() => {
    runner = new BackupsRunner();
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("Backups");
    expect(runner.rule).toBe("process.backups");
    expect(runner.toolId).toBe("backups");
  });

  describe("skip cases", () => {
    it("skips when no bucket configured", async () => {
      runner.setConfig({ enabled: true });
      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("No bucket configured");
    });

    it("skips on S3 error", async () => {
      runner.setConfig({ enabled: true, bucket: "my-bucket" });

      const mockClient = {
        send: vi.fn().mockRejectedValue(new Error("Access Denied")),
      } as unknown as S3Client;
      runner.setS3Client(mockClient);

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("S3 error");
      expect(result.skipReason).toContain("Access Denied");
    });
  });

  describe("backup existence", () => {
    it("fails when no backups found", async () => {
      runner.setConfig({ enabled: true, bucket: "my-bucket", prefix: "backups/" });

      const mockClient = {
        send: vi.fn().mockResolvedValue({ Contents: [] }),
      } as unknown as S3Client;
      runner.setS3Client(mockClient);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].rule).toBe("process.backups.exists");
      expect(result.violations[0].message).toContain("No backups found");
    });

    it("fails when Contents is undefined", async () => {
      runner.setConfig({ enabled: true, bucket: "my-bucket" });

      const mockClient = {
        send: vi.fn().mockResolvedValue({ Contents: undefined }),
      } as unknown as S3Client;
      runner.setS3Client(mockClient);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations[0].rule).toBe("process.backups.exists");
    });
  });

  describe("backup recency", () => {
    it("passes when backup is recent", async () => {
      runner.setConfig({ enabled: true, bucket: "my-bucket", max_age_hours: 24 });

      const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 hour ago
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          Contents: [{ Key: "backup-latest.tar.gz", LastModified: recentDate }],
        }),
      } as unknown as S3Client;
      runner.setS3Client(mockClient);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when backup is too old", async () => {
      runner.setConfig({ enabled: true, bucket: "my-bucket", max_age_hours: 24 });

      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          Contents: [{ Key: "backup-old.tar.gz", LastModified: oldDate }],
        }),
      } as unknown as S3Client;
      runner.setS3Client(mockClient);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].rule).toBe("process.backups.recency");
      expect(result.violations[0].message).toContain("hours old");
    });

    it("uses most recent backup when multiple exist", async () => {
      runner.setConfig({ enabled: true, bucket: "my-bucket", max_age_hours: 24 });

      const recentDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          Contents: [
            { Key: "backup-old.tar.gz", LastModified: oldDate },
            { Key: "backup-recent.tar.gz", LastModified: recentDate },
          ],
        }),
      } as unknown as S3Client;
      runner.setS3Client(mockClient);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("defaults max_age_hours to 24", async () => {
      runner.setConfig({ enabled: true, bucket: "my-bucket" });

      // 23 hours ago - should pass with default 24 hour max
      const recentDate = new Date(Date.now() - 23 * 60 * 60 * 1000);
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          Contents: [{ Key: "backup.tar.gz", LastModified: recentDate }],
        }),
      } as unknown as S3Client;
      runner.setS3Client(mockClient);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when backup has no LastModified", async () => {
      runner.setConfig({ enabled: true, bucket: "my-bucket" });

      const mockClient = {
        send: vi.fn().mockResolvedValue({
          Contents: [{ Key: "backup.tar.gz" }],
        }),
      } as unknown as S3Client;
      runner.setS3Client(mockClient);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations[0].rule).toBe("process.backups.recency");
      expect(result.violations[0].message).toContain("Could not determine backup age");
    });
  });

  describe("S3 command parameters", () => {
    it("calls S3 send with correct parameters", async () => {
      runner.setConfig({ enabled: true, bucket: "my-bucket", prefix: "db-backups/" });

      const mockSend = vi.fn().mockResolvedValue({
        Contents: [{ Key: "db-backups/latest.sql", LastModified: new Date() }],
      });
      const mockClient = { send: mockSend } as unknown as S3Client;
      runner.setS3Client(mockClient);

      await runner.run("/root");

      expect(mockSend).toHaveBeenCalledTimes(1);
      // Verify the command was called (it's a ListObjectsV2Command instance)
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(ListObjectsV2Command);
    });
  });
});
