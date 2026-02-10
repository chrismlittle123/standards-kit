vi.mock("execa");
vi.mock("node:fs");

import * as fs from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";

import { ChangesetsRunner } from "../../../../src/process/tools/changesets.js";

const mockedExeca = vi.mocked(execa);
const mockedFs = vi.mocked(fs);

beforeEach(() => vi.clearAllMocks());

/** Helper to set up filesystem mocks */
function setupFs(dirs: Set<string>, files: Map<string, string>): void {
  mockedFs.existsSync.mockImplementation((p) => {
    const s = String(p);
    return dirs.has(s) || files.has(s);
  });
  mockedFs.statSync.mockImplementation((p) => {
    const s = String(p);
    return {
      isDirectory: () => dirs.has(s),
      isFile: () => files.has(s),
    } as fs.Stats;
  });
  mockedFs.readFileSync.mockImplementation((p) => {
    const content = files.get(String(p));
    if (content === undefined) {
      throw new Error("ENOENT");
    }
    return content;
  });
  mockedFs.readdirSync.mockImplementation((p) => {
    const dir = String(p);
    const entries: string[] = [];
    for (const key of files.keys()) {
      if (key.startsWith(dir + "/")) {
        const relative = key.slice(dir.length + 1);
        if (!relative.includes("/")) {
          entries.push(relative);
        }
      }
    }
    return entries as unknown as fs.Dirent[];
  });
}

describe("ChangesetsRunner", () => {
  let runner: ChangesetsRunner;

  beforeEach(() => {
    runner = new ChangesetsRunner();
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("Changesets");
    expect(runner.rule).toBe("process.changesets");
    expect(runner.toolId).toBe("changesets");
  });

  describe("directory check", () => {
    it("fails when .changeset directory does not exist", async () => {
      runner.setConfig({ enabled: true });
      setupFs(new Set(), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].rule).toBe("process.changesets.directory");
      expect(result.violations[0].message).toContain("No .changeset directory found");
    });
  });

  describe("pass cases", () => {
    it("passes with valid changeset files", async () => {
      runner.setConfig({ enabled: true });
      const changesetContent = `---
"my-package": minor
---

Added new feature.
`;
      setupFs(
        new Set(["/root/.changeset"]),
        new Map([["/root/.changeset/cool-feature.md", changesetContent]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("passes when no changeset files and no require_for_paths", async () => {
      runner.setConfig({ enabled: true });
      setupFs(new Set(["/root/.changeset"]), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });

  describe("format validation", () => {
    it("fails when changeset has no frontmatter", async () => {
      runner.setConfig({ enabled: true, validate_format: true });
      setupFs(
        new Set(["/root/.changeset"]),
        new Map([["/root/.changeset/bad.md", "No frontmatter here"]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("format"))).toBe(true);
    });

    it("fails when frontmatter is malformed (missing closing delimiter)", async () => {
      runner.setConfig({ enabled: true, validate_format: true });
      const content = `---
"my-package": minor

Some description
`;
      setupFs(
        new Set(["/root/.changeset"]),
        new Map([["/root/.changeset/bad.md", content]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("closing '---'"))).toBe(true);
    });

    it("fails when changeset has no packages", async () => {
      runner.setConfig({ enabled: true, validate_format: true });
      const content = `---
---

Some description
`;
      setupFs(
        new Set(["/root/.changeset"]),
        new Map([["/root/.changeset/empty.md", content]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("no package entries"))).toBe(true);
    });
  });

  describe("bump type validation", () => {
    it("passes when bump types are allowed", async () => {
      runner.setConfig({
        enabled: true,
        allowed_bump_types: ["patch", "minor"],
      });
      const content = `---
"my-package": minor
---

Feature
`;
      setupFs(
        new Set(["/root/.changeset"]),
        new Map([["/root/.changeset/feat.md", content]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when bump type is not allowed", async () => {
      runner.setConfig({
        enabled: true,
        allowed_bump_types: ["patch", "minor"],
      });
      const content = `---
"my-package": major
---

Breaking change
`;
      setupFs(
        new Set(["/root/.changeset"]),
        new Map([["/root/.changeset/breaking.md", content]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("bump_type"))).toBe(true);
    });
  });

  describe("description validation", () => {
    it("fails when description is empty", async () => {
      runner.setConfig({ enabled: true, require_description: true });
      const content = `---
"my-package": patch
---
`;
      setupFs(
        new Set(["/root/.changeset"]),
        new Map([["/root/.changeset/empty-desc.md", content]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("no description"))).toBe(true);
    });

    it("fails when description is too short", async () => {
      runner.setConfig({
        enabled: true,
        require_description: true,
        min_description_length: 20,
      });
      const content = `---
"my-package": patch
---

Fix.
`;
      setupFs(
        new Set(["/root/.changeset"]),
        new Map([["/root/.changeset/short.md", content]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("characters, minimum is"))).toBe(
        true
      );
    });

    it("skips description validation when require_description is false", async () => {
      runner.setConfig({
        enabled: true,
        require_description: false,
      });
      const content = `---
"my-package": patch
---
`;
      setupFs(
        new Set(["/root/.changeset"]),
        new Map([["/root/.changeset/no-desc.md", content]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });

  describe("require_for_paths", () => {
    it("fails when changes require a changeset but none exist", async () => {
      runner.setConfig({
        enabled: true,
        require_for_paths: ["src/**"],
      });
      // Setup git to return changed files in src
      mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
        if (cmd === "git" && args[0] === "rev-parse") {
          return Promise.resolve({ stdout: "" });
        }
        if (cmd === "git" && args[0] === "diff") {
          return Promise.resolve({ stdout: "src/index.ts\nsrc/utils.ts" });
        }
        return Promise.reject(new Error("unexpected"));
      }) as typeof execa);
      setupFs(new Set(["/root/.changeset"]), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("required"))).toBe(true);
    });

    it("skips when cannot determine changed files", async () => {
      runner.setConfig({
        enabled: true,
        require_for_paths: ["src/**"],
      });
      // No base branch found
      mockedExeca.mockRejectedValue(new Error("no branch"));
      setupFs(new Set(["/root/.changeset"]), new Map());

      const result = await runner.run("/root");
      expect(result.skipped).toBe(true);
    });

    it("passes when changes are in excluded paths", async () => {
      runner.setConfig({
        enabled: true,
        require_for_paths: ["src/**"],
        exclude_paths: ["src/**/*.test.ts"],
      });
      mockedExeca.mockImplementation(((cmd: string, args: string[]) => {
        if (cmd === "git" && args[0] === "rev-parse") {
          return Promise.resolve({ stdout: "" });
        }
        if (cmd === "git" && args[0] === "diff") {
          return Promise.resolve({ stdout: "src/index.test.ts" });
        }
        return Promise.reject(new Error("unexpected"));
      }) as typeof execa);
      setupFs(new Set(["/root/.changeset"]), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });

  describe("README.md exclusion", () => {
    it("excludes README.md from changeset files", async () => {
      runner.setConfig({ enabled: true });
      setupFs(
        new Set(["/root/.changeset"]),
        new Map([["/root/.changeset/README.md", "# Changesets\nInfo about changesets"]])
      );

      const result = await runner.run("/root");
      // README.md is excluded, so no changeset files to validate
      expect(result.passed).toBe(true);
    });
  });
});
