vi.mock("../../../src/code/index.js", () => ({
  runCodeChecks: vi.fn(),
  auditCodeConfig: vi.fn(),
}));

vi.mock("../../../src/process/index.js", () => ({
  runProcessChecks: vi.fn(),
  auditProcessConfig: vi.fn(),
}));

vi.mock("../../../src/core/index.js", () => ({
  ConfigError: class ConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ConfigError";
    }
  },
  getProjectRoot: vi.fn().mockReturnValue("/project"),
  loadConfigAsync: vi.fn(),
  ExitCode: { SUCCESS: 0, VIOLATIONS_FOUND: 1, CONFIG_ERROR: 2, RUNTIME_ERROR: 3 },
}));

vi.mock("../../../src/output/index.js", () => ({
  formatOutput: vi.fn().mockReturnValue("formatted"),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { configureExitOverride, handleError, runCheck, runAudit } from "../../../src/cli/utils.js";
import { runCodeChecks, auditCodeConfig } from "../../../src/code/index.js";
import { runProcessChecks, auditProcessConfig } from "../../../src/process/index.js";
import { ConfigError, loadConfigAsync } from "../../../src/core/index.js";
import { formatOutput } from "../../../src/output/index.js";
import type { DomainResult } from "../../../src/core/index.js";

const mocked = vi.mocked;

let exitSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

function makeDomainResult(overrides: Partial<DomainResult> = {}): DomainResult {
  return {
    domain: "code",
    status: "pass",
    checks: [],
    violationCount: 0,
    ...overrides,
  };
}

describe("configureExitOverride", () => {
  it("returns the command with exitOverride configured", () => {
    const cmd = new Command("test");
    const result = configureExitOverride(cmd);
    expect(result).toBe(cmd);
  });
});

describe("handleError", () => {
  it("exits with CONFIG_ERROR for ConfigError", () => {
    handleError(new ConfigError("bad config"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("bad config"));
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("exits with RUNTIME_ERROR for generic Error", () => {
    handleError(new Error("runtime fail"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("runtime fail"));
    expect(exitSpy).toHaveBeenCalledWith(3);
  });

  it("exits with RUNTIME_ERROR for unknown error types", () => {
    handleError("string error");
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown error"));
    expect(exitSpy).toHaveBeenCalledWith(3);
  });
});

describe("runCheck", () => {
  it("runs both code and process checks when no domain filter", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: {} as any,
      configPath: "/project/standards.toml",
    });
    mocked(runCodeChecks).mockResolvedValue(makeDomainResult({ domain: "code" }));
    mocked(runProcessChecks).mockResolvedValue(makeDomainResult({ domain: "process" }));

    await runCheck("1.0.0", { format: "text" });

    expect(runCodeChecks).toHaveBeenCalled();
    expect(runProcessChecks).toHaveBeenCalled();
    expect(formatOutput).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("only runs code checks when domain filter is code", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: {} as any,
      configPath: "/project/standards.toml",
    });
    mocked(runCodeChecks).mockResolvedValue(makeDomainResult({ domain: "code" }));

    await runCheck("1.0.0", { format: "text" }, "code");

    expect(runCodeChecks).toHaveBeenCalled();
    expect(runProcessChecks).not.toHaveBeenCalled();
  });

  it("only runs process checks when domain filter is process", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: {} as any,
      configPath: "/project/standards.toml",
    });
    mocked(runProcessChecks).mockResolvedValue(makeDomainResult({ domain: "process" }));

    await runCheck("1.0.0", { format: "text" }, "process");

    expect(runProcessChecks).toHaveBeenCalled();
    expect(runCodeChecks).not.toHaveBeenCalled();
  });

  it("exits with VIOLATIONS_FOUND when violations exist", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: {} as any,
      configPath: "/project/standards.toml",
    });
    mocked(runCodeChecks).mockResolvedValue(
      makeDomainResult({ domain: "code", violationCount: 3 })
    );
    mocked(runProcessChecks).mockResolvedValue(makeDomainResult({ domain: "process" }));

    await runCheck("1.0.0", { format: "text" });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("passes config path option to loadConfigAsync", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: {} as any,
      configPath: "/custom/standards.toml",
    });
    mocked(runCodeChecks).mockResolvedValue(makeDomainResult());
    mocked(runProcessChecks).mockResolvedValue(makeDomainResult());

    await runCheck("1.0.0", { config: "/custom/standards.toml", format: "json" });

    expect(loadConfigAsync).toHaveBeenCalledWith("/custom/standards.toml");
  });

  it("handles errors by calling handleError", async () => {
    mocked(loadConfigAsync).mockRejectedValue(new Error("load failed"));

    await runCheck("1.0.0", { format: "text" });

    expect(exitSpy).toHaveBeenCalledWith(3);
  });

  it("writes formatted output to stdout", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: {} as any,
      configPath: "/p/standards.toml",
    });
    mocked(runCodeChecks).mockResolvedValue(makeDomainResult());
    mocked(runProcessChecks).mockResolvedValue(makeDomainResult());
    mocked(formatOutput).mockReturnValue("the output");

    await runCheck("1.0.0", { format: "text" });

    expect(stdoutSpy).toHaveBeenCalledWith("the output\n");
  });
});

describe("runAudit", () => {
  it("calls audit functions instead of check functions", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: {} as any,
      configPath: "/project/standards.toml",
    });
    mocked(auditCodeConfig).mockResolvedValue(makeDomainResult({ domain: "code" }));
    mocked(auditProcessConfig).mockResolvedValue(makeDomainResult({ domain: "process" }));

    await runAudit("1.0.0", { format: "text" });

    expect(auditCodeConfig).toHaveBeenCalled();
    expect(auditProcessConfig).toHaveBeenCalled();
    expect(runCodeChecks).not.toHaveBeenCalled();
    expect(runProcessChecks).not.toHaveBeenCalled();
  });

  it("only runs code audit when domain filter is code", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: {} as any,
      configPath: "/project/standards.toml",
    });
    mocked(auditCodeConfig).mockResolvedValue(makeDomainResult({ domain: "code" }));

    await runAudit("1.0.0", { format: "text" }, "code");

    expect(auditCodeConfig).toHaveBeenCalled();
    expect(auditProcessConfig).not.toHaveBeenCalled();
  });

  it("only runs process audit when domain filter is process", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: {} as any,
      configPath: "/project/standards.toml",
    });
    mocked(auditProcessConfig).mockResolvedValue(makeDomainResult({ domain: "process" }));

    await runAudit("1.0.0", { format: "text" }, "process");

    expect(auditProcessConfig).toHaveBeenCalled();
    expect(auditCodeConfig).not.toHaveBeenCalled();
  });

  it("exits with VIOLATIONS_FOUND when violations exist", async () => {
    mocked(loadConfigAsync).mockResolvedValue({
      config: {} as any,
      configPath: "/project/standards.toml",
    });
    mocked(auditCodeConfig).mockResolvedValue(
      makeDomainResult({ violationCount: 2 })
    );
    mocked(auditProcessConfig).mockResolvedValue(makeDomainResult());

    await runAudit("1.0.0", { format: "text" });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("handles errors during audit", async () => {
    mocked(loadConfigAsync).mockRejectedValue(new Error("audit failed"));

    await runAudit("1.0.0", { format: "text" });

    expect(exitSpy).toHaveBeenCalledWith(3);
  });
});
