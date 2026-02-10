vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(),
  },
  readFileSync: vi.fn(),
}));

vi.mock("../../../../src/core/index.js", () => ({
  loadConfigAsync: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";

import { checkCommitCommand } from "../../../../src/process/commands/check-commit.js";
import { loadConfigAsync } from "../../../../src/core/index.js";

const mockedReadFileSync = vi.mocked(fs.readFileSync);
const mockedLoadConfigAsync = vi.mocked(loadConfigAsync);

beforeEach(() => {
  vi.clearAllMocks();

  // Suppress console output during tests
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("checkCommitCommand", () => {
  it("returns 1 when commit message file cannot be read", async () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(1);
  });

  it("returns 0 for auto-generated merge commits", async () => {
    mockedReadFileSync.mockReturnValue("Merge branch 'feature' into main");
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("returns 0 for auto-generated revert commits", async () => {
    mockedReadFileSync.mockReturnValue("Revert \"fix: something\"");
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("returns 0 for fixup commits", async () => {
    mockedReadFileSync.mockReturnValue("fixup! feat: original commit");
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("returns 0 for squash commits", async () => {
    mockedReadFileSync.mockReturnValue("squash! feat: original commit");
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("returns 0 for amend commits", async () => {
    mockedReadFileSync.mockReturnValue("amend! feat: original commit");
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("returns 0 when validation is not enabled", async () => {
    mockedReadFileSync.mockReturnValue("any random commit message");
    mockedLoadConfigAsync.mockResolvedValue({
      config: {},
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("returns 0 when commits config is disabled", async () => {
    mockedReadFileSync.mockReturnValue("any message");
    mockedLoadConfigAsync.mockResolvedValue({
      config: { process: { commits: { enabled: false } } },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("returns 0 for valid conventional commit", async () => {
    mockedReadFileSync.mockReturnValue("feat: add login page");
    mockedLoadConfigAsync.mockResolvedValue({
      config: {
        process: {
          commits: {
            enabled: true,
            types: ["feat", "fix", "chore"],
          },
        },
      },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("returns 1 for invalid conventional commit", async () => {
    mockedReadFileSync.mockReturnValue("bad commit message");
    mockedLoadConfigAsync.mockResolvedValue({
      config: {
        process: {
          commits: {
            enabled: true,
            types: ["feat", "fix", "chore"],
          },
        },
      },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(1);
  });

  it("validates commit with scoped type", async () => {
    mockedReadFileSync.mockReturnValue("fix(auth): resolve token expiry");
    mockedLoadConfigAsync.mockResolvedValue({
      config: {
        process: {
          commits: {
            enabled: true,
            types: ["feat", "fix"],
          },
        },
      },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("returns 1 when scope is required but missing", async () => {
    mockedReadFileSync.mockReturnValue("feat: add login page");
    mockedLoadConfigAsync.mockResolvedValue({
      config: {
        process: {
          commits: {
            enabled: true,
            types: ["feat", "fix"],
            require_scope: true,
          },
        },
      },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(1);
  });

  it("returns 0 when scope is required and present", async () => {
    mockedReadFileSync.mockReturnValue("feat(ui): add login page");
    mockedLoadConfigAsync.mockResolvedValue({
      config: {
        process: {
          commits: {
            enabled: true,
            types: ["feat", "fix"],
            require_scope: true,
          },
        },
      },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("validates subject length", async () => {
    mockedReadFileSync.mockReturnValue("feat: " + "x".repeat(100));
    mockedLoadConfigAsync.mockResolvedValue({
      config: {
        process: {
          commits: {
            enabled: true,
            types: ["feat"],
            max_subject_length: 50,
          },
        },
      },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(1);
  });

  it("validates custom pattern", async () => {
    mockedReadFileSync.mockReturnValue("[JIRA-123] fix the bug");
    mockedLoadConfigAsync.mockResolvedValue({
      config: {
        process: {
          commits: {
            enabled: true,
            pattern: "^\\[JIRA-\\d+\\]",
          },
        },
      },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("validates ticket reference when tickets config is enabled", async () => {
    mockedReadFileSync.mockReturnValue("feat: add login page");
    mockedLoadConfigAsync.mockResolvedValue({
      config: {
        process: {
          tickets: {
            enabled: true,
            require_in_commits: true,
            pattern: "JIRA-\\d+",
          },
          commits: { enabled: false },
        },
      },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(1);
  });

  it("passes when ticket reference is present", async () => {
    mockedReadFileSync.mockReturnValue("feat: add login page JIRA-123");
    mockedLoadConfigAsync.mockResolvedValue({
      config: {
        process: {
          tickets: {
            enabled: true,
            require_in_commits: true,
            pattern: "JIRA-\\d+",
          },
          commits: { enabled: false },
        },
      },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("passes config option to loadConfigAsync", async () => {
    mockedReadFileSync.mockReturnValue("any message");
    mockedLoadConfigAsync.mockResolvedValue({
      config: {},
      configPath: "/custom/standards.toml",
    } as never);
    await checkCommitCommand("/tmp/COMMIT_MSG", { config: "/custom/standards.toml" });
    expect(mockedLoadConfigAsync).toHaveBeenCalledWith("/custom/standards.toml");
  });

  it("uses only first line as subject for validation", async () => {
    mockedReadFileSync.mockReturnValue("feat: add login\n\nThis is the body with JIRA-123");
    mockedLoadConfigAsync.mockResolvedValue({
      config: {
        process: {
          commits: {
            enabled: true,
            types: ["feat"],
            max_subject_length: 50,
          },
        },
      },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });

  it("validates breaking change indicator with !", async () => {
    mockedReadFileSync.mockReturnValue("feat!: breaking change");
    mockedLoadConfigAsync.mockResolvedValue({
      config: {
        process: {
          commits: {
            enabled: true,
            types: ["feat", "fix"],
          },
        },
      },
      configPath: "/project/standards.toml",
    } as never);
    const result = await checkCommitCommand("/tmp/COMMIT_MSG", {});
    expect(result).toBe(0);
  });
});
