import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    lstatSync: vi.fn(),
    statSync: vi.fn(),
  };
});

vi.mock("glob", () => ({
  globSync: vi.fn(),
}));

vi.mock("../../../src/core/index.js", async () => {
  return {
    loadConfigAsync: vi.fn(),
    getProjectRoot: vi.fn(),
  };
});

import * as fs from "node:fs";
import { globSync } from "glob";

import { getDependencies } from "../../../src/dependencies/index.js";
import { loadConfigAsync, getProjectRoot } from "../../../src/core/index.js";
import type { Config } from "../../../src/core/schema.js";

const mockedFs = vi.mocked(fs);
const mockedGlobSync = vi.mocked(globSync);
const mockedLoadConfigAsync = vi.mocked(loadConfigAsync);
const mockedGetProjectRoot = vi.mocked(getProjectRoot);

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper to build a minimal config with specific tools enabled
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    code: {
      linting: {
        eslint: { enabled: false },
        ruff: { enabled: false },
      },
      types: {
        tsc: { enabled: false },
        ty: { enabled: false },
      },
      unused: {
        knip: { enabled: false },
        vulture: { enabled: false },
      },
      security: {
        secrets: { enabled: false, scan_mode: "branch", base_branch: "main" },
        pnpmaudit: { enabled: false, exclude_dev: true },
        pipaudit: { enabled: false },
      },
    },
    ...overrides,
  } as Config;
}

