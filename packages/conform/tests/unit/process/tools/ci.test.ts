vi.mock("node:fs");

import * as fs from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { CiRunner } from "../../../../src/process/tools/ci.js";

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
}

describe("CiRunner", () => {
  let runner: CiRunner;

  beforeEach(() => {
    runner = new CiRunner();
  });

  it("has correct metadata", () => {
    expect(runner.name).toBe("CI");
    expect(runner.rule).toBe("process.ci");
    expect(runner.toolId).toBe("ci");
  });

  describe("workflows directory", () => {
    it("fails when .github/workflows does not exist", async () => {
      runner.setConfig({ enabled: true });
      setupFs(new Set(), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("workflows directory not found");
    });

    it("passes when workflows directory exists with no further config", async () => {
      runner.setConfig({ enabled: true });
      setupFs(new Set(["/root/.github/workflows"]), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });
  });

  describe("require_workflows", () => {
    it("passes when all required workflows exist", async () => {
      runner.setConfig({
        enabled: true,
        require_workflows: ["ci.yml", "deploy.yml"],
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([
          ["/root/.github/workflows/ci.yml", "name: CI"],
          ["/root/.github/workflows/deploy.yml", "name: Deploy"],
        ])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when a required workflow is missing", async () => {
      runner.setConfig({
        enabled: true,
        require_workflows: ["ci.yml", "deploy.yml"],
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/ci.yml", "name: CI"]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("deploy.yml");
    });
  });

  describe("required jobs", () => {
    it("passes when required jobs are present", async () => {
      const workflow = `
name: CI
on: pull_request
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: echo lint
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo test
`;
      runner.setConfig({
        enabled: true,
        jobs: { "ci.yml": ["lint", "test"] },
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when required job is missing", async () => {
      const workflow = `
name: CI
on: pull_request
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: echo lint
`;
      runner.setConfig({
        enabled: true,
        jobs: { "ci.yml": ["lint", "test"] },
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("missing required job: test"))).toBe(
        true
      );
    });
  });

  describe("required actions", () => {
    it("passes when required actions are used", async () => {
      const workflow = `
name: CI
on: pull_request
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm test
`;
      runner.setConfig({
        enabled: true,
        actions: { "ci.yml": ["actions/checkout", "actions/setup-node"] },
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when required action is missing", async () => {
      const workflow = `
name: CI
on: pull_request
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`;
      runner.setConfig({
        enabled: true,
        actions: { "ci.yml": ["actions/checkout", "actions/setup-node"] },
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(
        result.violations.some((v) => v.message.includes("actions/setup-node"))
      ).toBe(true);
    });
  });

  describe("commands validation", () => {
    it("passes when workflow-level commands are found", async () => {
      const workflow = `
name: CI
on: pull_request
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm lint
      - run: pnpm test
`;
      runner.setConfig({
        enabled: true,
        commands: { "ci.yml": ["pnpm lint", "pnpm test"] },
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when required command not found", async () => {
      const workflow = `
name: CI
on: pull_request
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm lint
`;
      runner.setConfig({
        enabled: true,
        commands: { "ci.yml": ["pnpm lint", "pnpm test"] },
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("pnpm test"))).toBe(true);
    });

    it("reports warning when command is conditional", async () => {
      const workflow = `
name: CI
on: pull_request
jobs:
  build:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
`;
      runner.setConfig({
        enabled: true,
        commands: { "ci.yml": ["pnpm test"] },
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("may not execute"))).toBe(true);
    });

    it("reports when command is commented out", async () => {
      const workflow = `
name: CI
on: pull_request
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: |
          pnpm lint
          # pnpm test
`;
      runner.setConfig({
        enabled: true,
        commands: { "ci.yml": ["pnpm test"] },
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("commented out"))).toBe(true);
    });

    it("fails when workflow file not found for commands", async () => {
      runner.setConfig({
        enabled: true,
        commands: { "missing.yml": ["pnpm test"] },
      });
      setupFs(new Set(["/root/.github/workflows"]), new Map());

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("not found"))).toBe(true);
    });

    it("fails when workflow does not trigger on PR", async () => {
      const workflow = `
name: CI
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
`;
      runner.setConfig({
        enabled: true,
        commands: { "ci.yml": ["pnpm test"] },
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(
        result.violations.some((v) => v.message.includes("does not trigger on pull_request"))
      ).toBe(true);
    });

    it("validates job-level commands", async () => {
      const workflow = `
name: CI
on: pull_request
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm lint
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
`;
      runner.setConfig({
        enabled: true,
        commands: {
          "ci.yml": { lint: ["pnpm lint"], test: ["pnpm test"] },
        },
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(true);
    });

    it("fails when job not found for job-level commands", async () => {
      const workflow = `
name: CI
on: pull_request
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm lint
`;
      runner.setConfig({
        enabled: true,
        commands: { "ci.yml": { "missing-job": ["pnpm test"] } },
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/ci.yml", workflow]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("missing-job"))).toBe(true);
    });

    it("handles invalid YAML in workflow", async () => {
      runner.setConfig({
        enabled: true,
        commands: { "bad.yml": ["pnpm test"] },
      });
      setupFs(
        new Set(["/root/.github/workflows"]),
        new Map([["/root/.github/workflows/bad.yml", "::invalid yaml::\n  - ]["]])
      );

      const result = await runner.run("/root");
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule.includes("yaml"))).toBe(true);
    });
  });
});
