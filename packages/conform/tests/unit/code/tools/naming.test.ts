import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("glob", () => ({
  glob: vi.fn(),
}));

import { glob } from "glob";
import { NamingRunner } from "../../../../src/code/tools/naming.js";

const mockGlob = vi.mocked(glob);

describe("NamingRunner", () => {
  let runner: NamingRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new NamingRunner();
  });

  describe("run", () => {
    it("passes when no rules are configured", async () => {
      runner.setConfig({});

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("passes when all files follow naming conventions", async () => {
      runner.setConfig({
        rules: [
          {
            extensions: ["ts"],
            file_case: "kebab-case",
            folder_case: "kebab-case",
          },
        ],
      });

      mockGlob.mockResolvedValue(["src/my-file.ts", "src/utils/helper-utils.ts"]);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("reports violations for files not following naming conventions", async () => {
      runner.setConfig({
        rules: [
          {
            extensions: ["ts"],
            file_case: "kebab-case",
            folder_case: "kebab-case",
          },
        ],
      });

      mockGlob.mockResolvedValue(["src/MyFile.ts", "src/camelCase.ts"]);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
      expect(result.violations[0].code).toBe("file-case");
      expect(result.violations[0].message).toContain("should be kebab-case");
    });

    it("reports violations for folder names not matching convention", async () => {
      runner.setConfig({
        rules: [
          {
            extensions: ["ts"],
            file_case: "kebab-case",
            folder_case: "kebab-case",
          },
        ],
      });

      mockGlob.mockResolvedValue(["MyFolder/my-file.ts"]);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      const folderViolation = result.violations.find((v) => v.code === "folder-case");
      expect(folderViolation).toBeDefined();
      expect(folderViolation!.message).toContain("MyFolder");
    });

    it("supports snake_case validation", async () => {
      runner.setConfig({
        rules: [
          {
            extensions: ["py"],
            file_case: "snake_case",
            folder_case: "snake_case",
          },
        ],
      });

      mockGlob.mockResolvedValue(["my_module/my_file.py", "my_module/BadFile.py"]);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      const fileViolation = result.violations.find(
        (v) => v.code === "file-case" && v.message.includes("BadFile")
      );
      expect(fileViolation).toBeDefined();
    });

    it("supports PascalCase validation", async () => {
      runner.setConfig({
        rules: [
          {
            extensions: ["tsx"],
            file_case: "PascalCase",
            folder_case: "kebab-case",
          },
        ],
      });

      mockGlob.mockResolvedValue(["components/MyComponent.tsx"]);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
    });

    it("skips special files starting with underscore", async () => {
      runner.setConfig({
        rules: [
          {
            extensions: ["py"],
            file_case: "snake_case",
            folder_case: "snake_case",
          },
        ],
      });

      mockGlob.mockResolvedValue(["pkg/__init__.py"]);

      const result = await runner.run("/project");

      // __init__ starts with underscore so it should be skipped
      expect(result.passed).toBe(true);
    });

    it("returns error violation on glob errors", async () => {
      runner.setConfig({
        rules: [
          {
            extensions: ["ts"],
            file_case: "kebab-case",
            folder_case: "kebab-case",
          },
        ],
      });

      mockGlob.mockRejectedValue(new Error("Permission denied"));

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Naming validation error");
    });
  });
});
