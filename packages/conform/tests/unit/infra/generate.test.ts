import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import * as fs from "node:fs";

import {
  parseStackExport,
  generateManifestFromFile,
  writeManifest,
  readExistingManifest,
  mergeIntoManifest,
  parseStackExportMultiAccount,
  DEFAULT_MANIFEST_NAME,
} from "../../../src/infra/generate.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// parseStackExport
// ---------------------------------------------------------------------------
describe("parseStackExport", () => {
  it("extracts AWS ARNs from resource outputs", () => {
    const stackExport = {
      deployment: {
        resources: [
          {
            urn: "urn:pulumi:dev::my-project::aws:s3:Bucket::my-bucket",
            outputs: {
              arn: "arn:aws:s3:::my-bucket",
            },
          },
        ],
      },
    };

    const result = parseStackExport(stackExport);

    expect(result.resources).toContain("arn:aws:s3:::my-bucket");
    expect(result.project).toBe("my-project");
  });

  it("extracts GCP resource paths from outputs", () => {
    const stackExport = {
      deployment: {
        resources: [
          {
            urn: "urn:pulumi:dev::gcp-project::gcp:run:Service::api",
            outputs: {
              name: "projects/my-gcp/locations/us-central1/services/api",
            },
          },
        ],
      },
    };

    const result = parseStackExport(stackExport);

    expect(result.resources).toContain(
      "projects/my-gcp/locations/us-central1/services/api"
    );
  });

  it("uses provided project name over extracted name", () => {
    const stackExport = {
      deployment: {
        resources: [
          {
            urn: "urn:pulumi:dev::auto-name::aws:s3:Bucket::b",
            outputs: {
              arn: "arn:aws:s3:::bucket",
            },
          },
        ],
      },
    };

    const result = parseStackExport(stackExport, "custom-project");

    expect(result.project).toBe("custom-project");
  });

  it("returns 'unknown' when no project name can be determined", () => {
    const stackExport = {
      deployment: {
        resources: [
          {
            outputs: {
              arn: "arn:aws:s3:::bucket",
            },
          },
        ],
      },
    };

    const result = parseStackExport(stackExport);

    expect(result.project).toBe("unknown");
  });

  it("deduplicates resources", () => {
    const stackExport = {
      deployment: {
        resources: [
          {
            outputs: {
              arn: "arn:aws:s3:::bucket",
              bucketArn: "arn:aws:s3:::bucket",
            },
          },
        ],
      },
    };

    const result = parseStackExport(stackExport);

    expect(result.resources.filter((r) => r === "arn:aws:s3:::bucket")).toHaveLength(1);
  });

  it("throws for null input", () => {
    expect(() => parseStackExport(null)).toThrow("Invalid stack export");
  });

  it("throws for non-object input", () => {
    expect(() => parseStackExport("string")).toThrow("Invalid stack export");
  });

  it("throws when deployment.resources is missing", () => {
    expect(() => parseStackExport({ deployment: {} })).toThrow(
      "missing deployment.resources"
    );
  });

  it("throws when deployment is missing", () => {
    expect(() => parseStackExport({})).toThrow("missing deployment.resources");
  });

  it("extracts resources from multiple output fields", () => {
    const stackExport = {
      deployment: {
        resources: [
          {
            outputs: {
              functionArn: "arn:aws:lambda:us-east-1:123456789012:function:my-fn",
              roleArn: "arn:aws:iam::123456789012:role/my-role",
            },
          },
        ],
      },
    };

    const result = parseStackExport(stackExport);

    expect(result.resources).toContain(
      "arn:aws:lambda:us-east-1:123456789012:function:my-fn"
    );
    expect(result.resources).toContain(
      "arn:aws:iam::123456789012:role/my-role"
    );
  });

  it("cleans Pulumi internal suffixes from ARNs", () => {
    const stackExport = {
      deployment: {
        resources: [
          {
            outputs: {
              arn: "arn:aws:secretsmanager:us-east-1:123:secret:name|terraform-20260123",
            },
          },
        ],
      },
    };

    const result = parseStackExport(stackExport);

    expect(result.resources).toContain(
      "arn:aws:secretsmanager:us-east-1:123:secret:name"
    );
    // Should NOT contain the pipe suffix
    expect(result.resources).not.toContain(
      "arn:aws:secretsmanager:us-east-1:123:secret:name|terraform-20260123"
    );
  });

  it("skips non-ARN/non-GCP values in outputs", () => {
    const stackExport = {
      deployment: {
        resources: [
          {
            outputs: {
              id: "just-an-id",
              name: "my-resource-name",
              arn: "arn:aws:s3:::bucket",
            },
          },
        ],
      },
    };

    const result = parseStackExport(stackExport);

    // Only the valid ARN should be included
    expect(result.resources).toEqual(["arn:aws:s3:::bucket"]);
  });

  it("handles resources without outputs", () => {
    const stackExport = {
      deployment: {
        resources: [
          { urn: "urn:pulumi:dev::proj::type::name" },
          { outputs: { arn: "arn:aws:s3:::bucket" } },
        ],
      },
    };

    const result = parseStackExport(stackExport);

    expect(result.resources).toEqual(["arn:aws:s3:::bucket"]);
  });
});

