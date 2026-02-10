vi.mock("glob");

import { describe, it, expect, vi, beforeEach } from "vitest";
import { glob } from "glob";

import { ForbiddenFilesRunner } from "../../../../src/process/tools/forbidden-files.js";

const mockedGlob = vi.mocked(glob);

beforeEach(() => vi.clearAllMocks());

describe("ForbiddenFilesRunner", () => {
  let runner: ForbiddenFilesRunner;

  beforeEach(() => {
    runner = new ForbiddenFilesRunner();
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("Forbidden Files");
    expect(runner.rule).toBe("process.forbidden_files");
    expect(runner.toolId).toBe("forbidden-files");
  });

  describe("pass cases", () => {
    it("passes when no files patterns configured", async () => {
      runner.setConfig({ enabled: true });
      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("passes when no forbidden files are found", async () => {
      runner.setConfig({ enabled: true, files: ["**/.env", "**/*.bak"] });
      mockedGlob.mockResolvedValue([] as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });

  describe("failure cases", () => {
    it("fails when forbidden files are found", async () => {
      runner.setConfig({ enabled: true, files: ["**/.env"] });
      mockedGlob.mockResolvedValue([".env", "src/.env"] as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].rule).toBe("process.forbidden_files.exists");
      expect(result.violations[0].message).toContain(".env");
    });

    it("deduplicates violations by file path", async () => {
      runner.setConfig({ enabled: true, files: ["**/.env", ".env"] });
      // Both patterns match the same file
      mockedGlob
        .mockResolvedValueOnce([".env"] as never)
        .mockResolvedValueOnce([".env"] as never);

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      // Should be deduplicated to 1
      expect(result.violations).toHaveLength(1);
    });

    it("includes custom message when configured", async () => {
      runner.setConfig({
        enabled: true,
        files: ["**/.env"],
        message: "Use .env.example instead",
      });
      mockedGlob.mockResolvedValue([".env"] as never);

      const result = await runner.run("/root");
      expect(result.violations[0].message).toContain("Use .env.example instead");
    });
  });

  describe("ignore patterns", () => {
    it("uses default ignore patterns when none specified", async () => {
      runner.setConfig({ enabled: true, files: ["**/*.log"] });
      mockedGlob.mockResolvedValue([] as never);

      await runner.run("/root");

      expect(mockedGlob).toHaveBeenCalledWith(
        "**/*.log",
        expect.objectContaining({
          ignore: ["**/node_modules/**", "**/.git/**"],
        })
      );
    });

    it("uses custom ignore patterns when specified", async () => {
      runner.setConfig({ enabled: true, files: ["**/*.log"], ignore: ["dist/**"] });
      mockedGlob.mockResolvedValue([] as never);

      await runner.run("/root");

      expect(mockedGlob).toHaveBeenCalledWith(
        "**/*.log",
        expect.objectContaining({
          ignore: ["dist/**"],
        })
      );
    });

    it("uses empty array when explicitly set to empty", async () => {
      runner.setConfig({ enabled: true, files: ["**/*.log"], ignore: [] });
      mockedGlob.mockResolvedValue([] as never);

      await runner.run("/root");

      expect(mockedGlob).toHaveBeenCalledWith(
        "**/*.log",
        expect.objectContaining({
          ignore: [],
        })
      );
    });
  });

  describe("error handling", () => {
    it("returns empty array when glob throws", async () => {
      runner.setConfig({ enabled: true, files: ["**/.env"] });
      mockedGlob.mockRejectedValue(new Error("glob error"));

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });
});
