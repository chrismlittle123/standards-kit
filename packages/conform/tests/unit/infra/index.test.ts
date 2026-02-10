vi.mock("../../../src/infra/manifest.js", () => ({
  ManifestError: class ManifestError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ManifestError";
    }
  },
  readManifest: vi.fn(),
  getAllResources: vi.fn(),
  isMultiAccountManifest: vi.fn(),
}));

vi.mock("../../../src/infra/scan.js", () => ({
  scanManifest: vi.fn(),
}));

vi.mock("../../../src/infra/output.js", () => ({
  formatScan: vi.fn(),
}));

vi.mock("../../../src/core/index.js", () => ({
  getProjectRoot: vi.fn(),
  loadConfigAsync: vi.fn(),
  ExitCode: { SUCCESS: 0, VIOLATIONS_FOUND: 1, CONFIG_ERROR: 2, RUNTIME_ERROR: 3 },
}));

vi.mock("../../../src/infra/generate.js", () => ({
  DEFAULT_MANIFEST_NAME: "infra-manifest.json",
  generateWithMerge: vi.fn(),
  writeManifest: vi.fn(),
  generateManifestFromStdin: vi.fn(),
  generateManifestFromFile: vi.fn(),
  generateMultiAccountFromStdin: vi.fn(),
  generateMultiAccountFromFile: vi.fn(),
  mergeIntoManifest: vi.fn(),
  parseStackExport: vi.fn(),
  parseStackExportMultiAccount: vi.fn(),
  readExistingManifest: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { scanInfra, runInfraScan } from "../../../src/infra/index.js";
import { readManifest, ManifestError } from "../../../src/infra/manifest.js";
import { scanManifest } from "../../../src/infra/scan.js";
import { formatScan } from "../../../src/infra/output.js";
import { loadConfigAsync, getProjectRoot } from "../../../src/core/index.js";
import type { InfraScanResult } from "../../../src/infra/types.js";

const mocked = vi.mocked;

function makeScanResult(overrides: Partial<InfraScanResult> = {}): InfraScanResult {
  return {
    manifest: "/path/to/manifest.json",
    results: [],
    summary: { total: 0, found: 0, missing: 0, errors: 0 },
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("scanInfra", () => {
  it("reads manifest and scans when manifestPath is provided", async () => {
    const manifest = { resources: ["arn:aws:s3:::bucket"] };
    mocked(readManifest).mockReturnValue(manifest as any);
    mocked(scanManifest).mockResolvedValue(makeScanResult());

    await scanInfra({ manifestPath: "/abs/manifest.json" });

    expect(readManifest).toHaveBeenCalledWith("/abs/manifest.json");
    expect(scanManifest).toHaveBeenCalledWith(manifest, "/abs/manifest.json", { account: undefined });
  });

  it("resolves relative manifestPath from cwd", async () => {
    const manifest = { resources: [] };
    mocked(readManifest).mockReturnValue(manifest as any);
    mocked(scanManifest).mockResolvedValue(makeScanResult());

    await scanInfra({ manifestPath: "relative/manifest.json" });

    const calledPath = mocked(readManifest).mock.calls[0][0];
    expect(calledPath).toContain("relative/manifest.json");
    expect(calledPath.startsWith("/")).toBe(true);
  });

  it("loads config to resolve manifest path when no manifestPath given", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: { infra: { enabled: true, manifest: "infra-manifest.json" } } as any,
      configPath: "/project/standards.toml",
    });
    mocked(getProjectRoot).mockReturnValue("/project");
    mocked(readManifest).mockReturnValue({ resources: [] } as any);
    mocked(scanManifest).mockResolvedValue(makeScanResult());

    await scanInfra({});

    expect(readManifest).toHaveBeenCalledWith("/project/infra-manifest.json");
  });

  it("throws ManifestError when infra is not enabled", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: { infra: { enabled: false } } as any,
      configPath: "/project/standards.toml",
    });
    mocked(getProjectRoot).mockReturnValue("/project");

    await expect(scanInfra({})).rejects.toThrow("not enabled");
  });

  it("passes account option to scanManifest", async () => {
    const manifest = { resources: [] };
    mocked(readManifest).mockReturnValue(manifest as any);
    mocked(scanManifest).mockResolvedValue(makeScanResult());

    await scanInfra({ manifestPath: "/m.json", account: "prod" });

    expect(scanManifest).toHaveBeenCalledWith(manifest, "/m.json", { account: "prod" });
  });
});

describe("runInfraScan", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("outputs formatted result and exits 0 on success", async () => {
    const scanResult = makeScanResult({ summary: { total: 2, found: 2, missing: 0, errors: 0 } });
    mocked(readManifest).mockReturnValue({ resources: [] } as any);
    mocked(scanManifest).mockResolvedValue(scanResult);
    mocked(formatScan).mockReturnValue("formatted output");

    await runInfraScan({ manifestPath: "/m.json", format: "text" });

    expect(formatScan).toHaveBeenCalledWith(scanResult, "text");
    expect(stdoutSpy).toHaveBeenCalledWith("formatted output\n");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits 1 when there are missing resources", async () => {
    const scanResult = makeScanResult({ summary: { total: 2, found: 1, missing: 1, errors: 0 } });
    mocked(readManifest).mockReturnValue({ resources: [] } as any);
    mocked(scanManifest).mockResolvedValue(scanResult);
    mocked(formatScan).mockReturnValue("output");

    await runInfraScan({ manifestPath: "/m.json" });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 3 when there are errors", async () => {
    const scanResult = makeScanResult({ summary: { total: 2, found: 1, missing: 0, errors: 1 } });
    mocked(readManifest).mockReturnValue({ resources: [] } as any);
    mocked(scanManifest).mockResolvedValue(scanResult);
    mocked(formatScan).mockReturnValue("output");

    await runInfraScan({ manifestPath: "/m.json" });

    expect(exitSpy).toHaveBeenCalledWith(3);
  });

  it("handles ManifestError with config exit code", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: { infra: { enabled: false } } as any,
      configPath: "/project/standards.toml",
    });
    mocked(getProjectRoot).mockReturnValue("/project");

    await runInfraScan({});

    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("handles generic error with runtime exit code", async () => {
    mocked(readManifest).mockImplementation(() => {
      throw new Error("file not found");
    });

    await runInfraScan({ manifestPath: "/m.json" });

    expect(exitSpy).toHaveBeenCalledWith(3);
  });

  it("outputs JSON error when format is json and error occurs", async () => {
    mocked(readManifest).mockImplementation(() => {
      throw new Error("bad manifest");
    });

    await runInfraScan({ manifestPath: "/m.json", format: "json" });

    const output = stdoutSpy.mock.calls[0]?.[0] as string;
    expect(output).toBeDefined();
    const parsed = JSON.parse(output.trim());
    expect(parsed.error).toBe("bad manifest");
  });
});
