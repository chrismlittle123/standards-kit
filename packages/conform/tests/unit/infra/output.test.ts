import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatScan } from "../../../src/infra/output.js";
import type { InfraScanResult, ResourceCheckResult } from "../../../src/infra/types.js";

beforeEach(() => vi.clearAllMocks());

function makeResult(overrides: Partial<InfraScanResult> = {}): InfraScanResult {
  return {
    manifest: "/path/to/manifest.json",
    results: [],
    summary: { total: 0, found: 0, missing: 0, errors: 0 },
    ...overrides,
  };
}

function foundResource(id: string): ResourceCheckResult {
  return {
    arn: `arn:aws:s3:::${id}`,
    exists: true,
    service: "s3",
    resourceType: "bucket",
    resourceId: id,
  };
}

function missingResource(id: string): ResourceCheckResult {
  return {
    arn: `arn:aws:s3:::${id}`,
    exists: false,
    service: "s3",
    resourceType: "bucket",
    resourceId: id,
  };
}

function errorResource(id: string, error: string): ResourceCheckResult {
  return {
    arn: `arn:aws:s3:::${id}`,
    exists: false,
    error,
    service: "s3",
    resourceType: "bucket",
    resourceId: id,
  };
}

describe("formatScan", () => {
  describe("json format", () => {
    it("returns valid JSON", () => {
      const result = makeResult();
      const output = formatScan(result, "json");
      expect(JSON.parse(output)).toEqual(result);
    });

    it("includes all result data", () => {
      const result = makeResult({
        project: "test-project",
        results: [foundResource("bucket1")],
        summary: { total: 1, found: 1, missing: 0, errors: 0 },
      });
      const parsed = JSON.parse(formatScan(result, "json"));
      expect(parsed.project).toBe("test-project");
      expect(parsed.results).toHaveLength(1);
    });
  });

  describe("text format", () => {
    it("includes header with manifest path", () => {
      const output = formatScan(makeResult(), "text");
      expect(output).toContain("Infrastructure Scan Results");
      expect(output).toContain("/path/to/manifest.json");
    });

    it("includes project name when present", () => {
      const output = formatScan(makeResult({ project: "my-project" }), "text");
      expect(output).toContain("my-project");
    });

    it("omits project line when not present", () => {
      const output = formatScan(makeResult(), "text");
      expect(output).not.toContain("Project:");
    });

    it("formats found resources", () => {
      const result = makeResult({
        results: [foundResource("bucket1")],
        summary: { total: 1, found: 1, missing: 0, errors: 0 },
      });
      const output = formatScan(result, "text");
      expect(output).toContain("Found (1)");
      expect(output).toContain("s3/bucket/bucket1");
    });

    it("formats missing resources", () => {
      const result = makeResult({
        results: [missingResource("gone-bucket")],
        summary: { total: 1, found: 0, missing: 1, errors: 0 },
      });
      const output = formatScan(result, "text");
      expect(output).toContain("Missing (1)");
      expect(output).toContain("s3/bucket/gone-bucket");
    });

    it("formats error resources", () => {
      const result = makeResult({
        results: [errorResource("bad-bucket", "Access denied")],
        summary: { total: 1, found: 0, missing: 0, errors: 1 },
      });
      const output = formatScan(result, "text");
      expect(output).toContain("Errors (1)");
      expect(output).toContain("Access denied");
    });

    it("formats summary section", () => {
      const result = makeResult({
        results: [foundResource("b1"), missingResource("b2")],
        summary: { total: 2, found: 1, missing: 1, errors: 0 },
      });
      const output = formatScan(result, "text");
      expect(output).toContain("Summary:");
      expect(output).toContain("Total:   2");
      expect(output).toContain("Found:   1");
      expect(output).toContain("Missing: 1");
    });

    it("shows error count in summary when errors exist", () => {
      const result = makeResult({
        results: [errorResource("b1", "err")],
        summary: { total: 1, found: 0, missing: 0, errors: 1 },
      });
      const output = formatScan(result, "text");
      expect(output).toContain("Errors:  1");
    });

    it("omits error line in summary when no errors", () => {
      const result = makeResult({
        results: [foundResource("b1")],
        summary: { total: 1, found: 1, missing: 0, errors: 0 },
      });
      const output = formatScan(result, "text");
      // Should have Summary but no "Errors:" line
      expect(output).toContain("Summary:");
      // The summary section should not include "Errors:" when 0
      const summaryIndex = output.indexOf("Summary:");
      const afterSummary = output.slice(summaryIndex);
      expect(afterSummary).not.toContain("Errors:");
    });

    describe("multi-account format", () => {
      it("formats results grouped by account", () => {
        const result = makeResult({
          results: [foundResource("b1")],
          summary: { total: 1, found: 1, missing: 0, errors: 0 },
          accountResults: {
            "aws:111111111111": {
              alias: "prod",
              results: [foundResource("b1")],
              summary: { total: 1, found: 1, missing: 0, errors: 0 },
            },
          },
        });
        const output = formatScan(result, "text");
        expect(output).toContain("prod (aws:111111111111)");
        expect(output).toContain("1 found");
      });

      it("uses account key as label when no alias", () => {
        const result = makeResult({
          results: [foundResource("b1")],
          summary: { total: 1, found: 1, missing: 0, errors: 0 },
          accountResults: {
            "aws:111111111111": {
              results: [foundResource("b1")],
              summary: { total: 1, found: 1, missing: 0, errors: 0 },
            },
          },
        });
        const output = formatScan(result, "text");
        expect(output).toContain("aws:111111111111");
      });

      it("shows overall summary for multi-account", () => {
        const result = makeResult({
          results: [foundResource("b1"), missingResource("b2")],
          summary: { total: 2, found: 1, missing: 1, errors: 0 },
          accountResults: {
            "aws:111": {
              alias: "prod",
              results: [foundResource("b1")],
              summary: { total: 1, found: 1, missing: 0, errors: 0 },
            },
            "aws:222": {
              alias: "staging",
              results: [missingResource("b2")],
              summary: { total: 1, found: 0, missing: 1, errors: 0 },
            },
          },
        });
        const output = formatScan(result, "text");
        expect(output).toContain("Overall Summary:");
        expect(output).toContain("Total:   2");
      });

      it("shows account-level error and missing indicators", () => {
        const result = makeResult({
          results: [missingResource("b1"), errorResource("b2", "err")],
          summary: { total: 2, found: 0, missing: 1, errors: 1 },
          accountResults: {
            "aws:111": {
              results: [missingResource("b1"), errorResource("b2", "err")],
              summary: { total: 2, found: 0, missing: 1, errors: 1 },
            },
          },
        });
        const output = formatScan(result, "text");
        expect(output).toContain("1 missing");
        expect(output).toContain("1 errors");
      });
    });
  });
});
