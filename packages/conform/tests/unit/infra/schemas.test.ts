import { describe, it, expect } from "vitest";

import {
  CloudProviderSchema,
  AccountKeySchema,
  ArnSchema,
  ParsedArnSchema,
  GcpResourcePathSchema,
  ParsedGcpResourceSchema,
  ResourceIdentifierSchema,
  AccountIdSchema,
  ManifestAccountSchema,
  MultiAccountManifestSchema,
  LegacyManifestSchema,
  ManifestSchema,
  ResourceCheckResultSchema,
  InfraScanSummarySchema,
  InfraScanResultSchema,
  PulumiResourceSchema,
  PulumiStackExportSchema,
  validateArn,
  isValidArnFormat,
  validateGcpResourcePath,
  isValidGcpResourcePath,
  validateAccountKey,
  isValidAccountKey,
  validateLegacyManifest,
  validateMultiAccountManifest,
  validateManifest,
  isMultiAccountManifestSchema,
  isLegacyManifestSchema,
  validateStackExport,
} from "../../../src/infra/schemas.js";

// =============================================================================
// Cloud Provider Schema
// =============================================================================

describe("CloudProviderSchema", () => {
  it("accepts aws", () => {
    expect(CloudProviderSchema.parse("aws")).toBe("aws");
  });

  it("accepts gcp", () => {
    expect(CloudProviderSchema.parse("gcp")).toBe("gcp");
  });

  it("rejects unknown provider", () => {
    expect(() => CloudProviderSchema.parse("azure")).toThrow();
  });
});

// =============================================================================
// Account Key Schema
// =============================================================================

describe("AccountKeySchema", () => {
  it("accepts valid aws account key", () => {
    expect(AccountKeySchema.parse("aws:123456789012")).toBe("aws:123456789012");
  });

  it("accepts valid gcp account key", () => {
    expect(AccountKeySchema.parse("gcp:my-project")).toBe("gcp:my-project");
  });

  it("rejects missing provider prefix", () => {
    expect(() => AccountKeySchema.parse("123456789012")).toThrow();
  });

  it("rejects empty value after colon", () => {
    expect(() => AccountKeySchema.parse("aws:")).toThrow();
  });

  it("rejects unknown provider", () => {
    expect(() => AccountKeySchema.parse("azure:123")).toThrow();
  });
});

// =============================================================================
// ARN Schema
// =============================================================================

describe("ArnSchema", () => {
  it("accepts a valid standard ARN", () => {
    expect(ArnSchema.parse("arn:aws:s3:::my-bucket")).toBe("arn:aws:s3:::my-bucket");
  });

  it("accepts aws-cn partition", () => {
    expect(ArnSchema.parse("arn:aws-cn:s3:::bucket")).toBe("arn:aws-cn:s3:::bucket");
  });

  it("accepts aws-us-gov partition", () => {
    expect(ArnSchema.parse("arn:aws-us-gov:s3:::bucket")).toBe("arn:aws-us-gov:s3:::bucket");
  });

  it("rejects non-arn string", () => {
    expect(() => ArnSchema.parse("not-an-arn")).toThrow();
  });

  it("rejects arn with invalid partition", () => {
    expect(() => ArnSchema.parse("arn:invalid:s3:::bucket")).toThrow();
  });
});

// =============================================================================
// Parsed ARN Schema
// =============================================================================

describe("ParsedArnSchema", () => {
  it("accepts valid parsed ARN", () => {
    const data = {
      cloud: "aws" as const,
      partition: "aws",
      service: "s3",
      region: "",
      accountId: "",
      resourceType: "bucket",
      resourceId: "my-bucket",
      raw: "arn:aws:s3:::my-bucket",
    };
    expect(ParsedArnSchema.parse(data)).toEqual(data);
  });

  it("rejects parsed ARN with wrong cloud literal", () => {
    const data = {
      cloud: "gcp",
      partition: "aws",
      service: "s3",
      region: "",
      accountId: "",
      resourceType: "bucket",
      resourceId: "my-bucket",
      raw: "arn:aws:s3:::my-bucket",
    };
    expect(() => ParsedArnSchema.parse(data)).toThrow();
  });
});

