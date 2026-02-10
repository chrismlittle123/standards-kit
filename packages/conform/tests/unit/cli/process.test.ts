vi.mock("../../../src/cli/utils.js", () => ({
  configureExitOverride: vi.fn((cmd) => cmd),
  handleError: vi.fn(),
  runCheck: vi.fn(),
  runAudit: vi.fn(),
}));

vi.mock("../../../src/process/commands/index.js", () => ({
  checkBranchCommand: vi.fn(),
  checkCommitCommand: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProcessCommand } from "../../../src/cli/process.js";
import { runCheck, runAudit, handleError } from "../../../src/cli/utils.js";
import { checkBranchCommand, checkCommitCommand } from "../../../src/process/commands/index.js";

const mocked = vi.mocked;

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

describe("createProcessCommand", () => {
  it("creates a command named process", () => {
    const cmd = createProcessCommand("1.0.0");
    expect(cmd.name()).toBe("process");
  });

  it("has check subcommand", () => {
    const cmd = createProcessCommand("1.0.0");
    const checkCmd = cmd.commands.find((c) => c.name() === "check");
    expect(checkCmd).toBeDefined();
  });

  it("has audit subcommand", () => {
    const cmd = createProcessCommand("1.0.0");
    const auditCmd = cmd.commands.find((c) => c.name() === "audit");
    expect(auditCmd).toBeDefined();
  });

  it("has diff subcommand", () => {
    const cmd = createProcessCommand("1.0.0");
    const diffCmd = cmd.commands.find((c) => c.name() === "diff");
    expect(diffCmd).toBeDefined();
  });

  it("has sync subcommand", () => {
    const cmd = createProcessCommand("1.0.0");
    const syncCmd = cmd.commands.find((c) => c.name() === "sync");
    expect(syncCmd).toBeDefined();
  });

  it("has diff-tags subcommand", () => {
    const cmd = createProcessCommand("1.0.0");
    const cmd2 = cmd.commands.find((c) => c.name() === "diff-tags");
    expect(cmd2).toBeDefined();
  });

  it("has sync-tags subcommand", () => {
    const cmd = createProcessCommand("1.0.0");
    const cmd2 = cmd.commands.find((c) => c.name() === "sync-tags");
    expect(cmd2).toBeDefined();
  });

  it("has check-branch subcommand", () => {
    const cmd = createProcessCommand("1.0.0");
    const cmd2 = cmd.commands.find((c) => c.name() === "check-branch");
    expect(cmd2).toBeDefined();
  });

  it("has check-commit subcommand", () => {
    const cmd = createProcessCommand("1.0.0");
    const cmd2 = cmd.commands.find((c) => c.name() === "check-commit");
    expect(cmd2).toBeDefined();
  });

  it("has scan subcommand", () => {
    const cmd = createProcessCommand("1.0.0");
    const cmd2 = cmd.commands.find((c) => c.name() === "scan");
    expect(cmd2).toBeDefined();
  });

  describe("check subcommand action", () => {
    it("calls runCheck with process domain filter", async () => {
      mocked(runCheck).mockResolvedValue(undefined);
      const cmd = createProcessCommand("2.0.0");
      await cmd.parseAsync(["check", "-f", "json"], { from: "user" });
      expect(runCheck).toHaveBeenCalledWith("2.0.0", expect.objectContaining({ format: "json" }), "process");
    });
  });

  describe("audit subcommand action", () => {
    it("calls runAudit with process domain filter", async () => {
      mocked(runAudit).mockResolvedValue(undefined);
      const cmd = createProcessCommand("2.0.0");
      await cmd.parseAsync(["audit", "-f", "json"], { from: "user" });
      expect(runAudit).toHaveBeenCalledWith("2.0.0", expect.objectContaining({ format: "json" }), "process");
    });
  });

  describe("check-branch subcommand action", () => {
    it("calls checkBranchCommand and exits with its return code", async () => {
      mocked(checkBranchCommand).mockResolvedValue(0);
      const cmd = createProcessCommand("1.0.0");
      await cmd.parseAsync(["check-branch"], { from: "user" });
      expect(checkBranchCommand).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("calls handleError when checkBranchCommand throws", async () => {
      mocked(checkBranchCommand).mockRejectedValue(new Error("branch fail"));
      const cmd = createProcessCommand("1.0.0");
      await cmd.parseAsync(["check-branch"], { from: "user" });
      expect(handleError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe("check-commit subcommand action", () => {
    it("calls checkCommitCommand with file arg and exits", async () => {
      mocked(checkCommitCommand).mockResolvedValue(0);
      const cmd = createProcessCommand("1.0.0");
      await cmd.parseAsync(["check-commit", ".git/COMMIT_EDITMSG"], { from: "user" });
      expect(checkCommitCommand).toHaveBeenCalledWith(".git/COMMIT_EDITMSG", expect.any(Object));
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("calls handleError when checkCommitCommand throws", async () => {
      mocked(checkCommitCommand).mockRejectedValue(new Error("commit fail"));
      const cmd = createProcessCommand("1.0.0");
      await cmd.parseAsync(["check-commit", ".git/COMMIT_EDITMSG"], { from: "user" });
      expect(handleError).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
