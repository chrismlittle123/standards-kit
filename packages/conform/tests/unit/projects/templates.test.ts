import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

import * as fs from "node:fs";

import { createCheckToml, createRegistry } from "../../../src/projects/templates.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createCheckToml", () => {
  it("returns false if standards.toml already exists", () => {
    mockedFs.existsSync.mockReturnValue(true);
    const result = createCheckToml("/project", "typescript", false);
    expect(result).toBe(false);
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("creates TypeScript template", () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = createCheckToml("/project", "typescript", false);
    expect(result).toBe(true);
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      "/project/standards.toml",
      expect.stringContaining("eslint"),
      "utf-8"
    );
  });

  it("creates Python template", () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = createCheckToml("/project", "python", false);
    expect(result).toBe(true);
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      "/project/standards.toml",
      expect.stringContaining("ruff"),
      "utf-8"
    );
  });

  it("skips writing in dry-run mode", () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = createCheckToml("/project", "typescript", true);
    expect(result).toBe(true);
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("creates extends template with registry path", () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = createCheckToml("/project", "typescript", false, "../registry");
    expect(result).toBe(true);
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      "/project/standards.toml",
      expect.stringContaining("../registry"),
      "utf-8"
    );
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      "/project/standards.toml",
      expect.stringContaining("[extends]"),
      "utf-8"
    );
  });
});

describe("createRegistry", () => {
  it("creates rulesets directory and files", () => {
    createRegistry("/registry", new Set(["typescript", "python"] as const), false);
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith("/registry/rulesets", { recursive: true });
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it("creates typescript ruleset with eslint and tsc", () => {
    createRegistry("/registry", new Set(["typescript"] as const), false);
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      "/registry/rulesets/typescript.toml",
      expect.stringContaining("eslint"),
      "utf-8"
    );
  });

  it("creates python ruleset with ruff", () => {
    createRegistry("/registry", new Set(["python"] as const), false);
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      "/registry/rulesets/python.toml",
      expect.stringContaining("ruff"),
      "utf-8"
    );
  });

  it("skips writing in dry-run mode", () => {
    createRegistry("/registry", new Set(["typescript"] as const), true);
    expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });
});