// =============================================================================
// GCP Resource Path Schema
// =============================================================================

describe("GcpResourcePathSchema", () => {
  it("accepts valid GCP resource path", () => {
    const p = "projects/my-project/locations/us/services/svc";
    expect(GcpResourcePathSchema.parse(p)).toBe(p);
  });

  it("rejects non-projects path", () => {
    expect(() => GcpResourcePathSchema.parse("not/a/gcp/path")).toThrow();
  });

  it("rejects projects/ without resource", () => {
    expect(() => GcpResourcePathSchema.parse("projects/proj")).toThrow();
  });
});

// =============================================================================
// Parsed GCP Resource Schema
// =============================================================================

describe("ParsedGcpResourceSchema", () => {
  it("accepts valid parsed GCP resource", () => {
    const data = {
      cloud: "gcp" as const,
      project: "my-project",
      service: "run",
      location: "us-central1",
      resourceType: "services",
      resourceId: "my-service",
      raw: "projects/my-project/locations/us-central1/services/my-service",
    };
    expect(ParsedGcpResourceSchema.parse(data)).toEqual(data);
  });

  it("rejects wrong cloud literal", () => {
    expect(() =>
      ParsedGcpResourceSchema.parse({
        cloud: "aws",
        project: "p",
        service: "s",
        location: "l",
        resourceType: "t",
        resourceId: "id",
        raw: "r",
      })
    ).toThrow();
  });
});

// =============================================================================
// Resource Identifier Schema
// =============================================================================

describe("ResourceIdentifierSchema", () => {
  it("accepts valid ARN", () => {
    expect(ResourceIdentifierSchema.parse("arn:aws:s3:::bucket")).toBe("arn:aws:s3:::bucket");
  });

  it("accepts valid GCP path", () => {
    const p = "projects/p/locations/us/services/s";
    expect(ResourceIdentifierSchema.parse(p)).toBe(p);
  });

  it("rejects invalid string", () => {
    expect(() => ResourceIdentifierSchema.parse("random-string")).toThrow();
  });
});

// =============================================================================
// Account ID Schema
// =============================================================================

describe("AccountIdSchema", () => {
  it("accepts valid account id", () => {
    const data = { cloud: "aws" as const, id: "123456" };
    expect(AccountIdSchema.parse(data)).toEqual(data);
  });

  it("rejects invalid cloud", () => {
    expect(() => AccountIdSchema.parse({ cloud: "azure", id: "123" })).toThrow();
  });
});

// =============================================================================
// Manifest Account Schema
// =============================================================================

describe("ManifestAccountSchema", () => {
  it("accepts account with resources and alias", () => {
    const data = { alias: "prod", resources: ["arn:aws:s3:::bucket"] };
    expect(ManifestAccountSchema.parse(data)).toEqual(data);
  });

  it("accepts account without alias", () => {
    const data = { resources: ["arn:aws:s3:::bucket"] };
    expect(ManifestAccountSchema.parse(data)).toEqual(data);
  });

  it("rejects account without resources", () => {
    expect(() => ManifestAccountSchema.parse({ alias: "prod" })).toThrow();
  });
});

// =============================================================================
// Multi-Account Manifest Schema
// =============================================================================

describe("MultiAccountManifestSchema", () => {
  it("accepts valid v2 manifest", () => {
    const data = {
      version: 2,
      accounts: { "aws:123": { resources: ["arn:aws:s3:::bucket"] } },
    };
    expect(MultiAccountManifestSchema.parse(data)).toEqual(data);
  });

  it("accepts v2 manifest with project", () => {
    const data = {
      version: 2,
      project: "my-app",
      accounts: { "gcp:proj": { resources: ["projects/proj/secrets/s"] } },
    };
    expect(MultiAccountManifestSchema.parse(data)).toEqual(data);
  });

  it("rejects version 1", () => {
    expect(() =>
      MultiAccountManifestSchema.parse({
        version: 1,
        accounts: {},
      })
    ).toThrow();
  });
});

// =============================================================================
// Legacy Manifest Schema
// =============================================================================

