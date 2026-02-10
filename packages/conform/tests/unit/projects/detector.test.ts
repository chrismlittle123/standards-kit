import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

vi.mock("glob", () => ({
  glob: vi.fn(),
}));

import * as fs from "node:fs";
import { glob } from "glob";

import { detectProjects, getProjectTypes } from "../../../src/projects/detector.js";
import type { DetectedProject } from "../../../src/projects/types.js";

const mockedFs = vi.mocked(fs);
const mockedGlob = vi.mocked(glob);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("detectProjects", () => {
  it("detects a TypeScript project from package.json", async () => {
    mockedGlob.mockImplementation(async (pattern: any) => {
      const p = String(pattern);
      if (p.includes("package.json")) {
        return ["packages/app/package.json"];
      }
      return [];
    });

    // package.json does not have workspaces, no workspace root markers, has standards.toml
    mockedFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("standards.toml")) return true;
      // No workspace root markers
      return false;
    });

    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ name: "app" }));

    const result = await detectProjects("/root");

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].path).toBe("packages/app");
    expect(result.projects[0].type).toBe("typescript");
    expect(result.projects[0].hasCheckToml).toBe(true);
    expect(result.projects[0].markerFile).toBe("package.json");
  });

  it("detects a Python project from pyproject.toml", async () => {
    mockedGlob.mockImplementation(async (pattern: any) => {
      const p = String(pattern);
      if (p.includes("pyproject.toml")) {
        return ["services/api/pyproject.toml"];
      }
      return [];
    });

    mockedFs.existsSync.mockReturnValue(false);

    const result = await detectProjects("/root");

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].type).toBe("python");
    expect(result.projects[0].hasCheckToml).toBe(false);
  });

  it("skips workspace roots (package.json with workspaces)", async () => {
    mockedGlob.mockImplementation(async (pattern: any) => {
      const p = String(pattern);
      if (p.includes("package.json")) {
        return ["package.json"];
      }
      return [];
    });

    // readFileSync returns package.json with workspaces
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ name: "root", workspaces: ["packages/*"] })
    );

    mockedFs.existsSync.mockReturnValue(false);

    const result = await detectProjects("/root");

    expect(result.projects).toHaveLength(0);
    expect(result.workspaceRoots).toContain(".");
  });

  it("skips workspace roots identified by workspace markers", async () => {
    mockedGlob.mockImplementation(async (pattern: any) => {
      const p = String(pattern);
      if (p.includes("package.json")) {
        return ["package.json"];
      }
      return [];
    });

    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ name: "root" }));

    // turbo.json exists = workspace root
    mockedFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("turbo.json");
    });

    const result = await detectProjects("/root");

    expect(result.projects).toHaveLength(0);
    expect(result.workspaceRoots).toContain(".");
  });

  it("detects multiple projects", async () => {
    mockedGlob.mockImplementation(async (pattern: any) => {
      const p = String(pattern);
      if (p.includes("package.json")) {
        return ["packages/a/package.json", "packages/b/package.json"];
      }
      if (p.includes("pyproject.toml")) {
        return ["services/api/pyproject.toml"];
      }
      return [];
    });

    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ name: "pkg" }));
    mockedFs.existsSync.mockReturnValue(false);

    const result = await detectProjects("/root");

    expect(result.projects).toHaveLength(3);
    // Should be sorted
    expect(result.projects[0].path).toBe("packages/a");
    expect(result.projects[1].path).toBe("packages/b");
    expect(result.projects[2].path).toBe("services/api");
  });

  it("avoids duplicate detection for same path", async () => {
    mockedGlob.mockImplementation(async (pattern: any) => {
      const p = String(pattern);
      if (p.includes("package.json")) {
        return ["packages/app/package.json"];
      }
      if (p.includes("pyproject.toml")) {
        // Same directory has both markers
        return ["packages/app/pyproject.toml"];
      }
      return [];
    });

    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ name: "app" }));
    mockedFs.existsSync.mockReturnValue(false);

    const result = await detectProjects("/root");

    // Should only detect once (typescript wins due to priority order)
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].type).toBe("typescript");
  });

  it("filters projects using excludePatterns", async () => {
    mockedGlob.mockImplementation(async (pattern: any) => {
      const p = String(pattern);
      if (p.includes("package.json")) {
        return [
          "packages/app/package.json",
          "packages/internal-tool/package.json",
        ];
      }
      return [];
    });

    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ name: "pkg" }));
    mockedFs.existsSync.mockReturnValue(false);

    const result = await detectProjects("/root", {
      excludePatterns: ["packages/internal-tool"],
    });

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].path).toBe("packages/app");
  });

  it("handles root-level project (path is '.')", async () => {
    mockedGlob.mockImplementation(async (pattern: any) => {
      const p = String(pattern);
      if (p.includes("pyproject.toml")) {
        return ["pyproject.toml"];
      }
      return [];
    });

    mockedFs.existsSync.mockReturnValue(false);

    const result = await detectProjects("/root");

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].path).toBe(".");
  });

  it("returns empty result when no markers found", async () => {
    mockedGlob.mockResolvedValue([]);
    mockedFs.existsSync.mockReturnValue(false);

    const result = await detectProjects("/root");

    expect(result.projects).toHaveLength(0);
    expect(result.workspaceRoots).toHaveLength(0);
  });

  it("handles readFileSync error gracefully for workspace detection", async () => {
    mockedGlob.mockImplementation(async (pattern: any) => {
      const p = String(pattern);
      if (p.includes("package.json")) {
        return ["packages/app/package.json"];
      }
      return [];
    });

    // readFileSync throws => isWorkspaceRoot returns false
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    mockedFs.existsSync.mockReturnValue(false);

    const result = await detectProjects("/root");

    // Should still detect as project since workspace check failed gracefully
    expect(result.projects).toHaveLength(1);
  });
});

describe("getProjectTypes", () => {
  it("returns types of projects without standards.toml", () => {
    const projects: DetectedProject[] = [
      { path: "a", type: "typescript", hasCheckToml: false, markerFile: "package.json" },
      { path: "b", type: "python", hasCheckToml: false, markerFile: "pyproject.toml" },
    ];

    const types = getProjectTypes(projects);

    expect(types).toEqual(new Set(["typescript", "python"]));
  });

  it("excludes projects that already have standards.toml", () => {
    const projects: DetectedProject[] = [
      { path: "a", type: "typescript", hasCheckToml: true, markerFile: "package.json" },
      { path: "b", type: "python", hasCheckToml: false, markerFile: "pyproject.toml" },
    ];

    const types = getProjectTypes(projects);

    expect(types).toEqual(new Set(["python"]));
  });

  it("returns empty set when all projects have standards.toml", () => {
    const projects: DetectedProject[] = [
      { path: "a", type: "typescript", hasCheckToml: true, markerFile: "package.json" },
    ];

    const types = getProjectTypes(projects);

    expect(types.size).toBe(0);
  });

  it("returns empty set for empty input", () => {
    const types = getProjectTypes([]);
    expect(types.size).toBe(0);
  });
});
