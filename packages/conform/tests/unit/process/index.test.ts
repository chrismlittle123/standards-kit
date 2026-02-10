vi.mock("../../../src/process/tools/index.js", () => {
  const mockRunner = (name: string, rule: string, toolId: string) => {
    const instance = {
      name,
      rule,
      toolId,
      configFiles: [],
      run: vi.fn(),
      audit: vi.fn(),
      setConfig: vi.fn(),
    };
    return vi.fn(() => instance);
  };

  return {
    HooksRunner: mockRunner("Hooks", "process.hooks", "hooks"),
    CiRunner: mockRunner("CI", "process.ci", "ci"),
    BranchesRunner: mockRunner("Branches", "process.branches", "branches"),
    CommitsRunner: mockRunner("Commits", "process.commits", "commits"),
    ChangesetsRunner: mockRunner("Changesets", "process.changesets", "changesets"),
    PrRunner: mockRunner("PR", "process.pr", "pr"),
    TicketsRunner: mockRunner("Tickets", "process.tickets", "tickets"),
    CoverageRunner: mockRunner("Coverage", "process.coverage", "coverage"),
    RepoRunner: mockRunner("Repo", "process.repo", "repo"),
    BackupsRunner: mockRunner("Backups", "process.backups", "backups"),
    CodeownersRunner: mockRunner("Codeowners", "process.codeowners", "codeowners"),
    DocsRunner: mockRunner("Docs", "process.docs", "docs"),
    ForbiddenFilesRunner: mockRunner("ForbiddenFiles", "process.forbidden_files", "forbidden-files"),
  };
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runProcessChecks, auditProcessConfig } from "../../../src/process/index.js";
import { HooksRunner, CiRunner } from "../../../src/process/tools/index.js";
import type { Config, CheckResult } from "../../../src/core/index.js";

const mocked = vi.mocked;

function passResult(name: string, rule: string): CheckResult {
  return { name, rule, passed: true, violations: [], skipped: false, duration: 10 };
}

function failResult(name: string, rule: string): CheckResult {
  return {
    name,
    rule,
    passed: false,
    violations: [{ rule, tool: name, message: "fail", severity: "error" }],
    skipped: false,
    duration: 10,
  };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    process: {
      hooks: { enabled: true },
    },
    ...overrides,
  } as Config;
}

beforeEach(() => vi.clearAllMocks());

describe("runProcessChecks", () => {
  it("runs enabled tools and returns domain result", async () => {
    mocked(HooksRunner).mockClear();
    const inst = new (HooksRunner as any)();
    inst.run.mockResolvedValue(passResult("Hooks", "process.hooks"));

    const config = makeConfig({
      process: { hooks: { enabled: true } },
    } as any);

    const result = await runProcessChecks("/project", config);
    expect(result.domain).toBe("process");
    expect(result.checks.length).toBeGreaterThanOrEqual(1);
  });

  it("returns skip status when no tools are enabled", async () => {
    const config = makeConfig({ process: {} } as any);
    const result = await runProcessChecks("/project", config);
    expect(result.domain).toBe("process");
    expect(result.status).toBe("skip");
    expect(result.checks).toHaveLength(0);
  });

  it("handles tool rejection with error result", async () => {
    mocked(HooksRunner).mockClear();
    const inst = new (HooksRunner as any)();
    inst.run.mockRejectedValue(new Error("tool crashed"));

    const config = makeConfig({
      process: { hooks: { enabled: true } },
    } as any);

    const result = await runProcessChecks("/project", config);
    const errorCheck = result.checks.find((c) => c.passed === false);
    expect(errorCheck).toBeDefined();
    expect(errorCheck!.violations[0].message).toContain("Tool error");
  });

  it("runs multiple enabled tools", async () => {
    mocked(HooksRunner).mockClear();
    mocked(CiRunner).mockClear();

    const hooksInst = new (HooksRunner as any)();
    hooksInst.run.mockResolvedValue(passResult("Hooks", "process.hooks"));

    const ciInst = new (CiRunner as any)();
    ciInst.run.mockResolvedValue(passResult("CI", "process.ci"));

    const config = makeConfig({
      process: {
        hooks: { enabled: true },
        ci: { enabled: true },
      },
    } as any);

    const result = await runProcessChecks("/project", config);
    expect(result.checks.length).toBe(2);
    expect(result.status).toBe("pass");
  });

  it("reports fail status when a tool has violations", async () => {
    mocked(HooksRunner).mockClear();
    const inst = new (HooksRunner as any)();
    inst.run.mockResolvedValue(failResult("Hooks", "process.hooks"));

    const config = makeConfig({
      process: { hooks: { enabled: true } },
    } as any);

    const result = await runProcessChecks("/project", config);
    expect(result.status).toBe("fail");
    expect(result.violationCount).toBeGreaterThan(0);
  });

  it("handles non-Error rejection", async () => {
    mocked(HooksRunner).mockClear();
    const inst = new (HooksRunner as any)();
    inst.run.mockRejectedValue("string error");

    const config = makeConfig({
      process: { hooks: { enabled: true } },
    } as any);

    const result = await runProcessChecks("/project", config);
    const errorCheck = result.checks.find((c) => c.passed === false);
    expect(errorCheck).toBeDefined();
    expect(errorCheck!.violations[0].message).toContain("Unknown error");
  });
});

describe("auditProcessConfig", () => {
  it("calls audit instead of run on tools", async () => {
    mocked(HooksRunner).mockClear();
    const inst = new (HooksRunner as any)();
    inst.audit.mockResolvedValue(passResult("Hooks", "process.hooks"));

    const config = makeConfig({
      process: { hooks: { enabled: true } },
    } as any);

    const result = await auditProcessConfig("/project", config);
    expect(result.domain).toBe("process");
    expect(inst.audit).toHaveBeenCalledWith("/project");
    expect(inst.run).not.toHaveBeenCalled();
  });

  it("returns skip when no tools are enabled", async () => {
    const config = makeConfig({ process: {} } as any);
    const result = await auditProcessConfig("/project", config);
    expect(result.status).toBe("skip");
  });
});