describe("LegacyManifestSchema", () => {
  it("accepts v1 manifest with version", () => {
    const data = { version: 1, resources: ["arn:aws:s3:::bucket"] };
    expect(LegacyManifestSchema.parse(data)).toEqual(data);
  });

  it("accepts manifest without version", () => {
    const data = { resources: ["arn:aws:s3:::bucket"] };
    expect(LegacyManifestSchema.parse(data)).toEqual(data);
  });

  it("rejects manifest without resources", () => {
    expect(() => LegacyManifestSchema.parse({})).toThrow();
  });
});

// =============================================================================
// Manifest Schema (Union)
// =============================================================================

describe("ManifestSchema", () => {
  it("accepts v2 manifest", () => {
    const data = {
      version: 2,
      accounts: { "aws:123": { resources: [] } },
    };
    expect(ManifestSchema.parse(data)).toEqual(data);
  });

  it("accepts v1 manifest", () => {
    const data = { resources: [] };
    expect(ManifestSchema.parse(data)).toEqual(data);
  });

  it("rejects invalid data", () => {
    expect(() => ManifestSchema.parse({ version: 3 })).toThrow();
  });
});

// =============================================================================
// Resource Check Result Schema
// =============================================================================

describe("ResourceCheckResultSchema", () => {
  it("accepts valid check result", () => {
    const data = {
      arn: "arn:aws:s3:::bucket",
      exists: true,
      service: "s3",
      resourceType: "bucket",
      resourceId: "bucket",
    };
    expect(ResourceCheckResultSchema.parse(data)).toEqual(data);
  });

  it("accepts check result with error", () => {
    const data = {
      arn: "arn:aws:s3:::bucket",
      exists: false,
      error: "Access denied",
      service: "s3",
      resourceType: "bucket",
      resourceId: "bucket",
    };
    expect(ResourceCheckResultSchema.parse(data)).toEqual(data);
  });
});

// =============================================================================
// Infra Scan Summary Schema
// =============================================================================

describe("InfraScanSummarySchema", () => {
  it("accepts valid summary", () => {
    const data = { total: 10, found: 8, missing: 1, errors: 1 };
    expect(InfraScanSummarySchema.parse(data)).toEqual(data);
  });

  it("rejects negative numbers", () => {
    expect(() => InfraScanSummarySchema.parse({ total: -1, found: 0, missing: 0, errors: 0 })).toThrow();
  });
});

// =============================================================================
// Infra Scan Result Schema
// =============================================================================

describe("InfraScanResultSchema", () => {
  it("accepts valid scan result", () => {
    const data = {
      manifest: "infra.json",
      results: [],
      summary: { total: 0, found: 0, missing: 0, errors: 0 },
    };
    expect(InfraScanResultSchema.parse(data)).toEqual(data);
  });

  it("accepts scan result with account results", () => {
    const data = {
      manifest: "infra.json",
      project: "my-app",
      results: [],
      summary: { total: 0, found: 0, missing: 0, errors: 0 },
      accountResults: {
        "aws:123": {
          results: [],
          summary: { total: 0, found: 0, missing: 0, errors: 0 },
        },
      },
    };
    expect(InfraScanResultSchema.parse(data)).toEqual(data);
  });
});

// =============================================================================
// Pulumi Schemas
// =============================================================================

describe("PulumiResourceSchema", () => {
  it("accepts resource with all fields", () => {
    const data = {
      urn: "urn:pulumi:stack::project::type::name",
      type: "aws:s3:Bucket",
      inputs: { bucketName: "my-bucket" },
      outputs: { arn: "arn:aws:s3:::my-bucket" },
    };
    expect(PulumiResourceSchema.parse(data)).toEqual(data);
  });

  it("accepts empty resource", () => {
    expect(PulumiResourceSchema.parse({})).toEqual({});
  });
});

describe("PulumiStackExportSchema", () => {
  it("accepts valid stack export", () => {
    const data = {
      version: 3,
      deployment: {
        manifest: { time: "2024-01-01", version: "1.0" },
        resources: [{ urn: "urn:pulumi:stack::project::type::name" }],
      },
    };
    expect(PulumiStackExportSchema.parse(data)).toEqual(data);
  });

  it("accepts empty stack export", () => {
    expect(PulumiStackExportSchema.parse({})).toEqual({});
  });
});

