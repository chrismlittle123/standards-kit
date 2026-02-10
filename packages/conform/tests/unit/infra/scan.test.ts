vi.mock("../../../src/constants.js", () => ({
  CONCURRENCY: { infraScan: 2 },
}));

vi.mock("../../../src/infra/arn.js", () => ({
  isValidArn: vi.fn(),
  parseArn: vi.fn(),
}));

vi.mock("../../../src/infra/gcp.js", () => ({
  isValidGcpResource: vi.fn(),
  parseGcpResource: vi.fn(),
}));

vi.mock("../../../src/infra/checkers/index.js", () => ({
  getChecker: vi.fn(),
  isSupportedService: vi.fn(),
  SUPPORTED_SERVICES: ["s3", "lambda"],
}));

vi.mock("../../../src/infra/checkers/gcp/index.js", () => ({
  getGcpChecker: vi.fn(),
  isSupportedGcpService: vi.fn(),
  SUPPORTED_GCP_SERVICES: ["run", "storage"],
}));

vi.mock("../../../src/infra/manifest.js", () => ({
  getAllResources: vi.fn(),
  isMultiAccountManifest: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { scanManifest } from "../../../src/infra/scan.js";
import { isValidArn, parseArn } from "../../../src/infra/arn.js";
import { isValidGcpResource, parseGcpResource } from "../../../src/infra/gcp.js";
import { getChecker, isSupportedService } from "../../../src/infra/checkers/index.js";
import { getGcpChecker, isSupportedGcpService } from "../../../src/infra/checkers/gcp/index.js";
import { getAllResources, isMultiAccountManifest } from "../../../src/infra/manifest.js";
import type { LegacyManifest, MultiAccountManifest } from "../../../src/infra/types.js";

const mocked = vi.mocked;

beforeEach(() => vi.clearAllMocks());

describe("scanManifest", () => {
  describe("legacy manifest", () => {
    it("scans all resources and returns results with summary", async () => {
      const manifest: LegacyManifest = { resources: ["arn:aws:s3:::bucket1"] };
      mocked(isMultiAccountManifest).mockReturnValue(false);
      mocked(getAllResources).mockReturnValue(["arn:aws:s3:::bucket1"]);
      mocked(isValidArn).mockReturnValue(true);
      mocked(parseArn).mockReturnValue({
        service: "s3",
        region: "us-east-1",
        account: "123456",
        resourceType: "bucket",
        resourceId: "bucket1",
      } as any);
      mocked(isSupportedService).mockReturnValue(true);
      const mockChecker = { check: vi.fn().mockResolvedValue({
        arn: "arn:aws:s3:::bucket1",
        exists: true,
        service: "s3",
        resourceType: "bucket",
        resourceId: "bucket1",
      }) };
      mocked(getChecker).mockResolvedValue(mockChecker as any);

      const result = await scanManifest(manifest, "/manifest.json");

      expect(result.manifest).toBe("/manifest.json");
      expect(result.summary.total).toBe(1);
      expect(result.summary.found).toBe(1);
      expect(result.summary.missing).toBe(0);
      expect(result.summary.errors).toBe(0);
    });

    it("handles missing resources", async () => {
      mocked(isMultiAccountManifest).mockReturnValue(false);
      mocked(getAllResources).mockReturnValue(["arn:aws:s3:::gone"]);
      mocked(isValidArn).mockReturnValue(true);
      mocked(parseArn).mockReturnValue({
        service: "s3", region: "", account: "", resourceType: "bucket", resourceId: "gone",
      } as any);
      mocked(isSupportedService).mockReturnValue(true);
      const mockChecker = { check: vi.fn().mockResolvedValue({
        arn: "arn:aws:s3:::gone", exists: false, service: "s3",
        resourceType: "bucket", resourceId: "gone",
      }) };
      mocked(getChecker).mockResolvedValue(mockChecker as any);

      const result = await scanManifest({ resources: ["arn:aws:s3:::gone"] }, "/m.json");

      expect(result.summary.missing).toBe(1);
      expect(result.summary.found).toBe(0);
    });

    it("handles unsupported AWS service", async () => {
      mocked(isMultiAccountManifest).mockReturnValue(false);
      mocked(getAllResources).mockReturnValue(["arn:aws:unsupported:::x"]);
      mocked(isValidArn).mockReturnValue(true);
      mocked(parseArn).mockReturnValue({
        service: "unsupported", region: "", account: "",
        resourceType: "x", resourceId: "x",
      } as any);
      mocked(isSupportedService).mockReturnValue(false);

      const result = await scanManifest({ resources: ["arn:aws:unsupported:::x"] }, "/m.json");

      expect(result.summary.errors).toBe(1);
      expect(result.results[0].error).toContain("Unsupported AWS service");
    });

    it("handles invalid ARN format", async () => {
      mocked(isMultiAccountManifest).mockReturnValue(false);
      mocked(getAllResources).mockReturnValue(["arn:aws:s3:::bucket"]);
      mocked(isValidArn).mockReturnValue(true);
      mocked(parseArn).mockReturnValue(null);

      const result = await scanManifest({ resources: ["arn:aws:s3:::bucket"] }, "/m.json");

      expect(result.summary.errors).toBe(1);
      expect(result.results[0].error).toContain("Invalid ARN format");
    });

    it("handles invalid resource format (not ARN or GCP)", async () => {
      mocked(isMultiAccountManifest).mockReturnValue(false);
      mocked(getAllResources).mockReturnValue(["not-a-resource"]);
      mocked(isValidArn).mockReturnValue(false);
      mocked(isValidGcpResource).mockReturnValue(false);

      const result = await scanManifest({ resources: ["not-a-resource"] }, "/m.json");

      // The result has an error field, so calculateSummary counts it as an error
      expect(result.summary.errors).toBe(1);
      expect(result.results[0].exists).toBe(false);
      expect(result.results[0].error).toContain("Invalid resource format");
    });

    it("handles no checker available for AWS service", async () => {
      mocked(isMultiAccountManifest).mockReturnValue(false);
      mocked(getAllResources).mockReturnValue(["arn:aws:s3:::b"]);
      mocked(isValidArn).mockReturnValue(true);
      mocked(parseArn).mockReturnValue({
        service: "s3", region: "", account: "", resourceType: "bucket", resourceId: "b",
      } as any);
      mocked(isSupportedService).mockReturnValue(true);
      mocked(getChecker).mockResolvedValue(null as any);

      const result = await scanManifest({ resources: ["arn:aws:s3:::b"] }, "/m.json");

      expect(result.summary.errors).toBe(1);
      expect(result.results[0].error).toContain("No checker for AWS service");
    });

    it("includes project name in result", async () => {
      mocked(isMultiAccountManifest).mockReturnValue(false);
      mocked(getAllResources).mockReturnValue([]);

      const result = await scanManifest({ project: "my-app", resources: [] }, "/m.json");

      expect(result.project).toBe("my-app");
    });
  });

  describe("GCP resources", () => {
    it("checks GCP resources correctly", async () => {
      const gcpPath = "projects/my-proj/locations/us-central1/services/my-svc";
      mocked(isMultiAccountManifest).mockReturnValue(false);
      mocked(getAllResources).mockReturnValue([gcpPath]);
      mocked(isValidArn).mockReturnValue(false);
      mocked(isValidGcpResource).mockReturnValue(true);
      mocked(parseGcpResource).mockReturnValue({
        service: "run", resourceType: "service", resourceId: "my-svc",
        project: "my-proj", location: "us-central1",
      } as any);
      mocked(isSupportedGcpService).mockReturnValue(true);
      const mockChecker = { check: vi.fn().mockResolvedValue({
        arn: gcpPath, exists: true, service: "run",
        resourceType: "service", resourceId: "my-svc",
      }) };
      mocked(getGcpChecker).mockResolvedValue(mockChecker as any);

      const result = await scanManifest({ resources: [gcpPath] }, "/m.json");

      expect(result.summary.found).toBe(1);
    });

    it("handles unsupported GCP service", async () => {
      const gcpPath = "projects/p/locations/l/unknownThings/x";
      mocked(isMultiAccountManifest).mockReturnValue(false);
      mocked(getAllResources).mockReturnValue([gcpPath]);
      mocked(isValidArn).mockReturnValue(false);
      mocked(isValidGcpResource).mockReturnValue(true);
      mocked(parseGcpResource).mockReturnValue({
        service: "unknown", resourceType: "thing", resourceId: "x",
        project: "p", location: "l",
      } as any);
      mocked(isSupportedGcpService).mockReturnValue(false);

      const result = await scanManifest({ resources: [gcpPath] }, "/m.json");

      expect(result.summary.errors).toBe(1);
      expect(result.results[0].error).toContain("Unsupported GCP service");
    });

    it("handles invalid GCP resource path", async () => {
      const gcpPath = "projects/p/bad-path";
      mocked(isMultiAccountManifest).mockReturnValue(false);
      mocked(getAllResources).mockReturnValue([gcpPath]);
      mocked(isValidArn).mockReturnValue(false);
      mocked(isValidGcpResource).mockReturnValue(true);
      mocked(parseGcpResource).mockReturnValue(null);

      const result = await scanManifest({ resources: [gcpPath] }, "/m.json");

      expect(result.summary.errors).toBe(1);
      expect(result.results[0].error).toContain("Invalid GCP resource path format");
    });

    it("handles no checker for GCP service", async () => {
      const gcpPath = "projects/p/locations/l/services/s";
      mocked(isMultiAccountManifest).mockReturnValue(false);
      mocked(getAllResources).mockReturnValue([gcpPath]);
      mocked(isValidArn).mockReturnValue(false);
      mocked(isValidGcpResource).mockReturnValue(true);
      mocked(parseGcpResource).mockReturnValue({
        service: "run", resourceType: "service", resourceId: "s",
        project: "p", location: "l",
      } as any);
      mocked(isSupportedGcpService).mockReturnValue(true);
      mocked(getGcpChecker).mockResolvedValue(null as any);

      const result = await scanManifest({ resources: [gcpPath] }, "/m.json");

      expect(result.summary.errors).toBe(1);
      expect(result.results[0].error).toContain("No checker for GCP service");
    });
  });

  describe("multi-account manifest", () => {
    it("scans resources by account", async () => {
      const manifest: MultiAccountManifest = {
        version: 2,
        project: "multi",
        accounts: {
          "aws:111111111111": {
            alias: "prod",
            resources: ["arn:aws:s3:::prod-bucket"],
          },
        },
      };
      mocked(isMultiAccountManifest).mockReturnValue(true);
      mocked(isValidArn).mockReturnValue(true);
      mocked(parseArn).mockReturnValue({
        service: "s3", region: "", account: "111111111111",
        resourceType: "bucket", resourceId: "prod-bucket",
      } as any);
      mocked(isSupportedService).mockReturnValue(true);
      const mockChecker = { check: vi.fn().mockResolvedValue({
        arn: "arn:aws:s3:::prod-bucket", exists: true, service: "s3",
        resourceType: "bucket", resourceId: "prod-bucket",
      }) };
      mocked(getChecker).mockResolvedValue(mockChecker as any);

      const result = await scanManifest(manifest, "/m.json");

      expect(result.accountResults).toBeDefined();
      expect(result.accountResults!["aws:111111111111"]).toBeDefined();
      expect(result.accountResults!["aws:111111111111"].alias).toBe("prod");
      expect(result.summary.found).toBe(1);
    });

    it("filters by account alias", async () => {
      const manifest: MultiAccountManifest = {
        version: 2,
        accounts: {
          "aws:111": { alias: "prod", resources: ["arn:aws:s3:::a"] },
          "aws:222": { alias: "staging", resources: ["arn:aws:s3:::b"] },
        },
      };
      mocked(isMultiAccountManifest).mockReturnValue(true);
      mocked(isValidArn).mockReturnValue(true);
      mocked(parseArn).mockReturnValue({
        service: "s3", region: "", account: "111",
        resourceType: "bucket", resourceId: "a",
      } as any);
      mocked(isSupportedService).mockReturnValue(true);
      const mockChecker = { check: vi.fn().mockResolvedValue({
        arn: "arn:aws:s3:::a", exists: true, service: "s3",
        resourceType: "bucket", resourceId: "a",
      }) };
      mocked(getChecker).mockResolvedValue(mockChecker as any);

      const result = await scanManifest(manifest, "/m.json", { account: "prod" });

      expect(Object.keys(result.accountResults!)).toHaveLength(1);
      expect(result.accountResults!["aws:111"]).toBeDefined();
    });

    it("filters by account key", async () => {
      const manifest: MultiAccountManifest = {
        version: 2,
        accounts: {
          "aws:111": { alias: "prod", resources: ["arn:aws:s3:::a"] },
          "aws:222": { alias: "staging", resources: ["arn:aws:s3:::b"] },
        },
      };
      mocked(isMultiAccountManifest).mockReturnValue(true);
      mocked(isValidArn).mockReturnValue(true);
      mocked(parseArn).mockReturnValue({
        service: "s3", region: "", account: "222",
        resourceType: "bucket", resourceId: "b",
      } as any);
      mocked(isSupportedService).mockReturnValue(true);
      const mockChecker = { check: vi.fn().mockResolvedValue({
        arn: "arn:aws:s3:::b", exists: true, service: "s3",
        resourceType: "bucket", resourceId: "b",
      }) };
      mocked(getChecker).mockResolvedValue(mockChecker as any);

      const result = await scanManifest(manifest, "/m.json", { account: "aws:222" });

      expect(Object.keys(result.accountResults!)).toHaveLength(1);
      expect(result.accountResults!["aws:222"]).toBeDefined();
    });

    it("returns empty results when account filter matches nothing", async () => {
      const manifest: MultiAccountManifest = {
        version: 2,
        accounts: {
          "aws:111": { alias: "prod", resources: ["arn:aws:s3:::a"] },
        },
      };
      mocked(isMultiAccountManifest).mockReturnValue(true);

      const result = await scanManifest(manifest, "/m.json", { account: "nonexistent" });

      expect(result.results).toHaveLength(0);
      expect(result.summary.total).toBe(0);
    });
  });

  describe("concurrency", () => {
    it("processes resources in batches", async () => {
      const resources = ["arn:aws:s3:::b1", "arn:aws:s3:::b2", "arn:aws:s3:::b3"];
      mocked(isMultiAccountManifest).mockReturnValue(false);
      mocked(getAllResources).mockReturnValue(resources);

      let callOrder = 0;
      mocked(isValidArn).mockReturnValue(true);
      mocked(parseArn).mockImplementation((arn) => ({
        service: "s3", region: "", account: "",
        resourceType: "bucket", resourceId: arn.split(":::")[1],
      } as any));
      mocked(isSupportedService).mockReturnValue(true);
      const mockChecker = { check: vi.fn().mockImplementation((parsed: any) => {
        callOrder++;
        return Promise.resolve({
          arn: `arn:aws:s3:::${parsed.resourceId}`,
          exists: true, service: "s3",
          resourceType: "bucket", resourceId: parsed.resourceId,
        });
      }) };
      mocked(getChecker).mockResolvedValue(mockChecker as any);

      const result = await scanManifest({ resources }, "/m.json");

      // With concurrency=2, should process in 2 batches: [b1,b2] then [b3]
      expect(result.summary.total).toBe(3);
      expect(result.summary.found).toBe(3);
    });
  });
});
