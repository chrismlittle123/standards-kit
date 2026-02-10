vi.mock("../../../../src/core/index.js", () => ({
  loadConfigAsync: vi.fn(),
  getProjectRoot: vi.fn(),
}));

vi.mock("../../../../src/process/tools/branches.js", () => ({
  BranchesRunner: vi.fn().mockImplementation(() => ({
    setConfig: vi.fn(),
    run: vi.fn(),
  })),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";

import { checkBranchCommand } from "../../../../src/process/commands/check-branch.js";
import { loadConfigAsync, getProjectRoot } from "../../../../src/core/index.js";
import { BranchesRunner } from "../../../../src/process/tools/branches.js";

const mockedLoadConfigAsync = vi.mocked(loadConfigAsync);
const mockedGetProjectRoot = vi.mocked(getProjectRoot);
const MockedBranchesRunner = vi.mocked(BranchesRunner);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetProjectRoot.mockReturnValue("/project");

  // Suppress console output during tests
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("checkBranchCommand", () => {
  it("returns 0 and logs disabled when branches config is not enabled", async () => {
    mockedLoadConfigAsync.mockResolvedValue({
      config: { process: { branches: { enabled: false } } },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkBranchCommand({});
    expect(result).toBe(0);
  });

  it("returns 0 when branches config is undefined", async () => {
    mockedLoadConfigAsync.mockResolvedValue({
      config: {},
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkBranchCommand({});
    expect(result).toBe(0);
  });

  it("returns 0 when process config is undefined", async () => {
    mockedLoadConfigAsync.mockResolvedValue({
      config: {},
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkBranchCommand({});
    expect(result).toBe(0);
  });

  it("returns 0 when branch validation passes", async () => {
    mockedLoadConfigAsync.mockResolvedValue({
      config: { process: { branches: { enabled: true, pattern: "^(feature|fix)/" } } },
      configPath: "/project/standards.toml",
    } as never);

    const mockRun = vi.fn().mockResolvedValue({
      name: "Branches",
      rule: "process.branches",
      passed: true,
      violations: [],
      skipped: false,
      duration: 10,
    });
    MockedBranchesRunner.mockImplementation(() => ({
      setConfig: vi.fn(),
      run: mockRun,
    }) as never);

    const result = await checkBranchCommand({});
    expect(result).toBe(0);
  });

  it("returns 1 when branch validation fails", async () => {
    mockedLoadConfigAsync.mockResolvedValue({
      config: { process: { branches: { enabled: true, pattern: "^(feature|fix)/" } } },
      configPath: "/project/standards.toml",
    } as never);

    const mockRun = vi.fn().mockResolvedValue({
      name: "Branches",
      rule: "process.branches",
      passed: false,
      violations: [
        {
          rule: "process.branches.pattern",
          tool: "branches",
          message: "Branch name does not match pattern",
          severity: "error",
        },
      ],
      skipped: false,
      duration: 10,
    });
    MockedBranchesRunner.mockImplementation(() => ({
      setConfig: vi.fn(),
      run: mockRun,
    }) as never);

    const result = await checkBranchCommand({});
    expect(result).toBe(1);
  });

  it("returns 0 when check is skipped", async () => {
    mockedLoadConfigAsync.mockResolvedValue({
      config: { process: { branches: { enabled: true } } },
      configPath: "/project/standards.toml",
    } as never);

    const mockRun = vi.fn().mockResolvedValue({
      name: "Branches",
      rule: "process.branches",
      passed: true,
      violations: [],
      skipped: true,
      skipReason: "Not on a branch",
      duration: 5,
    });
    MockedBranchesRunner.mockImplementation(() => ({
      setConfig: vi.fn(),
      run: mockRun,
    }) as never);

    const result = await checkBranchCommand({});
    expect(result).toBe(0);
  });

  it("passes config option to loadConfigAsync", async () => {
    mockedLoadConfigAsync.mockResolvedValue({
      config: {},
      configPath: "/custom/standards.toml",
    } as never);
    await checkBranchCommand({ config: "/custom/standards.toml" });
    expect(mockedLoadConfigAsync).toHaveBeenCalledWith("/custom/standards.toml");
  });

  it("creates BranchesRunner and sets config", async () => {
    const branchesConfig = { enabled: true, pattern: "^feat/" };
    mockedLoadConfigAsync.mockResolvedValue({
      config: { process: { branches: branchesConfig } },
      configPath: "/project/standards.toml",
    } as never);

    const mockSetConfig = vi.fn();
    const mockRun = vi.fn().mockResolvedValue({
      name: "Branches",
      rule: "process.branches",
      passed: true,
      violations: [],
      skipped: false,
      duration: 5,
    });
    MockedBranchesRunner.mockImplementation(() => ({
      setConfig: mockSetConfig,
      run: mockRun,
    }) as never);

    await checkBranchCommand({});
    expect(MockedBranchesRunner).toHaveBeenCalled();
    expect(mockSetConfig).toHaveBeenCalledWith(branchesConfig);
    expect(mockRun).toHaveBeenCalledWith("/project");
  });
});