// ---------------------------------------------------------------------------
// generateManifestFromFile
// ---------------------------------------------------------------------------
describe("generateManifestFromFile", () => {
  it("reads and parses a stack export file", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        deployment: {
          resources: [
            {
              urn: "urn:pulumi:dev::proj::aws:s3:Bucket::b",
              outputs: { arn: "arn:aws:s3:::my-bucket" },
            },
          ],
        },
      })
    );

    const result = generateManifestFromFile("/path/to/export.json");

    expect(result.resources).toContain("arn:aws:s3:::my-bucket");
    expect(result.project).toBe("proj");
  });

  it("throws when file not found", () => {
    mockedFs.existsSync.mockReturnValue(false);

    expect(() => generateManifestFromFile("/missing/file.json")).toThrow(
      "File not found"
    );
  });

  it("throws for invalid JSON", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("not json");

    expect(() => generateManifestFromFile("/path/to/bad.json")).toThrow(
      "Invalid JSON"
    );
  });

  it("uses provided project name option", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        deployment: {
          resources: [
            { outputs: { arn: "arn:aws:s3:::bucket" } },
          ],
        },
      })
    );

    const result = generateManifestFromFile("/path/to/export.json", {
      project: "override-name",
    });

    expect(result.project).toBe("override-name");
  });
});

// ---------------------------------------------------------------------------
// writeManifest
// ---------------------------------------------------------------------------
describe("writeManifest", () => {
  it("writes manifest to default file path", () => {
    const manifest = { project: "test", resources: ["arn:aws:s3:::bucket"] };

    writeManifest(manifest);

    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      DEFAULT_MANIFEST_NAME,
      expect.stringContaining("test"),
      "utf-8"
    );
  });

  it("writes manifest to custom output path", () => {
    const manifest = { project: "test", resources: ["arn:aws:s3:::bucket"] };

    writeManifest(manifest, { output: "/custom/manifest.json" });

    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      "/custom/manifest.json",
      expect.any(String),
      "utf-8"
    );
  });

  it("writes to stdout when stdout option is set", () => {
    const manifest = { project: "test", resources: ["arn:aws:s3:::bucket"] };
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    writeManifest(manifest, { stdout: true });

    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// readExistingManifest
// ---------------------------------------------------------------------------
describe("readExistingManifest", () => {
  it("returns null when file does not exist", () => {
    mockedFs.existsSync.mockReturnValue(false);

    const result = readExistingManifest("/path/to/manifest.json");

    expect(result).toBeNull();
  });

  it("returns parsed manifest when file exists", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ project: "test", resources: ["arn:aws:s3:::bucket"] })
    );

    const result = readExistingManifest("/path/to/manifest.json");

    expect(result).toEqual({
      project: "test",
      resources: ["arn:aws:s3:::bucket"],
    });
  });

  it("throws ManifestError for invalid JSON", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("not json {");

    expect(() => readExistingManifest("/path/to/manifest.json")).toThrow(
      "Invalid JSON"
    );
  });
});

