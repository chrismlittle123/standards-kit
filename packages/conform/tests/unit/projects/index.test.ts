import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/projects/detector.js", () => ({
  detectProjects: vi.fn(),
  getProjectTypes: vi.fn(),
}));

vi.mock("../../../src/projects/templates.js", () => ({
  createCheckToml: vi.fn(),
  createRegistry: vi.fn(),
}));

vi.mock("../../../src/projects/tier-loader.js", () => ({
  loadProjectTier: vi.fn(),
}));

vi.mock("../../../src/core/index.js", () => ({
  loadConfigAsync: vi.fn(),
}));

import { detectProjects, getProjectTypes } from "../../../src/projects/detector.js";
import { createCheckToml, createRegistry } from "../../../src/projects/templates.js";
import { loadProjectTier } from "../../../src/projects/tier-loader.js";
import { loadConfigAsync } from "../../../src/core/index.js";
import { runDetect } from "../../../src/projects/index.js";
import type { DetectOptions, DetectionResult } from "../../../src/projects/types.js";

const mockedDetectProjects = vi.mocked(detectProjects);
const mockedGetProjectTypes = vi.mocked(getProjectTypes);
const mockedCreateCheckToml = vi.mocked(createCheckToml);
const mockedCreateRegistry = vi.mocked(createRegistry);
const mockedLoadProjectTier = vi.mocked(loadProjectTier);
const mockedLoadConfigAsync = vi.mocked(loadConfigAsync);

let stdoutOutput: string;

beforeEach(() => {
  vi.clearAllMocks();
  stdoutOutput = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdoutOutput += String(chunk);
    return true;
  });
  vi.spyOn(process, "cwd").mockReturnValue("/workspace");

  // Default: config loads successfully with empty monorepo config
  mockedLoadConfigAsync.mockResolvedValue({
    config: { monorepo: {} },
    configPath: "/workspace/standards.toml",
  } as any);
});

function makeDetectionResult(
  overrides: Partial<DetectionResult> = {}
): DetectionResult {
  return {
    projects: [],
    workspaceRoots: [],
    ...overrides,
  };
}

