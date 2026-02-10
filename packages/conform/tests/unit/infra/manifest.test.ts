import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import * as fs from "node:fs";

import {
  ManifestError,
  isMultiAccountManifest,
  isLegacyManifest,
  parseAccountKey,
  formatAccountKey,
  normalizeManifest,
  detectAccountFromResource,
  getAllResources,
  readManifest,
} from "../../../src/infra/manifest.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// ManifestError
// =============================================================================

describe("ManifestError", () => {
  it("has correct name", () => {
    const error = new ManifestError("test");
    expect(error.name).toBe("ManifestError");
    expect(error.message).toBe("test");
  });
});

// =============================================================================
// Type Guards
// =============================================================================

describe("isMultiAccountManifest", () => {
  it("returns true for v2 manifest", () => {
    expect(isMultiAccountManifest({ version: 2, accounts: {} })).toBe(true);
  });

  it("returns false for v1 manifest", () => {
    expect(isMultiAccountManifest({ resources: [] })).toBe(false);
  });
});

describe("isLegacyManifest", () => {
  it("returns true for v1 manifest", () => {
    expect(isLegacyManifest({ resources: [] })).toBe(true);
  });

  it("returns false for v2 manifest", () => {
    expect(isLegacyManifest({ version: 2, accounts: {} })).toBe(false);
  });
});

// =============================================================================
// Account Key Parsing
// =============================================================================

describe("parseAccountKey", () => {
  it("parses AWS account key", () => {
    expect(parseAccountKey("aws:123456789012")).toEqual({ cloud: "aws", id: "123456789012" });
  });

  it("parses GCP account key", () => {
    expect(parseAccountKey("gcp:my-project")).toEqual({ cloud: "gcp", id: "my-project" });
  });

  it("returns null for invalid key", () => {
    expect(parseAccountKey("invalid")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAccountKey("")).toBeNull();
  });
});

describe("formatAccountKey", () => {
  it("formats AWS key", () => {
    expect(formatAccountKey("aws", "123456")).toBe("aws:123456");
  });

  it("formats GCP key", () => {
    expect(formatAccountKey("gcp", "my-proj")).toBe("gcp:my-proj");
  });
});

// =============================================================================
// detectAccountFromResource
// =============================================================================

describe("detectAccountFromResource", () => {
  it("detects AWS account from ARN", () => {
    expect(detectAccountFromResource("arn:aws:s3:us-east-1:123456789012:bucket/my-bucket")).toBe(
      "aws:123456789012"
    );
  });

  it("returns aws:unknown for S3 bucket ARN without account", () => {
    expect(detectAccountFromResource("arn:aws:s3:::my-bucket")).toBe("aws:unknown");
  });

  it("detects GCP project from resource path", () => {
    expect(
      detectAccountFromResource("projects/my-project/locations/us/services/svc")
    ).toBe("gcp:my-project");
  });

  it("returns unknown:unknown for unrecognized resource", () => {
    expect(detectAccountFromResource("random-string")).toBe("unknown:unknown");
  });
});

// =============================================================================
// normalizeManifest
// =============================================================================

describe("normalizeManifest", () => {
  it("returns v2 manifest unchanged", () => {
    const manifest = {
      version: 2 as const,
      accounts: { "aws:123": { resources: ["arn:aws:s3:::bucket"] } },
    };
    expect(normalizeManifest(manifest)).toBe(manifest);
  });

  it("converts v1 manifest to v2 format", () => {
    const manifest = {
      resources: ["arn:aws:s3:us-east-1:123456:bucket/b"],
    };
    const result = normalizeManifest(manifest);
    expect(result.version).toBe(2);
    expect(result.accounts["aws:123456"]).toBeDefined();
    expect(result.accounts["aws:123456"].resources).toContain(
      "arn:aws:s3:us-east-1:123456:bucket/b"
    );
  });

  it("groups mixed resources by account", () => {
    const manifest = {
      resources: [
        "arn:aws:s3:us-east-1:111:bucket/a",
        "arn:aws:s3:us-east-1:222:bucket/b",
        "projects/gcp-proj/locations/us/services/svc",
      ],
    };
    const result = normalizeManifest(manifest);
    expect(Object.keys(result.accounts)).toHaveLength(3);
    expect(result.accounts["aws:111"]).toBeDefined();
    expect(result.accounts["aws:222"]).toBeDefined();
    expect(result.accounts["gcp:gcp-proj"]).toBeDefined();
  });

  it("preserves project name", () => {
    const manifest = { project: "my-app", resources: [] };
    const result = normalizeManifest(manifest);
    expect(result.project).toBe("my-app");
  });
});