describe("getDependencies", () => {
  it("returns empty dependencies when no tools are enabled", async () => {
    const config = makeConfig();

    mockedLoadConfigAsync.mockResolvedValue({
      config,
      configPath: "/project/standards.toml",
    });
    mockedGetProjectRoot.mockReturnValue("/project");
    mockedFs.existsSync.mockReturnValue(false);
    mockedGlobSync.mockReturnValue([]);

    const result = await getDependencies({});

    expect(result.dependencies).toEqual({});
  });

  it("collects eslint dependencies when eslint is enabled", async () => {
    const config = makeConfig({
      code: {
        linting: {
          eslint: { enabled: true },
          ruff: { enabled: false },
        },
        types: { tsc: { enabled: false }, ty: { enabled: false } },
        unused: { knip: { enabled: false }, vulture: { enabled: false } },
        security: {
          secrets: { enabled: false, scan_mode: "branch", base_branch: "main" },
          pnpmaudit: { enabled: false, exclude_dev: true },
          pipaudit: { enabled: false },
        },
      },
    });

    mockedLoadConfigAsync.mockResolvedValue({
      config,
      configPath: "/project/standards.toml",
    });
    mockedGetProjectRoot.mockReturnValue("/project");

    // eslint.config.js exists
    mockedFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("eslint.config.js");
    });
    mockedGlobSync.mockReturnValue([]);

    const result = await getDependencies({});

    expect(result.dependencies.eslint).toBeDefined();
    expect(result.dependencies.eslint).toContain("eslint.config.js");
  });

  it("filters dependencies by check option", async () => {
    const config = makeConfig({
      code: {
        linting: {
          eslint: { enabled: true },
          ruff: { enabled: true },
        },
        types: { tsc: { enabled: false }, ty: { enabled: false } },
        unused: { knip: { enabled: false }, vulture: { enabled: false } },
        security: {
          secrets: { enabled: false, scan_mode: "branch", base_branch: "main" },
          pnpmaudit: { enabled: false, exclude_dev: true },
          pipaudit: { enabled: false },
        },
      },
    });

    mockedLoadConfigAsync.mockResolvedValue({
      config,
      configPath: "/project/standards.toml",
    });
    mockedGetProjectRoot.mockReturnValue("/project");

    mockedFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("eslint.config.js") || s.endsWith("ruff.toml");
    });
    mockedGlobSync.mockReturnValue([]);

    // Only request eslint dependencies
    const result = await getDependencies({ check: "eslint" });

    expect(result.dependencies.eslint).toBeDefined();
    expect(result.dependencies.ruff).toBeUndefined();
  });

  it("includes custom dependency files from config", async () => {
    const config = makeConfig({
      code: {
        linting: {
          eslint: {
            enabled: true,
            dependencies: ["custom-rules.js"],
          },
          ruff: { enabled: false },
        },
        types: { tsc: { enabled: false }, ty: { enabled: false } },
        unused: { knip: { enabled: false }, vulture: { enabled: false } },
        security: {
          secrets: { enabled: false, scan_mode: "branch", base_branch: "main" },
          pnpmaudit: { enabled: false, exclude_dev: true },
          pipaudit: { enabled: false },
        },
      },
    });

    mockedLoadConfigAsync.mockResolvedValue({
      config,
      configPath: "/project/standards.toml",
    });
    mockedGetProjectRoot.mockReturnValue("/project");

    mockedFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("eslint.config.js") || s.endsWith("custom-rules.js");
    });
    mockedGlobSync.mockReturnValue([]);

    const result = await getDependencies({});

    expect(result.dependencies.eslint).toContain("custom-rules.js");
    expect(result.dependencies.eslint).toContain("eslint.config.js");
  });

  it("expands glob patterns for config files", async () => {
    const config = makeConfig({
      code: {
        linting: { eslint: { enabled: false }, ruff: { enabled: false } },
        types: { tsc: { enabled: true }, ty: { enabled: false } },
        unused: { knip: { enabled: false }, vulture: { enabled: false } },
        security: {
          secrets: { enabled: false, scan_mode: "branch", base_branch: "main" },
          pnpmaudit: { enabled: false, exclude_dev: true },
          pipaudit: { enabled: false },
        },
      },
    });

    mockedLoadConfigAsync.mockResolvedValue({
      config,
      configPath: "/project/standards.toml",
    });
    mockedGetProjectRoot.mockReturnValue("/project");

    // tsconfig.json is a non-glob entry
    mockedFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("tsconfig.json");
    });

    // tsconfig.*.json glob returns matches
    mockedGlobSync.mockImplementation((pattern: any) => {
      const p = String(pattern);
      if (p.includes("tsconfig.*.json")) {
        return ["tsconfig.build.json"] as any;
      }
      return [] as any;
    });

    const result = await getDependencies({});

    expect(result.dependencies.tsc).toContain("tsconfig.json");
    expect(result.dependencies.tsc).toContain("tsconfig.build.json");
  });

  it("always includes alwaysTracked files that exist", async () => {
    const config = makeConfig();

    mockedLoadConfigAsync.mockResolvedValue({
      config,
      configPath: "/project/standards.toml",
    });
    mockedGetProjectRoot.mockReturnValue("/project");

    mockedFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("standards.toml") || s.endsWith("repo-metadata.yaml");
    });
    mockedGlobSync.mockImplementation((pattern: any) => {
      const p = String(pattern);
      if (p.includes("workflows")) {
        return ["ci.yml"] as any;
      }
      return [] as any;
    });

    const result = await getDependencies({});

    expect(result.alwaysTracked).toContain("standards.toml");
  });

  it("returns project and checkTomlPath", async () => {
    const config = makeConfig();

    mockedLoadConfigAsync.mockResolvedValue({
      config,
      configPath: "/project/standards.toml",
    });
    mockedGetProjectRoot.mockReturnValue("/project");
    mockedFs.existsSync.mockReturnValue(false);
    mockedGlobSync.mockReturnValue([]);

    const result = await getDependencies({});

    expect(result.project).toBe(".");
    expect(result.checkTomlPath).toBe("standards.toml");
  });

  it("deduplicates allFiles", async () => {
    const config = makeConfig({
      code: {
        linting: {
          eslint: { enabled: true },
          ruff: { enabled: false },
        },
        types: { tsc: { enabled: false }, ty: { enabled: false } },
        unused: { knip: { enabled: false }, vulture: { enabled: false } },
        security: {
          secrets: { enabled: false, scan_mode: "branch", base_branch: "main" },
          pnpmaudit: { enabled: false, exclude_dev: true },
          pipaudit: { enabled: false },
        },
      },
    });

    mockedLoadConfigAsync.mockResolvedValue({
      config,
      configPath: "/project/standards.toml",
    });
    mockedGetProjectRoot.mockReturnValue("/project");

    // standards.toml exists both as always-tracked and as a non-config file
    mockedFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("eslint.config.js") || s.endsWith("standards.toml");
    });
    mockedGlobSync.mockReturnValue([]);

    const result = await getDependencies({});

    // allFiles should be deduplicated
    const uniqueFiles = [...new Set(result.allFiles)];
    expect(result.allFiles).toEqual(uniqueFiles);
  });

  it("uses provided project path", async () => {
    const config = makeConfig();

    mockedLoadConfigAsync.mockResolvedValue({
      config,
      configPath: "/project/standards.toml",
    });
    mockedGetProjectRoot.mockReturnValue("/project");
    mockedFs.existsSync.mockReturnValue(false);
    mockedGlobSync.mockReturnValue([]);

    const result = await getDependencies({ project: "packages/app" });

    expect(result.project).toBe("packages/app");
  });
});
