vi.mock("node:fs");

import * as fs from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { CoverageRunner } from "../../../../src/process/tools/coverage.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => vi.clearAllMocks());

/** Helper to set up filesystem mocks */
function setupFs(files: Map<string, string>): void {
  mockedFs.existsSync.mockImplementation((p) => files.has(String(p)));
  mockedFs.statSync.mockImplementation((p) => ({
    isDirectory: () => false,
    isFile: () => files.has(String(p)),
  }) as fs.Stats);
  mockedFs.readFileSync.mockImplementation((p) => {
    const content = files.get(String(p));
    if (content === undefined) {
      throw new Error("ENOENT");
    }
    return content;
  });
}

describe("CoverageRunner", () => {
  let runner: CoverageRunner;

  beforeEach(() => {
    runner = new CoverageRunner();
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("Coverage");
    expect(runner.rule).toBe("process.coverage");
    expect(runner.toolId).toBe("coverage");
  });

  describe("config enforcement", () => {
    it("passes when vitest config has coverage thresholds", async () => {
      runner.setConfig({ enabled: true, enforce_in: "config" });
      const vitestConfig = `
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        lines: 80,
      },
    },
  },
});
`;
      setupFs(new Map([["/root/vitest.config.ts", vitestConfig]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("passes when jest config has coverageThreshold", async () => {
      runner.setConfig({ enabled: true, enforce_in: "config" });
      const jestConfig = `
module.exports = {
  coverageThreshold: {
    global: {
      lines: 80,
    },
  },
};
`;
      setupFs(new Map([["/root/jest.config.js", jestConfig]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("passes when jest config is in package.json", async () => {
      runner.setConfig({ enabled: true, enforce_in: "config" });
      const pkg = JSON.stringify({
        jest: {
          coverageThreshold: {
            global: { lines: 80 },
          },
        },
      });
      setupFs(new Map([["/root/package.json", pkg]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("passes when nyc config has check-coverage", async () => {
      runner.setConfig({ enabled: true, enforce_in: "config" });
      const nycrc = JSON.stringify({ "check-coverage": true, lines: 80 });
      setupFs(new Map([["/root/.nycrc", nycrc]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when no coverage config found", async () => {
      runner.setConfig({ enabled: true, enforce_in: "config" });
      setupFs(new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("config"))).toBe(true);
    });

    it("passes when min_threshold is set in standards config (no tool config needed)", async () => {
      runner.setConfig({ enabled: true, enforce_in: "config", min_threshold: 80 });
      setupFs(new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when tool config threshold is below min_threshold", async () => {
      runner.setConfig({ enabled: true, enforce_in: "config", min_threshold: 90 });
      const vitestConfig = `
export default {
  test: {
    coverage: {
      thresholds: {
        lines: 70,
      },
    },
  },
};
`;
      setupFs(new Map([["/root/vitest.config.ts", vitestConfig]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("threshold"))).toBe(true);
    });
  });

  describe("CI enforcement", () => {
    it("passes when CI workflow has coverage enforcement", async () => {
      runner.setConfig({ enabled: true, enforce_in: "ci" });
      const workflow = `
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:coverage
`;
      setupFs(
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when CI workflow lacks coverage enforcement", async () => {
      runner.setConfig({ enabled: true, enforce_in: "ci" });
      const workflow = `
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
`;
      setupFs(
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("ci"))).toBe(true);
    });

    it("fails when CI workflow file not found", async () => {
      runner.setConfig({ enabled: true, enforce_in: "ci" });
      setupFs(new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("Workflow file not found"))).toBe(
        true
      );
    });

    it("uses custom ci_workflow and ci_job", async () => {
      runner.setConfig({
        enabled: true,
        enforce_in: "ci",
        ci_workflow: "test.yml",
        ci_job: "coverage",
      });
      const workflow = `
name: Test
on: push
jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm coverage:check
`;
      setupFs(
        new Map([["/root/.github/workflows/test.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });

  describe("both enforcement", () => {
    it("checks both config and CI", async () => {
      runner.setConfig({ enabled: true, enforce_in: "both", min_threshold: 80 });
      // No config, no workflow
      setupFs(new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      // Should have violations from both config and CI checks
      expect(result.violations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("nyc config files", () => {
    it("parses YAML nyc config", async () => {
      runner.setConfig({ enabled: true, enforce_in: "config" });
      const nycYaml = "check-coverage: true\nlines: 80";
      setupFs(new Map([["/root/.nycrc.yml", nycYaml]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("checks nyc config in package.json", async () => {
      runner.setConfig({ enabled: true, enforce_in: "config" });
      const pkg = JSON.stringify({
        nyc: { "check-coverage": true, lines: 75 },
      });
      setupFs(new Map([["/root/package.json", pkg]]));

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });
});