// ---------------------------------------------------------------------------
// mergeIntoManifest
// ---------------------------------------------------------------------------
describe("mergeIntoManifest", () => {
  it("merges new resources into legacy manifest", () => {
    const existing = {
      project: "test",
      resources: ["arn:aws:s3:::bucket-a"],
    };

    const result = mergeIntoManifest(
      existing,
      ["arn:aws:s3:::bucket-b"],
      "aws:111111111111"
    );

    expect(result.version).toBe(2);
    expect(result.accounts["aws:111111111111"]).toBeDefined();
    expect(
      result.accounts["aws:111111111111"].resources
    ).toContain("arn:aws:s3:::bucket-b");
  });

  it("merges new resources into multi-account manifest", () => {
    const existing = {
      version: 2 as const,
      project: "test",
      accounts: {
        "aws:111111111111": {
          resources: ["arn:aws:s3:::existing"],
        },
      },
    };

    const result = mergeIntoManifest(
      existing,
      ["arn:aws:s3:::new-bucket"],
      "aws:111111111111"
    );

    expect(result.accounts["aws:111111111111"].resources).toContain(
      "arn:aws:s3:::existing"
    );
    expect(result.accounts["aws:111111111111"].resources).toContain(
      "arn:aws:s3:::new-bucket"
    );
  });

  it("deduplicates merged resources", () => {
    const existing = {
      version: 2 as const,
      project: "test",
      accounts: {
        "aws:111": {
          resources: ["arn:aws:s3:::bucket"],
        },
      },
    };

    const result = mergeIntoManifest(
      existing,
      ["arn:aws:s3:::bucket", "arn:aws:s3:::new"],
      "aws:111"
    );

    const bucketCount = result.accounts["aws:111"].resources.filter(
      (r) => r === "arn:aws:s3:::bucket"
    ).length;
    expect(bucketCount).toBe(1);
  });

  it("adds new account to existing manifest", () => {
    const existing = {
      version: 2 as const,
      project: "test",
      accounts: {
        "aws:111": { resources: ["arn:aws:s3:::bucket"] },
      },
    };

    const result = mergeIntoManifest(
      existing,
      ["arn:aws:lambda:us-east-1:222:function:fn"],
      "aws:222"
    );

    expect(result.accounts["aws:111"]).toBeDefined();
    expect(result.accounts["aws:222"]).toBeDefined();
  });

  it("applies alias to merged account", () => {
    const existing = {
      version: 2 as const,
      project: "test",
      accounts: {},
    };

    const result = mergeIntoManifest(
      existing,
      ["arn:aws:s3:::bucket"],
      "aws:111",
      "prod-aws"
    );

    expect(result.accounts["aws:111"].alias).toBe("prod-aws");
  });
});

// ---------------------------------------------------------------------------
// parseStackExportMultiAccount
// ---------------------------------------------------------------------------
describe("parseStackExportMultiAccount", () => {
  it("creates multi-account manifest from stack export", () => {
    const stackExport = {
      deployment: {
        resources: [
          {
            urn: "urn:pulumi:dev::proj::aws:s3:Bucket::b",
            outputs: { arn: "arn:aws:s3:::bucket" },
          },
        ],
      },
    };

    const result = parseStackExportMultiAccount(stackExport);

    expect(result.version).toBe(2);
    expect(Object.keys(result.accounts).length).toBeGreaterThan(0);
  });

  it("uses explicit account ID when provided", () => {
    const stackExport = {
      deployment: {
        resources: [
          {
            outputs: { arn: "arn:aws:s3:::bucket" },
          },
        ],
      },
    };

    const result = parseStackExportMultiAccount(stackExport, {
      accountId: "aws:123456789012",
      account: "prod",
    });

    expect(result.accounts["aws:123456789012"]).toBeDefined();
    expect(result.accounts["aws:123456789012"].alias).toBe("prod");
  });

  it("groups resources by detected account", () => {
    const stackExport = {
      deployment: {
        resources: [
          {
            outputs: {
              arn: "arn:aws:lambda:us-east-1:111111111111:function:fn1",
            },
          },
          {
            outputs: {
              arn: "arn:aws:lambda:us-east-1:222222222222:function:fn2",
            },
          },
        ],
      },
    };

    const result = parseStackExportMultiAccount(stackExport);

    expect(result.accounts["aws:111111111111"]).toBeDefined();
    expect(result.accounts["aws:222222222222"]).toBeDefined();
  });

  it("throws for invalid input", () => {
    expect(() => parseStackExportMultiAccount(null)).toThrow(
      "Invalid stack export"
    );
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_MANIFEST_NAME
// ---------------------------------------------------------------------------
describe("DEFAULT_MANIFEST_NAME", () => {
  it("is infra-manifest.json", () => {
    expect(DEFAULT_MANIFEST_NAME).toBe("infra-manifest.json");
  });
});
