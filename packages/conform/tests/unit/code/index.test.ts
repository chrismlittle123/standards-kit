vi.mock("../../../src/code/tools/index.js", () => {
  const mockRunner = (name: string, rule: string, toolId: string) => {
    const instance = {
      name,
      rule,
      toolId,
      configFiles: [],
      run: vi.fn(),
      audit: vi.fn(),
      setConfig: vi.fn(),
      setRequiredOptions: vi.fn(),
    };
    return vi.fn(() => instance);
  };

  return {
    BaseToolRunner: vi.fn(),
    ESLintRunner: mockRunner("ESLint", "code.linting", "eslint"),
    KnipRunner: mockRunner("Knip", "code.unused", "knip"),
    NamingRunner: mockRunner("Naming", "code.naming", "naming"),
    RuffRunner: mockRunner("Ruff", "code.linting", "ruff"),
    TscRunner: mockRunner("Tsc", "code.types", "tsc"),
    TyRunner: mockRunner("Ty", "code.types", "ty"),
    VultureRunner: mockRunner("Vulture", "code.unused", "vulture"),
    CoverageRunRunner: mockRunner("CoverageRun", "code.coverage_run", "coverage-run"),
    DisableCommentsRunner: mockRunner("DisableComments", "code.quality", "disable-comments"),
    PnpmAuditRunner: mockRunner("PnpmAudit", "code.security", "pnpmaudit"),
    PipAuditRunner: mockRunner("PipAudit", "code.security", "pipaudit"),
    GitleaksRunner: mockRunner("Gitleaks", "code.security", "gitleaks"),
  };
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCodeChecks, auditCodeConfig } from "../../../src/code/index.js";
import {
  ESLintRunner,
  RuffRunner,
} from "../../../src/code/tools/index.js";
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
    code: {
      linting: {
        eslint: { enabled: true },
      },
    },
    ...overrides,
  } as Config;
}

beforeEach(() => vi.clearAllMocks());

describe("runCodeChecks", () => {
  it("runs enabled tools and returns domain result", async () => {
    const _eslintInstance = mocked(ESLintRunner).mock.results[0]?.value
      ?? new (ESLintRunner as any)();
    // Clear to get a fresh instance
    mocked(ESLintRunner).mockClear();
    const freshInstance = new (ESLintRunner as any)();
    freshInstance.run.mockResolvedValue(passResult("ESLint", "code.linting"));

    const config = makeConfig({
      code: { linting: { eslint: { enabled: true } } },
    } as any);

    const result = await runCodeChecks("/project", config);
    expect(result.domain).toBe("code");
    expect(result.checks.length).toBeGreaterThanOrEqual(1);
  });

  it("returns skip status when no tools are enabled", async () => {
    const config = makeConfig({ code: {} } as any);
    const result = await runCodeChecks("/project", config);
    expect(result.domain).toBe("code");
    expect(result.status).toBe("skip");
    expect(result.checks).toHaveLength(0);
  });

  it("handles tool rejection with error result", async () => {
    mocked(ESLintRunner).mockClear();
    const instance = new (ESLintRunner as any)();
    instance.run.mockRejectedValue(new Error("tool crashed"));

    const config = makeConfig({
      code: { linting: { eslint: { enabled: true } } },
    } as any);

    const result = await runCodeChecks("/project", config);
    expect(result.domain).toBe("code");
    const errorCheck = result.checks.find((c) => c.passed === false);
    expect(errorCheck).toBeDefined();
    expect(errorCheck!.violations[0].message).toContain("Tool error");
  });

  it("runs multiple enabled tools in parallel", async () => {
    mocked(ESLintRunner).mockClear();
    mocked(RuffRunner).mockClear();

    const eslintInst = new (ESLintRunner as any)();
    eslintInst.run.mockResolvedValue(passResult("ESLint", "code.linting"));

    const ruffInst = new (RuffRunner as any)();
    ruffInst.run.mockResolvedValue(passResult("Ruff", "code.linting"));

    const config = makeConfig({
      code: {
        linting: {
          eslint: { enabled: true },
          ruff: { enabled: true },
        },
      },
    } as any);

    const result = await runCodeChecks("/project", config);
    expect(result.checks.length).toBe(2);
    expect(result.status).toBe("pass");
  });

  it("reports fail status when a tool has violations", async () => {
    mocked(ESLintRunner).mockClear();
    const inst = new (ESLintRunner as any)();
    inst.run.mockResolvedValue(failResult("ESLint", "code.linting"));

    const config = makeConfig({
      code: { linting: { eslint: { enabled: true } } },
    } as any);

    const result = await runCodeChecks("/project", config);
    expect(result.status).toBe("fail");
    expect(result.violationCount).toBeGreaterThan(0);
  });
});

describe("auditCodeConfig", () => {
  it("calls audit instead of run on tools", async () => {
    mocked(ESLintRunner).mockClear();
    const inst = new (ESLintRunner as any)();
    inst.audit.mockResolvedValue(passResult("ESLint", "code.linting"));

    const config = makeConfig({
      code: { linting: { eslint: { enabled: true } } },
    } as any);

    const result = await auditCodeConfig("/project", config);
    expect(result.domain).toBe("code");
    expect(inst.audit).toHaveBeenCalledWith("/project");
    expect(inst.run).not.toHaveBeenCalled();
  });

  it("returns skip when no tools are enabled", async () => {
    const config = makeConfig({ code: {} } as any);
    const result = await auditCodeConfig("/project", config);
    expect(result.status).toBe("skip");
  });
});