// =============================================================================
// Validation Functions
// =============================================================================

describe("validateArn", () => {
  it("returns the ARN for valid input", () => {
    expect(validateArn("arn:aws:s3:::bucket")).toBe("arn:aws:s3:::bucket");
  });

  it("throws for invalid ARN", () => {
    expect(() => validateArn("invalid")).toThrow();
  });
});

describe("isValidArnFormat", () => {
  it("returns true for valid ARN", () => {
    expect(isValidArnFormat("arn:aws:s3:::bucket")).toBe(true);
  });

  it("returns false for invalid ARN", () => {
    expect(isValidArnFormat("invalid")).toBe(false);
  });
});

describe("validateGcpResourcePath", () => {
  it("returns the path for valid input", () => {
    const p = "projects/p/locations/us/services/s";
    expect(validateGcpResourcePath(p)).toBe(p);
  });

  it("throws for invalid path", () => {
    expect(() => validateGcpResourcePath("invalid")).toThrow();
  });
});

describe("isValidGcpResourcePath", () => {
  it("returns true for valid path", () => {
    expect(isValidGcpResourcePath("projects/p/locations/us/services/s")).toBe(true);
  });

  it("returns false for invalid path", () => {
    expect(isValidGcpResourcePath("invalid")).toBe(false);
  });
});

describe("validateAccountKey", () => {
  it("returns the key for valid input", () => {
    expect(validateAccountKey("aws:123")).toBe("aws:123");
  });

  it("throws for invalid key", () => {
    expect(() => validateAccountKey("invalid")).toThrow();
  });
});

describe("isValidAccountKey", () => {
  it("returns true for valid key", () => {
    expect(isValidAccountKey("gcp:proj")).toBe(true);
  });

  it("returns false for invalid key", () => {
    expect(isValidAccountKey("bad")).toBe(false);
  });
});

describe("validateLegacyManifest", () => {
  it("returns parsed manifest for valid input", () => {
    const data = { resources: ["arn:aws:s3:::bucket"] };
    expect(validateLegacyManifest(data)).toEqual(data);
  });

  it("throws for invalid input", () => {
    expect(() => validateLegacyManifest({})).toThrow();
  });
});

describe("validateMultiAccountManifest", () => {
  it("returns parsed manifest for valid input", () => {
    const data = { version: 2, accounts: {} };
    expect(validateMultiAccountManifest(data)).toEqual(data);
  });

  it("throws for invalid input", () => {
    expect(() => validateMultiAccountManifest({})).toThrow();
  });
});

describe("validateManifest", () => {
  it("accepts v1 manifest", () => {
    expect(validateManifest({ resources: [] })).toEqual({ resources: [] });
  });

  it("accepts v2 manifest", () => {
    const data = { version: 2, accounts: {} };
    expect(validateManifest(data)).toEqual(data);
  });

  it("throws for invalid manifest", () => {
    expect(() => validateManifest({ version: 3 })).toThrow();
  });
});

describe("isMultiAccountManifestSchema", () => {
  it("returns true for v2 manifest", () => {
    expect(isMultiAccountManifestSchema({ version: 2, accounts: {} })).toBe(true);
  });

  it("returns false for v1 manifest", () => {
    expect(isMultiAccountManifestSchema({ resources: [] })).toBe(false);
  });
});

describe("isLegacyManifestSchema", () => {
  it("returns true for v1 manifest", () => {
    expect(isLegacyManifestSchema({ resources: [] })).toBe(true);
  });

  it("returns false for v2 manifest", () => {
    expect(isLegacyManifestSchema({ version: 2, accounts: {} })).toBe(false);
  });
});

describe("validateStackExport", () => {
  it("returns parsed export for valid input", () => {
    const data = { version: 3 };
    expect(validateStackExport(data)).toEqual(data);
  });

  it("throws for non-object input", () => {
    expect(() => validateStackExport("string")).toThrow();
  });
});
