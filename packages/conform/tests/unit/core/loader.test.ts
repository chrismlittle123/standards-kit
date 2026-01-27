import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CONFIG_FILE_NAME,
  ConfigError,
  findConfigFile,
  loadConfig,
  getProjectRoot,
} from "../../../src/core/index.js";

// Mock the fs module
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    lstatSync: vi.fn(),
    statSync: vi.fn(),
  };
});

describe("CONFIG_FILE_NAME", () => {
  it("is standards.toml", () => {
    expect(CONFIG_FILE_NAME).toBe("standards.toml");
  });
});

describe("ConfigError", () => {
  it("is an Error instance", () => {
    const error = new ConfigError("test message");
    expect(error).toBeInstanceOf(Error);
  });

  it("has name ConfigError", () => {
    const error = new ConfigError("test message");
    expect(error.name).toBe("ConfigError");
  });

  it("preserves the message", () => {
    const error = new ConfigError("test message");
    expect(error.message).toBe("test message");
  });
});

describe("findConfigFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns config path when found in current directory", () => {
    const mockExistsSync = vi.mocked(fs.existsSync);
    const mockLstatSync = vi.mocked(fs.lstatSync);

    // First call is for broken symlink check, second for existsSync
    mockLstatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockExistsSync.mockImplementation((p) => {
      return p === path.join("/test/project", CONFIG_FILE_NAME);
    });

    const result = findConfigFile("/test/project");
    expect(result).toBe(path.join("/test/project", CONFIG_FILE_NAME));
  });

  it("walks up directory tree to find config", () => {
    const mockExistsSync = vi.mocked(fs.existsSync);
    const mockLstatSync = vi.mocked(fs.lstatSync);

    mockLstatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    // Config is in parent directory
    mockExistsSync.mockImplementation((p) => {
      return p === path.join("/test", CONFIG_FILE_NAME);
    });

    const result = findConfigFile("/test/project/subdir");
    expect(result).toBe(path.join("/test", CONFIG_FILE_NAME));
  });

  it("returns null when config not found", () => {
    const mockExistsSync = vi.mocked(fs.existsSync);
    const mockLstatSync = vi.mocked(fs.lstatSync);

    mockLstatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockExistsSync.mockReturnValue(false);

    const result = findConfigFile("/test/project");
    expect(result).toBeNull();
  });

  it("throws ConfigError for broken symlink", () => {
    const mockLstatSync = vi.mocked(fs.lstatSync);
    const mockStatSync = vi.mocked(fs.statSync);

    // lstatSync returns symlink stats
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => true,
    } as fs.Stats);

    // statSync throws (broken symlink)
    mockStatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(() => findConfigFile("/test/project")).toThrow(ConfigError);
    expect(() => findConfigFile("/test/project")).toThrow("broken symlink");
  });
});

describe("loadConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads and parses valid TOML config", () => {
    const mockExistsSync = vi.mocked(fs.existsSync);
    const mockReadFileSync = vi.mocked(fs.readFileSync);
    const mockLstatSync = vi.mocked(fs.lstatSync);

    const configPath = "/test/project/standards.toml";

    mockLstatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockExistsSync.mockImplementation((p) => p === configPath);
    mockReadFileSync.mockReturnValue(`
[metadata]
tier = "production"
status = "active"
`);

    const result = loadConfig(configPath);
    expect(result.config).toBeDefined();
    expect(result.configPath).toBe(configPath);
  });

  it("throws ConfigError for non-existent config path", () => {
    const mockExistsSync = vi.mocked(fs.existsSync);

    mockExistsSync.mockReturnValue(false);

    expect(() => loadConfig("/nonexistent/standards.toml")).toThrow(ConfigError);
    expect(() => loadConfig("/nonexistent/standards.toml")).toThrow("not found");
  });

  it("throws ConfigError for invalid TOML syntax", () => {
    const mockExistsSync = vi.mocked(fs.existsSync);
    const mockReadFileSync = vi.mocked(fs.readFileSync);
    const mockLstatSync = vi.mocked(fs.lstatSync);

    const configPath = "/test/project/standards.toml";

    mockLstatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockExistsSync.mockImplementation((p) => p === configPath);
    mockReadFileSync.mockReturnValue("invalid [ toml {");

    expect(() => loadConfig(configPath)).toThrow(ConfigError);
    expect(() => loadConfig(configPath)).toThrow("Failed to parse");
  });

  it("throws ConfigError for invalid config schema", () => {
    const mockExistsSync = vi.mocked(fs.existsSync);
    const mockReadFileSync = vi.mocked(fs.readFileSync);
    const mockLstatSync = vi.mocked(fs.lstatSync);

    const configPath = "/test/project/standards.toml";

    mockLstatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockExistsSync.mockImplementation((p) => p === configPath);
    mockReadFileSync.mockReturnValue(`
[metadata]
tier = "invalid_tier"
`);

    expect(() => loadConfig(configPath)).toThrow(ConfigError);
    expect(() => loadConfig(configPath)).toThrow("Invalid");
  });

  it("merges with defaults", () => {
    const mockExistsSync = vi.mocked(fs.existsSync);
    const mockReadFileSync = vi.mocked(fs.readFileSync);
    const mockLstatSync = vi.mocked(fs.lstatSync);

    const configPath = "/test/project/standards.toml";

    mockLstatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockExistsSync.mockImplementation((p) => p === configPath);
    mockReadFileSync.mockReturnValue(`
[code.linting.eslint]
enabled = true
`);

    const result = loadConfig(configPath);
    // Should have merged defaults
    expect(result.config.code?.linting?.eslint?.enabled).toBe(true);
    expect(result.config.process?.hooks?.enabled).toBe(false); // default
  });
});

describe("getProjectRoot", () => {
  it("returns directory of config path", () => {
    expect(getProjectRoot("/test/project/standards.toml")).toBe("/test/project");
  });

  it("handles nested paths", () => {
    expect(getProjectRoot("/a/b/c/d/standards.toml")).toBe("/a/b/c/d");
  });
});
