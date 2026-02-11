vi.mock("node:fs");

import * as fs from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { HooksRunner } from "../../../../src/process/tools/hooks.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => vi.clearAllMocks());

/** Helper to set up filesystem mocks for directories and files */
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
}

describe("HooksRunner", () => {
  let runner: HooksRunner;

  beforeEach(() => {
    runner = new HooksRunner();
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("Hooks");
    expect(runner.rule).toBe("process.hooks");
    expect(runner.toolId).toBe("hooks");
  });

  describe("husky check", () => {
    it("fails when .husky directory does not exist", async () => {
      runner.setConfig({ enabled: true });
      setupFs(new Set(), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("Husky not installed");
    });

    it("passes when .husky directory exists and no further config", async () => {
      runner.setConfig({ enabled: true });
      setupFs(new Set(["/root/.husky"]), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("skips husky check when require_husky is false", async () => {
      runner.setConfig({ enabled: true, require_husky: false });
      setupFs(new Set(), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });

  describe("require_hooks", () => {
    it("passes when required hooks exist", async () => {
      runner.setConfig({ enabled: true, require_hooks: ["pre-commit", "pre-push"] });
      setupFs(
        new Set(["/root/.husky"]),
        new Map([
          ["/root/.husky/pre-commit", "#!/bin/sh\nlint-staged"],
          ["/root/.husky/pre-push", "#!/bin/sh\nnpm test"],
        ])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when required hooks are missing", async () => {
      runner.setConfig({ enabled: true, require_hooks: ["pre-commit", "pre-push"] });
      setupFs(new Set(["/root/.husky"]), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].message).toContain("pre-commit");
      expect(result.violations[1].message).toContain("pre-push");
    });
  });

  describe("commands", () => {
    it("passes when hooks contain required commands", async () => {
      runner.setConfig({
        enabled: true,
        commands: { "pre-commit": ["lint-staged"] },
      });
      setupFs(
        new Set(["/root/.husky"]),
        new Map([["/root/.husky/pre-commit", "#!/bin/sh\npnpm exec lint-staged"]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when hook is missing required command", async () => {
      runner.setConfig({
        enabled: true,
        commands: { "pre-commit": ["lint-staged", "prettier"] },
      });
      setupFs(
        new Set(["/root/.husky"]),
        new Map([["/root/.husky/pre-commit", "#!/bin/sh\npnpm exec lint-staged"]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("prettier");
    });

    it("skips command check when hook file does not exist", async () => {
      runner.setConfig({
        enabled: true,
        commands: { "pre-commit": ["lint-staged"] },
      });
      setupFs(new Set(["/root/.husky"]), new Map());

      const result = await runner.run("/root");
      // No violations because the hook file doesn't exist to check
      expect(result.passed).toBe(true);
    });
  });

  describe("templates", () => {
    it("passes when hook content matches template exactly", async () => {
      const content = "#!/bin/sh\npnpm lint-staged";
      runner.setConfig({
        enabled: true,
        templates: { "pre-commit": content },
      });
      setupFs(
        new Set(["/root/.husky"]),
        new Map([["/root/.husky/pre-commit", content]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("passes when content matches after trimming whitespace", async () => {
      runner.setConfig({
        enabled: true,
        templates: { "pre-commit": "  #!/bin/sh\npnpm lint-staged\n  " },
      });
      setupFs(
        new Set(["/root/.husky"]),
        new Map([["/root/.husky/pre-commit", "#!/bin/sh\npnpm lint-staged"]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when hook content does not match template", async () => {
      runner.setConfig({
        enabled: true,
        templates: { "pre-commit": "#!/bin/sh\npnpm lint-staged" },
      });
      setupFs(
        new Set(["/root/.husky"]),
        new Map([["/root/.husky/pre-commit", "#!/bin/sh\nnpm test"]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].rule).toBe("process.hooks.pre-commit.template");
      expect(result.violations[0].message).toContain("does not match expected template");
    });

    it("skips gracefully when hook file does not exist", async () => {
      runner.setConfig({
        enabled: true,
        templates: { "pre-commit": "#!/bin/sh\npnpm lint-staged" },
      });
      setupFs(new Set(["/root/.husky"]), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });

  describe("protected_branches", () => {
    it("passes when pre-push hook checks protected branches", async () => {
      runner.setConfig({
        enabled: true,
        protected_branches: ["main"],
      });
      const hookContent = [
        "#!/bin/sh",
        'branch=$(git rev-parse --abbrev-ref HEAD)',
        'if [ "$branch" = "main" ]; then',
        '  echo "Cannot push to main"',
        "  exit 1",
        "fi",
      ].join("\n");
      setupFs(
        new Set(["/root/.husky"]),
        new Map([["/root/.husky/pre-push", hookContent]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when pre-push hook does not exist for protected branches", async () => {
      runner.setConfig({
        enabled: true,
        protected_branches: ["main"],
      });
      setupFs(new Set(["/root/.husky"]), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Pre-push hook not found");
    });

    it("fails when pre-push hook lacks branch detection", async () => {
      runner.setConfig({
        enabled: true,
        protected_branches: ["main"],
      });
      setupFs(
        new Set(["/root/.husky"]),
        new Map([["/root/.husky/pre-push", "#!/bin/sh\necho hello"]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("does not detect current branch");
    });

    it("fails when pre-push hook does not reference protected branch", async () => {
      runner.setConfig({
        enabled: true,
        protected_branches: ["main", "release"],
      });
      const hookContent = [
        "#!/bin/sh",
        'branch=$(git rev-parse --abbrev-ref HEAD)',
        'if [ "$branch" = "main" ]; then',
        "  exit 1",
        "fi",
      ].join("\n");
      setupFs(
        new Set(["/root/.husky"]),
        new Map([["/root/.husky/pre-push", hookContent]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("release");
    });

    it("passes with no protected branches configured", async () => {
      runner.setConfig({ enabled: true });
      setupFs(new Set(["/root/.husky"]), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });
});
