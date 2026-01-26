import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import {
  detectMissingProjects,
  detectAllProjects,
} from "./project-detection.js";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

describe("project-detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("detectMissingProjects", () => {
    it("returns empty array when cm command fails", () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("Command failed");
      });

      const result = detectMissingProjects("/path/to/repo");
      expect(result).toEqual([]);
    });

    it("returns empty array when no missing projects", () => {
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          projects: [],
          workspaceRoots: [],
          summary: { total: 0, withConfig: 0, missingConfig: 0 },
        })
      );

      const result = detectMissingProjects("/path/to/repo");
      expect(result).toEqual([]);
    });

    it("returns missing projects from cm output", () => {
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          projects: [
            {
              path: "packages/api",
              type: "typescript",
              status: "missing-config",
            },
            {
              path: "packages/web",
              type: "typescript",
              status: "missing-config",
            },
          ],
          workspaceRoots: [],
          summary: { total: 2, withConfig: 0, missingConfig: 2 },
        })
      );

      const result = detectMissingProjects("/path/to/repo");
      expect(result).toEqual([
        { path: "packages/api", type: "typescript" },
        { path: "packages/web", type: "typescript" },
      ]);
    });

    it("handles single project at root level", () => {
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          projects: [{ path: ".", type: "python", status: "missing-config" }],
          workspaceRoots: [],
          summary: { total: 1, withConfig: 0, missingConfig: 1 },
        })
      );

      const result = detectMissingProjects("/path/to/repo");
      expect(result).toEqual([{ path: ".", type: "python" }]);
    });

    it("passes correct options to execSync", () => {
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          projects: [],
          workspaceRoots: [],
          summary: { total: 0, withConfig: 0, missingConfig: 0 },
        })
      );

      detectMissingProjects("/path/to/repo");

      expect(mockExecSync).toHaveBeenCalledWith(
        "conform projects detect --format json --missing-config",
        {
          cwd: "/path/to/repo",
          encoding: "utf-8",
          timeout: 30000,
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
    });

    it("returns empty array on invalid JSON", () => {
      mockExecSync.mockReturnValueOnce("not valid json");

      const result = detectMissingProjects("/path/to/repo");
      expect(result).toEqual([]);
    });
  });

  describe("detectAllProjects", () => {
    it("returns null when cm command fails", () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("Command failed");
      });

      const result = detectAllProjects("/path/to/repo");
      expect(result).toBeNull();
    });

    it("returns full cm output", () => {
      const cmOutput = {
        projects: [
          { path: ".", type: "typescript", status: "has-config" },
          {
            path: "packages/api",
            type: "typescript",
            status: "missing-config",
          },
        ],
        workspaceRoots: ["packages"],
        summary: { total: 2, withConfig: 1, missingConfig: 1 },
      };
      mockExecSync.mockReturnValueOnce(JSON.stringify(cmOutput));

      const result = detectAllProjects("/path/to/repo");
      expect(result).toEqual(cmOutput);
    });

    it("passes correct options to execSync", () => {
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          projects: [],
          workspaceRoots: [],
          summary: { total: 0, withConfig: 0, missingConfig: 0 },
        })
      );

      detectAllProjects("/path/to/repo");

      expect(mockExecSync).toHaveBeenCalledWith(
        "conform projects detect --format json",
        {
          cwd: "/path/to/repo",
          encoding: "utf-8",
          timeout: 30000,
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
    });
  });
});
