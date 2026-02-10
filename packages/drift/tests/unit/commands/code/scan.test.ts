import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external modules before imports
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("../../../../src/github/org-scanner.js", () => ({
  scanOrg: vi.fn(),
}));

vi.mock("../../../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
  findConfigPath: vi.fn(),
}));

vi.mock("../../../../src/version.js", () => ({
  version: "1.0.0-test",
}));

vi.mock("../../../../src/utils/index.js", () => ({
  actionsOutput: {
    error: vi.fn(),
    warning: vi.fn(),
    notice: vi.fn(),
  },
  COLORS: {
    reset: "",
    bold: "",
    dim: "",
    red: "",
    green: "",
    yellow: "",
    cyan: "",
    white: "",
  },
}));

vi.mock("../../../../src/repo/detection.js", () => ({
  hasMetadata: vi.fn(),
  hasCheckToml: vi.fn(),
  getRepoMetadata: vi.fn(),
  findCheckTomlFiles: vi.fn(),
}));

vi.mock("../../../../src/repo/check-toml.js", () => ({
  validateCheckToml: vi.fn(),
}));

import { existsSync } from "fs";
import { scanOrg } from "../../../../src/github/org-scanner.js";
import { loadConfig, findConfigPath } from "../../../../src/config/loader.js";
import { actionsOutput } from "../../../../src/utils/index.js";
import {
  hasMetadata,
  hasCheckToml,
  getRepoMetadata,
  findCheckTomlFiles,
} from "../../../../src/repo/detection.js";
import { validateCheckToml } from "../../../../src/repo/check-toml.js";
import { scan } from "../../../../src/commands/code/scan.js";

