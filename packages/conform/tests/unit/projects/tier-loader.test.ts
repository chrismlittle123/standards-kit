import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

vi.mock("@iarna/toml", () => ({
  default: {
    parse: vi.fn(),
  },
}));

import * as fs from "node:fs";
import TOML from "@iarna/toml";

import { loadProjectTier } from "../../../src/projects/tier-loader.js";

const mockedFs = vi.mocked(fs);
const mockedToml = vi.mocked(TOML);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadProjectTier", () => {
  it("returns undefined tier and null source when standards.toml does not exist", () => {
    mockedFs.existsSync.mockReturnValue(false);

    const result = loadProjectTier("/project");

    expect(result.tier).toBeUndefined();
    expect(result.source).toBeNull();
  });

  it("returns default tier when metadata section is missing", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("");
    mockedToml.parse.mockReturnValue({} as any);

    const result = loadProjectTier("/project");

    expect(result.tier).toBe("internal");
    expect(result.source).toBe("default");
  });

  it("returns default tier when metadata.tier is not set", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("");
    mockedToml.parse.mockReturnValue({ metadata: {} } as any);

    const result = loadProjectTier("/project");

    expect(result.tier).toBe("internal");
    expect(result.source).toBe("default");
  });

  it("returns production tier from standards.toml", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("");
    mockedToml.parse.mockReturnValue({
      metadata: { tier: "production" },
    } as any);

    const result = loadProjectTier("/project");

    expect(result.tier).toBe("production");
    expect(result.source).toBe("standards.toml");
  });

  it("returns internal tier from standards.toml", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("");
    mockedToml.parse.mockReturnValue({
      metadata: { tier: "internal" },
    } as any);

    const result = loadProjectTier("/project");

    expect(result.tier).toBe("internal");
    expect(result.source).toBe("standards.toml");
  });

  it("returns prototype tier from standards.toml", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("");
    mockedToml.parse.mockReturnValue({
      metadata: { tier: "prototype" },
    } as any);

    const result = loadProjectTier("/project");

    expect(result.tier).toBe("prototype");
    expect(result.source).toBe("standards.toml");
  });

  it("returns default tier for invalid tier value", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("");
    mockedToml.parse.mockReturnValue({
      metadata: { tier: "invalid-tier" },
    } as any);

    const result = loadProjectTier("/project");

    expect(result.tier).toBe("internal");
    expect(result.source).toBe("default");
  });

  it("includes project metadata when available", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("");
    mockedToml.parse.mockReturnValue({
      metadata: {
        tier: "production",
        project: "my-app",
        organisation: "my-org",
        status: "active",
      },
    } as any);

    const result = loadProjectTier("/project");

    expect(result.tier).toBe("production");
    expect(result.project).toBe("my-app");
    expect(result.organisation).toBe("my-org");
    expect(result.status).toBe("active");
  });

  it("returns undefined tier and null source when TOML parsing fails", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("invalid toml");
    mockedToml.parse.mockImplementation(() => {
      throw new Error("Parse error");
    });

    const result = loadProjectTier("/project");

    expect(result.tier).toBeUndefined();
    expect(result.source).toBeNull();
  });

  it("reads from standards.toml in project directory", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("");
    mockedToml.parse.mockReturnValue({} as any);

    loadProjectTier("/my/project/dir");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(
      expect.stringContaining("standards.toml")
    );
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("standards.toml"),
      "utf-8"
    );
  });
});