describe("runDetect", () => {
  it("detects projects and outputs text format", async () => {
    mockedDetectProjects.mockResolvedValue(
      makeDetectionResult({
        projects: [
          { path: "packages/app", type: "typescript", hasCheckToml: true, markerFile: "package.json" },
        ],
      })
    );

    const options: DetectOptions = { format: "text" };
    await runDetect(options);

    expect(mockedDetectProjects).toHaveBeenCalledWith("/workspace", {
      excludePatterns: [],
    });
    expect(stdoutOutput).toContain("packages/app");
  });

  it("detects projects and outputs JSON format", async () => {
    mockedDetectProjects.mockResolvedValue(
      makeDetectionResult({
        projects: [
          { path: "packages/app", type: "typescript", hasCheckToml: true, markerFile: "package.json" },
        ],
      })
    );

    const options: DetectOptions = { format: "json" };
    await runDetect(options);

    const output = JSON.parse(stdoutOutput);
    expect(output.projects).toHaveLength(1);
    expect(output.projects[0].path).toBe("packages/app");
    expect(output.projects[0].status).toBe("has-config");
    expect(output.summary.total).toBe(1);
    expect(output.summary.withConfig).toBe(1);
    expect(output.summary.missingConfig).toBe(0);
  });

  it("passes exclude patterns from monorepo config", async () => {
    mockedLoadConfigAsync.mockResolvedValue({
      config: { monorepo: { exclude: ["legacy/**"] } },
      configPath: "/workspace/standards.toml",
    } as any);

    mockedDetectProjects.mockResolvedValue(makeDetectionResult());

    const options: DetectOptions = { format: "text" };
    await runDetect(options);

    expect(mockedDetectProjects).toHaveBeenCalledWith("/workspace", {
      excludePatterns: ["legacy/**"],
    });
  });

  it("enriches projects with tier info when --show-status", async () => {
    mockedDetectProjects.mockResolvedValue(
      makeDetectionResult({
        projects: [
          { path: "packages/app", type: "typescript", hasCheckToml: true, markerFile: "package.json" },
        ],
      })
    );

    mockedLoadProjectTier.mockReturnValue({
      tier: "production",
      source: "standards.toml",
    });

    const options: DetectOptions = { format: "json", showStatus: true };
    await runDetect(options);

    expect(mockedLoadProjectTier).toHaveBeenCalled();
    const output = JSON.parse(stdoutOutput);
    expect(output.projects[0].tier).toBe("production");
    expect(output.projects[0].tierSource).toBe("standards.toml");
  });

  it("does not enrich tier info when --show-status is false", async () => {
    mockedDetectProjects.mockResolvedValue(
      makeDetectionResult({
        projects: [
          { path: "packages/app", type: "typescript", hasCheckToml: true, markerFile: "package.json" },
        ],
      })
    );

    const options: DetectOptions = { format: "json" };
    await runDetect(options);

    expect(mockedLoadProjectTier).not.toHaveBeenCalled();
  });

  it("filters to missing-config projects when --missing-config", async () => {
    mockedDetectProjects.mockResolvedValue(
      makeDetectionResult({
        projects: [
          { path: "packages/a", type: "typescript", hasCheckToml: true, markerFile: "package.json" },
          { path: "packages/b", type: "typescript", hasCheckToml: false, markerFile: "package.json" },
        ],
      })
    );

    const options: DetectOptions = { format: "json", missingConfig: true };
    await runDetect(options);

    const output = JSON.parse(stdoutOutput);
    expect(output.projects).toHaveLength(1);
    expect(output.projects[0].path).toBe("packages/b");
  });

  it("creates missing standards.toml files when --fix", async () => {
    mockedDetectProjects.mockResolvedValue(
      makeDetectionResult({
        projects: [
          { path: "packages/app", type: "typescript", hasCheckToml: false, markerFile: "package.json" },
        ],
      })
    );

    mockedCreateCheckToml.mockReturnValue(true);

    const options: DetectOptions = { format: "json", fix: true };
    await runDetect(options);

    expect(mockedCreateCheckToml).toHaveBeenCalledWith(
      expect.stringContaining("packages/app"),
      "typescript",
      false,
      undefined
    );

    const output = JSON.parse(stdoutOutput);
    expect(output.actions).toBeDefined();
    expect(output.actions[0].action).toBe("created");
  });

  it("reports would-create actions for --dry-run", async () => {
    mockedDetectProjects.mockResolvedValue(
      makeDetectionResult({
        projects: [
          { path: "packages/app", type: "typescript", hasCheckToml: false, markerFile: "package.json" },
        ],
      })
    );

    mockedCreateCheckToml.mockReturnValue(true);

    const options: DetectOptions = { format: "json", dryRun: true };
    await runDetect(options);

    expect(mockedCreateCheckToml).toHaveBeenCalledWith(
      expect.any(String),
      "typescript",
      true,
      undefined
    );

    const output = JSON.parse(stdoutOutput);
    expect(output.actions[0].action).toBe("would-create");
  });

  it("creates registry when --fix --registry is specified", async () => {
    mockedDetectProjects.mockResolvedValue(
      makeDetectionResult({
        projects: [
          { path: "packages/app", type: "typescript", hasCheckToml: false, markerFile: "package.json" },
        ],
      })
    );

    mockedGetProjectTypes.mockReturnValue(new Set(["typescript"]) as any);
    mockedCreateCheckToml.mockReturnValue(true);

    const options: DetectOptions = {
      format: "json",
      fix: true,
      registry: ".standards",
    };
    await runDetect(options);

    expect(mockedCreateRegistry).toHaveBeenCalledWith(
      expect.stringContaining(".standards"),
      expect.any(Set),
      false
    );
  });

  it("outputs 'No projects detected' text when empty", async () => {
    mockedDetectProjects.mockResolvedValue(makeDetectionResult());

    const options: DetectOptions = { format: "text" };
    await runDetect(options);

    expect(stdoutOutput).toContain("No projects detected");
  });

  it("handles all projects having config with --fix", async () => {
    mockedDetectProjects.mockResolvedValue(
      makeDetectionResult({
        projects: [
          { path: "packages/app", type: "typescript", hasCheckToml: true, markerFile: "package.json" },
        ],
      })
    );

    const options: DetectOptions = { format: "text", fix: true };
    await runDetect(options);

    // Should not create any files
    expect(mockedCreateCheckToml).not.toHaveBeenCalled();
    expect(stdoutOutput).toContain("All projects have standards.toml");
  });
});