// =============================================================================
// getAllResources
// =============================================================================

describe("getAllResources", () => {
  it("returns resources from v1 manifest", () => {
    expect(getAllResources({ resources: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("flattens resources from v2 manifest", () => {
    const manifest = {
      version: 2 as const,
      accounts: {
        "aws:111": { resources: ["a"] },
        "aws:222": { resources: ["b", "c"] },
      },
    };
    expect(getAllResources(manifest)).toEqual(["a", "b", "c"]);
  });
});

// =============================================================================
// readManifest
// =============================================================================

describe("readManifest", () => {
  it("throws ManifestError when file not found", () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(() => readManifest("missing.json")).toThrow(ManifestError);
    expect(() => readManifest("missing.json")).toThrow("not found");
  });

  it("parses JSON legacy manifest", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ resources: ["arn:aws:s3:::bucket"] })
    );
    const result = readManifest("manifest.json");
    expect(result).toEqual({ resources: ["arn:aws:s3:::bucket"] });
  });

  it("parses JSON v2 manifest", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        version: 2,
        accounts: {
          "aws:123456789012": { resources: ["arn:aws:s3:::bucket"] },
        },
      })
    );
    const result = readManifest("manifest.json");
    expect("accounts" in result).toBe(true);
  });

  it("parses TXT manifest", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      "# comment\narn:aws:s3:::bucket\n\nprojects/p/locations/us/services/s\n"
    );
    const result = readManifest("manifest.txt");
    expect("resources" in result).toBe(true);
    if ("resources" in result) {
      expect(result.resources).toHaveLength(2);
    }
  });

  it("throws ManifestError for invalid JSON", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("{bad json");
    expect(() => readManifest("bad.json")).toThrow(ManifestError);
  });

  it("throws ManifestError for invalid resources", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ resources: ["not-a-valid-resource"] })
    );
    expect(() => readManifest("bad.json")).toThrow(ManifestError);
  });

  it("throws ManifestError for non-string resource", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ resources: [123] }));
    expect(() => readManifest("bad.json")).toThrow(ManifestError);
  });

  it("throws ManifestError for JSON object without resources", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ name: "test" }));
    expect(() => readManifest("bad.json")).toThrow(ManifestError);
  });

  it("throws for invalid account key in v2 manifest", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        version: 2,
        accounts: { "invalid-key": { resources: ["arn:aws:s3:::bucket"] } },
      })
    );
    expect(() => readManifest("bad.json")).toThrow(ManifestError);
  });

  it("throws for invalid resources in v2 manifest", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        version: 2,
        accounts: { "aws:123": { resources: ["not-valid"] } },
      })
    );
    expect(() => readManifest("bad.json")).toThrow(ManifestError);
  });

  it("throws for invalid TXT resources", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("not-a-valid-resource\n");
    expect(() => readManifest("manifest.txt")).toThrow(ManifestError);
  });

  it("tries JSON then TXT for unknown extension", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("arn:aws:s3:::bucket\n");
    const result = readManifest("manifest.yaml");
    expect("resources" in result).toBe(true);
  });

  it("parses v2 fallback with accounts but missing version", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        accounts: {
          "aws:123456789012": { resources: ["arn:aws:s3:::bucket"] },
        },
      })
    );
    const result = readManifest("manifest.json");
    expect("accounts" in result).toBe(true);
  });

  it("parses v2 manifest with project and alias", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        version: 2,
        project: "my-app",
        accounts: {
          "aws:123456789012": { alias: "prod", resources: ["arn:aws:s3:::bucket"] },
        },
      })
    );
    const result = readManifest("manifest.json");
    expect("accounts" in result).toBe(true);
  });

  it("throws for accounts entry with missing resources array", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        accounts: {
          "aws:123456789012": { alias: "prod" },
        },
      })
    );
    expect(() => readManifest("manifest.json")).toThrow(ManifestError);
  });

  it("throws for accounts entry that is not an object", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        accounts: {
          "aws:123456789012": "not-an-object",
        },
      })
    );
    expect(() => readManifest("manifest.json")).toThrow(ManifestError);
  });
});
