import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  detectDependencyChanges,
  getTrackedDependencyFiles,
} from "./dependency-changes.js";
import type { GetDependenciesResult } from "./dependencies.js";

describe("dependency-changes", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `drift-dep-changes-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function git(args: string): string {
    return execSync(`git ${args}`, {
      cwd: testDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  }

  function initGitRepo(): void {
    git("init");
    git("config user.email 'test@test.com'");
    git("config user.name 'Test User'");
  }

  function getHeadCommit(): string {
    return git("rev-parse HEAD");
  }

  /**
   * Create mock dependencies result for testing without calling cm
   */
  function createMockDependencies(
    overrides: Partial<GetDependenciesResult> = {}
  ): GetDependenciesResult {
    return {
      files: ["standards.toml", "eslint.config.js", "tsconfig.json"],
      byCheck: {
        eslint: ["eslint.config.js", ".eslintrc.js"],
        tsc: ["tsconfig.json", "tsconfig.*.json"],
      },
      alwaysTracked: ["standards.toml"],
      ...overrides,
    };
  }

  describe("detectDependencyChanges", () => {
    it("returns error for non-git directory", () => {
      const result = detectDependencyChanges(testDir, {
        dependencies: createMockDependencies(),
      });

      expect(result.hasChanges).toBe(false);
      expect(result.error).toBe("not a git repository");
    });

    it("detects added dependency file", () => {
      initGitRepo();

      // First commit without dependency files
      writeFileSync(join(testDir, "README.md"), "# Test");
      git("add README.md");
      git("commit -m 'Initial commit'");
      const baseCommit = getHeadCommit();

      // Second commit with eslint config
      writeFileSync(join(testDir, "eslint.config.js"), "export default {}");
      git("add eslint.config.js");
      git("commit -m 'Add eslint config'");

      const result = detectDependencyChanges(testDir, {
        baseCommit,
        dependencies: createMockDependencies(),
      });

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].file).toBe("eslint.config.js");
      expect(result.changes[0].status).toBe("added");
      expect(result.changes[0].checkType).toBe("eslint");
      expect(result.changes[0].alwaysTracked).toBe(false);
    });

    it("detects modified dependency file", () => {
      initGitRepo();

      // First commit with tsconfig
      writeFileSync(join(testDir, "tsconfig.json"), "{}");
      git("add tsconfig.json");
      git("commit -m 'Initial commit'");
      const baseCommit = getHeadCommit();

      // Second commit with modified tsconfig
      writeFileSync(join(testDir, "tsconfig.json"), '{"strict": true}');
      git("add tsconfig.json");
      git("commit -m 'Update tsconfig'");

      const result = detectDependencyChanges(testDir, {
        baseCommit,
        dependencies: createMockDependencies(),
      });

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].file).toBe("tsconfig.json");
      expect(result.changes[0].status).toBe("modified");
      expect(result.changes[0].checkType).toBe("tsc");
    });

    it("detects deleted dependency file", () => {
      initGitRepo();

      // First commit with standards.toml
      writeFileSync(join(testDir, "standards.toml"), "[code]");
      git("add standards.toml");
      git("commit -m 'Initial commit'");
      const baseCommit = getHeadCommit();

      // Second commit without standards.toml
      git("rm standards.toml");
      git("commit -m 'Remove standards.toml'");

      const result = detectDependencyChanges(testDir, {
        baseCommit,
        dependencies: createMockDependencies(),
      });

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].file).toBe("standards.toml");
      expect(result.changes[0].status).toBe("deleted");
      expect(result.changes[0].alwaysTracked).toBe(true);
    });

    it("ignores non-dependency files", () => {
      initGitRepo();

      writeFileSync(join(testDir, "README.md"), "# Test");
      git("add README.md");
      git("commit -m 'Initial commit'");
      const baseCommit = getHeadCommit();

      // Add a file that's not in dependencies
      writeFileSync(join(testDir, "random.js"), "console.log('hi')");
      git("add random.js");
      git("commit -m 'Add random file'");

      const result = detectDependencyChanges(testDir, {
        baseCommit,
        dependencies: createMockDependencies(),
      });

      expect(result.hasChanges).toBe(false);
      expect(result.changes).toHaveLength(0);
    });

    it("detects multiple changes and groups by check type", () => {
      initGitRepo();

      writeFileSync(join(testDir, "README.md"), "# Test");
      git("add README.md");
      git("commit -m 'Initial commit'");
      const baseCommit = getHeadCommit();

      // Add multiple dependency files
      writeFileSync(join(testDir, "eslint.config.js"), "export default {}");
      writeFileSync(join(testDir, "tsconfig.json"), "{}");
      writeFileSync(join(testDir, "standards.toml"), "[code]");
      git("add .");
      git("commit -m 'Add config files'");

      const result = detectDependencyChanges(testDir, {
        baseCommit,
        dependencies: createMockDependencies(),
      });

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toHaveLength(3);

      // Check grouping by check type
      expect(result.byCheck.eslint).toHaveLength(1);
      expect(result.byCheck.tsc).toHaveLength(1);

      // Check always tracked files
      expect(result.alwaysTrackedChanges).toHaveLength(1);
      expect(result.alwaysTrackedChanges[0].file).toBe("standards.toml");
    });

    it("handles glob patterns in dependency files", () => {
      initGitRepo();

      writeFileSync(join(testDir, "README.md"), "# Test");
      git("add README.md");
      git("commit -m 'Initial commit'");
      const baseCommit = getHeadCommit();

      // Add a file that matches glob pattern tsconfig.*.json
      writeFileSync(
        join(testDir, "tsconfig.build.json"),
        '{"extends": "./tsconfig.json"}'
      );
      git("add tsconfig.build.json");
      git("commit -m 'Add build tsconfig'");

      const result = detectDependencyChanges(testDir, {
        baseCommit,
        dependencies: createMockDependencies({
          files: ["tsconfig.*.json"],
          byCheck: { tsc: ["tsconfig.*.json"] },
        }),
      });

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].file).toBe("tsconfig.build.json");
      expect(result.changes[0].checkType).toBe("tsc");
    });

    it("handles workflow files with glob pattern", () => {
      initGitRepo();

      writeFileSync(join(testDir, "README.md"), "# Test");
      git("add README.md");
      git("commit -m 'Initial commit'");
      const baseCommit = getHeadCommit();

      // Add workflow file
      mkdirSync(join(testDir, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(testDir, ".github", "workflows", "ci.yml"),
        "name: CI"
      );
      git("add .");
      git("commit -m 'Add CI workflow'");

      const result = detectDependencyChanges(testDir, {
        baseCommit,
        dependencies: createMockDependencies({
          files: [".github/workflows/*.yml"],
          byCheck: {},
          alwaysTracked: [".github/workflows/*.yml"],
        }),
      });

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].file).toBe(".github/workflows/ci.yml");
      expect(result.changes[0].alwaysTracked).toBe(true);
    });

    it("returns totalTrackedFiles count", () => {
      initGitRepo();

      writeFileSync(join(testDir, "README.md"), "# Test");
      git("add README.md");
      git("commit -m 'Initial commit'");

      const deps = createMockDependencies({
        files: [
          "standards.toml",
          "eslint.config.js",
          "tsconfig.json",
          "prettier.config.js",
        ],
      });

      const result = detectDependencyChanges(testDir, {
        dependencies: deps,
      });

      expect(result.totalTrackedFiles).toBe(4);
    });

    it("returns error when dependencies have error", () => {
      initGitRepo();

      writeFileSync(join(testDir, "README.md"), "# Test");
      git("add README.md");
      git("commit -m 'Initial commit'");

      const result = detectDependencyChanges(testDir, {
        dependencies: {
          files: [],
          byCheck: {},
          alwaysTracked: [],
          error: "cm not installed",
        },
      });

      expect(result.hasChanges).toBe(false);
      expect(result.error).toBe("cm not installed");
    });

    it("uses HEAD~1 and HEAD as default commits", () => {
      initGitRepo();

      // First commit
      writeFileSync(join(testDir, "README.md"), "# Test");
      git("add README.md");
      git("commit -m 'Initial commit'");

      // Second commit with dependency
      writeFileSync(join(testDir, "standards.toml"), "[code]");
      git("add standards.toml");
      git("commit -m 'Add standards.toml'");

      // Call without specifying commits (should use HEAD~1 to HEAD)
      const result = detectDependencyChanges(testDir, {
        dependencies: createMockDependencies(),
      });

      expect(result.hasChanges).toBe(true);
      expect(result.changes[0].file).toBe("standards.toml");
    });

    it("handles .eslintrc.js alternative eslint config", () => {
      initGitRepo();

      writeFileSync(join(testDir, "README.md"), "# Test");
      git("add README.md");
      git("commit -m 'Initial commit'");
      const baseCommit = getHeadCommit();

      writeFileSync(join(testDir, ".eslintrc.js"), "module.exports = {}");
      git("add .eslintrc.js");
      git("commit -m 'Add eslintrc'");

      const result = detectDependencyChanges(testDir, {
        baseCommit,
        dependencies: createMockDependencies(),
      });

      expect(result.hasChanges).toBe(true);
      expect(result.changes[0].file).toBe(".eslintrc.js");
      expect(result.changes[0].checkType).toBe("eslint");
    });
  });

  describe("getTrackedDependencyFiles", () => {
    it("returns empty array when cm not installed or fails", () => {
      // This test depends on whether cm is installed
      // In a directory without standards.toml, it should return empty
      const files = getTrackedDependencyFiles(testDir);
      expect(files).toEqual([]);
    }, 10000);
  });

  describe("edge cases", () => {
    it("handles renamed files", () => {
      initGitRepo();

      writeFileSync(join(testDir, "old-config.js"), "export default {}");
      git("add old-config.js");
      git("commit -m 'Initial commit'");
      const baseCommit = getHeadCommit();

      // Rename file
      git("mv old-config.js eslint.config.js");
      git("commit -m 'Rename config'");

      const result = detectDependencyChanges(testDir, {
        baseCommit,
        dependencies: createMockDependencies(),
      });

      // Renamed file that matches dependency pattern should be detected as "added"
      expect(result.hasChanges).toBe(true);
      const eslintChange = result.changes.find(
        (c) => c.file === "eslint.config.js"
      );
      expect(eslintChange).toBeDefined();
      expect(eslintChange?.status).toBe("added");
    });

    it("handles empty repository gracefully", () => {
      initGitRepo();

      // No commits yet
      const result = detectDependencyChanges(testDir, {
        dependencies: createMockDependencies(),
      });

      // Should not throw, just return no changes
      expect(result.hasChanges).toBe(false);
    });

    it("handles nested dependency files", () => {
      initGitRepo();

      writeFileSync(join(testDir, "README.md"), "# Test");
      git("add README.md");
      git("commit -m 'Initial commit'");
      const baseCommit = getHeadCommit();

      // Add nested standards.toml (monorepo style)
      mkdirSync(join(testDir, "packages", "api"), { recursive: true });
      writeFileSync(join(testDir, "packages", "api", "standards.toml"), "[code]");
      git("add .");
      git("commit -m 'Add nested standards.toml'");

      const result = detectDependencyChanges(testDir, {
        baseCommit,
        dependencies: createMockDependencies({
          files: ["packages/api/standards.toml"],
          alwaysTracked: ["packages/api/standards.toml"],
        }),
      });

      expect(result.hasChanges).toBe(true);
      expect(result.changes[0].file).toBe("packages/api/standards.toml");
    });

    it("handles file with no check type", () => {
      initGitRepo();

      writeFileSync(join(testDir, "README.md"), "# Test");
      git("add README.md");
      git("commit -m 'Initial commit'");
      const baseCommit = getHeadCommit();

      writeFileSync(join(testDir, "custom.config"), "custom");
      git("add custom.config");
      git("commit -m 'Add custom config'");

      const result = detectDependencyChanges(testDir, {
        baseCommit,
        dependencies: createMockDependencies({
          files: ["custom.config"],
          byCheck: {}, // No check type mapping for this file
        }),
      });

      expect(result.hasChanges).toBe(true);
      expect(result.changes[0].file).toBe("custom.config");
      expect(result.changes[0].checkType).toBeNull();
    });
  });
});