describe("commands/code/scan", () => {
  const mockExistsSync = vi.mocked(existsSync);
  const mockScanOrg = vi.mocked(scanOrg);
  const mockLoadConfig = vi.mocked(loadConfig);
  const mockFindConfigPath = vi.mocked(findConfigPath);
  const mockHasMetadata = vi.mocked(hasMetadata);
  const mockHasCheckToml = vi.mocked(hasCheckToml);
  const mockGetRepoMetadata = vi.mocked(getRepoMetadata);
  const mockFindCheckTomlFiles = vi.mocked(findCheckTomlFiles);
  const mockValidateCheckToml = vi.mocked(validateCheckToml);
  const mockActionsOutput = vi.mocked(actionsOutput);

  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  describe("org scanning mode", () => {
    it("delegates to scanOrg when --org is provided", async () => {
      mockScanOrg.mockResolvedValueOnce({
        org: "my-org",
        configRepo: "drift-config",
        timestamp: new Date().toISOString(),
        repos: [],
        summary: { reposScanned: 0, reposWithIssues: 0, reposSkipped: 0 },
      });

      await scan({
        org: "my-org",
        githubToken: "test-token",
        json: true,
      });

      expect(mockScanOrg).toHaveBeenCalledWith({
        org: "my-org",
        repo: undefined,
        configRepo: undefined,
        token: "test-token",
        json: true,
        dryRun: undefined,
        all: undefined,
        since: undefined,
      });
    });

    it("passes all options to scanOrg", async () => {
      mockScanOrg.mockResolvedValueOnce({
        org: "my-org",
        configRepo: "custom-config",
        timestamp: new Date().toISOString(),
        repos: [],
        summary: { reposScanned: 0, reposWithIssues: 0, reposSkipped: 0 },
      });

      await scan({
        org: "my-org",
        repo: "specific-repo",
        configRepo: "custom-config",
        githubToken: "tok",
        json: false,
        dryRun: true,
        all: true,
        since: 48,
      });

      expect(mockScanOrg).toHaveBeenCalledWith({
        org: "my-org",
        repo: "specific-repo",
        configRepo: "custom-config",
        token: "tok",
        json: false,
        dryRun: true,
        all: true,
        since: 48,
      });
    });

    it("returns immediately after scanOrg", async () => {
      mockScanOrg.mockResolvedValueOnce({
        org: "my-org",
        configRepo: "drift-config",
        timestamp: new Date().toISOString(),
        repos: [],
        summary: { reposScanned: 0, reposWithIssues: 0, reposSkipped: 0 },
      });

      await scan({ org: "my-org" });

      // loadConfig should not be called for org mode
      expect(mockLoadConfig).not.toHaveBeenCalled();
    });
  });

  describe("local scanning mode - --repo without --org", () => {
    it("exits with error when --repo is used without --org", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await scan({ repo: "some-repo" });

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("--repo requires --org")
      );
      expect(mockActionsOutput.error).toHaveBeenCalledWith(
        "--repo requires --org to be specified"
      );
      consoleSpy.mockRestore();
    });
  });

  describe("local scanning mode - path", () => {
    it("exits with error when path does not exist", async () => {
      mockExistsSync.mockReturnValue(false);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await scan({ path: "/nonexistent/path" });

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockActionsOutput.error).toHaveBeenCalledWith(
        expect.stringContaining("Path does not exist")
      );
      consoleSpy.mockRestore();
    });

    it("prints help when no config is found and not json mode", async () => {
      mockExistsSync.mockReturnValue(true);
      mockFindConfigPath.mockReturnValue(null);
      mockLoadConfig.mockReturnValue(null);

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ path: "/some/valid/path" });

      // Should print the help message without crashing
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Drift v")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("No drift.config.yaml found")
      );
      consoleSpy.mockRestore();
    });

    it("validates repo files and prints warnings when config exists", async () => {
      mockExistsSync.mockReturnValue(true);
      mockFindConfigPath.mockReturnValue("/some/valid/path/drift.config.yaml");
      mockLoadConfig.mockReturnValue({ schema: { tiers: ["production"] } });
      mockHasMetadata.mockReturnValue(false);
      mockHasCheckToml.mockReturnValue(false);

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ path: "/some/valid/path" });

      // Should complete without error
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Repository validated")
      );
      consoleSpy.mockRestore();
    });

    it("outputs JSON when --json is set", async () => {
      mockExistsSync.mockReturnValue(true);
      mockFindConfigPath.mockReturnValue("/path/drift.config.yaml");
      mockLoadConfig.mockReturnValue({ schema: {} });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ path: "/some/valid/path", json: true });

      // Should output JSON (the call with a JSON.stringify result)
      const jsonCalls = consoleSpy.mock.calls.filter((call) => {
        try {
          JSON.parse(call[0] as string);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCalls.length).toBeGreaterThan(0);
      consoleSpy.mockRestore();
    });

    it("uses cwd when no path or repo specified", async () => {
      mockExistsSync.mockReturnValue(true);
      mockFindConfigPath.mockReturnValue(null);
      mockLoadConfig.mockReturnValue(null);

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({});

      // Should try the current directory and print help
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("No drift.config.yaml found")
      );
      consoleSpy.mockRestore();
    });
  });

  describe("repo file validation", () => {
    it("warns about missing metadata", async () => {
      mockExistsSync.mockReturnValue(true);
      mockFindConfigPath.mockReturnValue("/path/drift.config.yaml");
      mockLoadConfig.mockReturnValue({ schema: {} });
      mockHasMetadata.mockReturnValue(false);
      mockHasCheckToml.mockReturnValue(true);
      mockFindCheckTomlFiles.mockReturnValue(["standards.toml"]);
      mockValidateCheckToml.mockReturnValue({
        path: "standards.toml",
        valid: true,
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ path: "/some/path" });

      // The warning about no metadata should be printed
      const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("No metadata found");
      consoleSpy.mockRestore();
    });

    it("warns about missing standards.toml", async () => {
      mockExistsSync.mockReturnValue(true);
      mockFindConfigPath.mockReturnValue("/path/drift.config.yaml");
      mockLoadConfig.mockReturnValue({ schema: {} });
      mockHasMetadata.mockReturnValue(true);
      mockGetRepoMetadata.mockReturnValue({
        metadata: {
          tier: "production",
          status: "active",
          raw: { tier: "production", status: "active" },
        },
        warnings: [],
      });
      mockHasCheckToml.mockReturnValue(false);

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ path: "/some/path" });

      const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("standards.toml not found");
      consoleSpy.mockRestore();
    });

    it("reports invalid TOML in standards.toml", async () => {
      mockExistsSync.mockReturnValue(true);
      mockFindConfigPath.mockReturnValue("/path/drift.config.yaml");
      mockLoadConfig.mockReturnValue({ schema: {} });
      mockHasMetadata.mockReturnValue(true);
      mockGetRepoMetadata.mockReturnValue({
        metadata: {
          tier: "production",
          status: "active",
          raw: { tier: "production", status: "active" },
        },
        warnings: [],
      });
      mockHasCheckToml.mockReturnValue(true);
      mockFindCheckTomlFiles.mockReturnValue(["standards.toml"]);
      mockValidateCheckToml.mockReturnValue({
        path: "standards.toml",
        valid: false,
        error: "Unexpected token at line 3",
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ path: "/some/path" });

      const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("Invalid TOML");
      consoleSpy.mockRestore();
    });

    it("reports metadata warnings when metadata exists but has issues", async () => {
      mockExistsSync.mockReturnValue(true);
      mockFindConfigPath.mockReturnValue("/path/drift.config.yaml");
      mockLoadConfig.mockReturnValue({ schema: {} });
      mockHasMetadata.mockReturnValue(true);
      mockGetRepoMetadata.mockReturnValue({
        metadata: null,
        warnings: ["Empty metadata file"],
      });
      mockHasCheckToml.mockReturnValue(true);
      mockFindCheckTomlFiles.mockReturnValue(["standards.toml"]);
      mockValidateCheckToml.mockReturnValue({
        path: "standards.toml",
        valid: true,
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ path: "/some/path" });

      const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("Empty metadata file");
      consoleSpy.mockRestore();
    });

    it("reports metadata validation warnings on valid metadata with warnings", async () => {
      mockExistsSync.mockReturnValue(true);
      mockFindConfigPath.mockReturnValue("/path/drift.config.yaml");
      mockLoadConfig.mockReturnValue({ schema: {} });
      mockHasMetadata.mockReturnValue(true);
      mockGetRepoMetadata.mockReturnValue({
        metadata: {
          tier: "internal",
          status: "active",
          raw: { tier: "bad-value" },
        },
        warnings: ['Invalid tier "bad-value", using default "internal"'],
      });
      mockHasCheckToml.mockReturnValue(true);
      mockFindCheckTomlFiles.mockReturnValue(["standards.toml"]);
      mockValidateCheckToml.mockReturnValue({
        path: "standards.toml",
        valid: true,
      });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ path: "/some/path" });

      const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("Invalid tier");
      consoleSpy.mockRestore();
    });

    it("skips repo validation warnings in json mode", async () => {
      mockExistsSync.mockReturnValue(true);
      mockFindConfigPath.mockReturnValue("/path/drift.config.yaml");
      mockLoadConfig.mockReturnValue({ schema: {} });

      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      await scan({ path: "/some/path", json: true });

      // hasMetadata should not be called in JSON mode
      expect(mockHasMetadata).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

// Need to import afterEach for the top-level afterEach
import { afterEach } from "vitest";
