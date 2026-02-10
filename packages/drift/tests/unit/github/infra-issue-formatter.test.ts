import { describe, it, expect } from "vitest";
import {
  formatInfraDriftIssueBody,
  getInfraDriftIssueTitle,
  getInfraDriftIssueLabel,
} from "../../../src/github/infra-issue-formatter.js";
import type { InfraDriftDetection } from "../../../src/types.js";

describe("infra-issue-formatter", () => {
  describe("getInfraDriftIssueTitle", () => {
    it("returns correct title", () => {
      expect(getInfraDriftIssueTitle()).toBe(
        "[drift:infra] Infrastructure drift detected"
      );
    });
  });

  describe("getInfraDriftIssueLabel", () => {
    it("returns correct label", () => {
      expect(getInfraDriftIssueLabel()).toBe("drift:infra");
    });
  });

  describe("formatInfraDriftIssueBody", () => {
    it("formats detection with missing resources", () => {
      const detection: InfraDriftDetection = {
        repository: "org/infra-repo",
        scanTime: "2024-03-10 08:00 UTC",
        manifest: "infra-manifest.yaml",
        summary: { total: 3, found: 1, missing: 2, errors: 0 },
        resources: [
          {
            arn: "arn:aws:s3:::my-bucket",
            exists: true,
            service: "s3",
            resourceType: "Bucket",
            resourceId: "my-bucket",
          },
          {
            arn: "arn:aws:lambda:us-east-1:123:function:fn-a",
            exists: false,
            service: "lambda",
            resourceType: "Function",
            resourceId: "fn-a",
          },
          {
            arn: "arn:aws:sqs:us-east-1:123:my-queue",
            exists: false,
            service: "sqs",
            resourceType: "Queue",
            resourceId: "my-queue",
          },
        ],
      };

      const body = formatInfraDriftIssueBody(detection);

      expect(body).toContain("## Infrastructure Drift Detected");
      expect(body).toContain("`org/infra-repo`");
      expect(body).toContain("2024-03-10 08:00 UTC");
      expect(body).toContain("### Summary");
      expect(body).toContain("| 3 | 1 | 2 | 0 |");
      expect(body).toContain("### Missing Resources");
      expect(body).toContain(
        "| `arn:aws:lambda:us-east-1:123:function:fn-a` | lambda | Function |"
      );
      expect(body).toContain(
        "| `arn:aws:sqs:us-east-1:123:my-queue` | sqs | Queue |"
      );
      expect(body).not.toContain("### Errors");
      expect(body).toContain("### How to Fix");
      expect(body).toContain("Created by @standards-kit/drift");
    });

    it("formats detection with error resources", () => {
      const detection: InfraDriftDetection = {
        repository: "org/infra-repo",
        scanTime: "2024-03-10 08:00 UTC",
        manifest: "infra-manifest.yaml",
        summary: { total: 2, found: 1, missing: 0, errors: 1 },
        resources: [
          {
            arn: "arn:aws:s3:::good-bucket",
            exists: true,
            service: "s3",
            resourceType: "Bucket",
            resourceId: "good-bucket",
          },
          {
            arn: "arn:aws:dynamodb:us-east-1:123:table/bad-table",
            exists: false,
            error: "Access denied",
            service: "dynamodb",
            resourceType: "Table",
            resourceId: "bad-table",
          },
        ],
      };

      const body = formatInfraDriftIssueBody(detection);

      expect(body).toContain("### Errors");
      expect(body).toContain(
        "| `arn:aws:dynamodb:us-east-1:123:table/bad-table` | Access denied |"
      );
      expect(body).not.toContain("### Missing Resources");
    });

    it("formats detection with both missing and error resources", () => {
      const detection: InfraDriftDetection = {
        repository: "org/infra-repo",
        scanTime: "2024-03-10 08:00 UTC",
        manifest: "infra-manifest.yaml",
        summary: { total: 3, found: 0, missing: 2, errors: 1 },
        resources: [
          {
            arn: "arn:aws:s3:::missing-bucket",
            exists: false,
            service: "s3",
            resourceType: "Bucket",
            resourceId: "missing-bucket",
          },
          {
            arn: "arn:aws:lambda:us-east-1:123:function:missing-fn",
            exists: false,
            service: "lambda",
            resourceType: "Function",
            resourceId: "missing-fn",
          },
          {
            arn: "arn:aws:iam::123:role/broken-role",
            exists: false,
            error: "Timeout",
            service: "iam",
            resourceType: "Role",
            resourceId: "broken-role",
          },
        ],
      };

      const body = formatInfraDriftIssueBody(detection);

      expect(body).toContain("### Missing Resources");
      expect(body).toContain(
        "| `arn:aws:s3:::missing-bucket` | s3 | Bucket |"
      );
      expect(body).toContain(
        "| `arn:aws:lambda:us-east-1:123:function:missing-fn` | lambda | Function |"
      );
      expect(body).toContain("### Errors");
      expect(body).toContain(
        "| `arn:aws:iam::123:role/broken-role` | Timeout |"
      );
    });

    it("handles empty resources array", () => {
      const detection: InfraDriftDetection = {
        repository: "org/infra-repo",
        scanTime: "2024-03-10 08:00 UTC",
        manifest: "infra-manifest.yaml",
        summary: { total: 0, found: 0, missing: 0, errors: 0 },
        resources: [],
      };

      const body = formatInfraDriftIssueBody(detection);

      expect(body).toContain("## Infrastructure Drift Detected");
      expect(body).toContain("### Summary");
      expect(body).toContain("| 0 | 0 | 0 | 0 |");
      expect(body).not.toContain("### Missing Resources");
      expect(body).not.toContain("### Errors");
      expect(body).toContain("### How to Fix");
      expect(body).toContain("Created by @standards-kit/drift");
    });

    it("includes summary table headers", () => {
      const detection: InfraDriftDetection = {
        repository: "org/repo",
        scanTime: "2024-01-01 00:00 UTC",
        manifest: "manifest.yaml",
        summary: { total: 1, found: 1, missing: 0, errors: 0 },
        resources: [],
      };

      const body = formatInfraDriftIssueBody(detection);

      expect(body).toContain("| Total | Found | Missing | Errors |");
      expect(body).toContain("|-------|-------|---------|--------|");
    });

    it("includes missing resources table headers when missing resources exist", () => {
      const detection: InfraDriftDetection = {
        repository: "org/repo",
        scanTime: "2024-01-01 00:00 UTC",
        manifest: "manifest.yaml",
        summary: { total: 1, found: 0, missing: 1, errors: 0 },
        resources: [
          {
            arn: "arn:aws:s3:::bucket",
            exists: false,
            service: "s3",
            resourceType: "Bucket",
            resourceId: "bucket",
          },
        ],
      };

      const body = formatInfraDriftIssueBody(detection);

      expect(body).toContain("| ARN | Service | Resource |");
      expect(body).toContain("|-----|---------|----------|");
    });

    it("includes error table headers when error resources exist", () => {
      const detection: InfraDriftDetection = {
        repository: "org/repo",
        scanTime: "2024-01-01 00:00 UTC",
        manifest: "manifest.yaml",
        summary: { total: 1, found: 0, missing: 0, errors: 1 },
        resources: [
          {
            arn: "arn:aws:s3:::bucket",
            exists: false,
            error: "Not found",
            service: "s3",
            resourceType: "Bucket",
            resourceId: "bucket",
          },
        ],
      };

      const body = formatInfraDriftIssueBody(detection);

      expect(body).toContain("| ARN | Error |");
      expect(body).toContain("|-----|-------|");
    });

    it("truncates extremely large issue bodies", () => {
      const manyResources = Array.from({ length: 1000 }, (_, i) => ({
        arn: `arn:aws:s3:::very-long-bucket-name-that-takes-up-space-in-the-issue-body-${i}`,
        exists: false,
        service: "s3",
        resourceType: "Bucket",
        resourceId: `very-long-bucket-name-that-takes-up-space-in-the-issue-body-${i}`,
      }));

      const detection: InfraDriftDetection = {
        repository: "org/infra-repo",
        scanTime: "2024-03-10 08:00 UTC",
        manifest: "infra-manifest.yaml",
        summary: { total: 1000, found: 0, missing: 1000, errors: 0 },
        resources: manyResources,
      };

      const body = formatInfraDriftIssueBody(detection);

      expect(body.length).toBeLessThanOrEqual(60000);
      expect(body).toContain("(truncated)");
      expect(body).toContain("Created by @standards-kit/drift");
    });

    it("does not include found resources in missing table", () => {
      const detection: InfraDriftDetection = {
        repository: "org/repo",
        scanTime: "2024-01-01 00:00 UTC",
        manifest: "manifest.yaml",
        summary: { total: 2, found: 1, missing: 1, errors: 0 },
        resources: [
          {
            arn: "arn:aws:s3:::found-bucket",
            exists: true,
            service: "s3",
            resourceType: "Bucket",
            resourceId: "found-bucket",
          },
          {
            arn: "arn:aws:s3:::missing-bucket",
            exists: false,
            service: "s3",
            resourceType: "Bucket",
            resourceId: "missing-bucket",
          },
        ],
      };

      const body = formatInfraDriftIssueBody(detection);

      expect(body).toContain("`arn:aws:s3:::missing-bucket`");
      expect(body).not.toContain("`arn:aws:s3:::found-bucket`");
    });

    it("does not include error resources in missing table", () => {
      const detection: InfraDriftDetection = {
        repository: "org/repo",
        scanTime: "2024-01-01 00:00 UTC",
        manifest: "manifest.yaml",
        summary: { total: 1, found: 0, missing: 0, errors: 1 },
        resources: [
          {
            arn: "arn:aws:s3:::error-bucket",
            exists: false,
            error: "Forbidden",
            service: "s3",
            resourceType: "Bucket",
            resourceId: "error-bucket",
          },
        ],
      };

      const body = formatInfraDriftIssueBody(detection);

      expect(body).not.toContain("### Missing Resources");
      expect(body).toContain("### Errors");
      expect(body).toContain("| `arn:aws:s3:::error-bucket` | Forbidden |");
    });
  });
});
