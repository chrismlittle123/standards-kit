import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    lstatSync: vi.fn(),
  };
});

import { execa } from "execa";
import * as fs from "node:fs";
import { TyRunner } from "../../../../src/code/tools/ty.js";

const mockExeca = vi.mocked(execa);
const mockExistsSync = vi.mocked(fs.existsSync);

describe("TyRunner", () => {
  let runner: TyRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new TyRunner();
  });

  describe("run", () => {
    it("returns pass when ty finds no errors (exit 0)", async () => {
      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("parses ty concise output into violations (exit 1)", async () => {
      const tyOutput = [
        "test.py:4:15: error[invalid-assignment] Object of type `int` is not assignable to `str`",
        "utils.py:10:1: warning[possibly-unbound] Name `foo` used when possibly unbound",
      ].join("\n");

      mockExeca.mockResolvedValue({
        stdout: tyOutput,
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].file).toBe("test.py");
      expect(result.violations[0].line).toBe(4);
      expect(result.violations[0].column).toBe(15);
      expect(result.violations[0].code).toBe("invalid-assignment");
      expect(result.violations[0].severity).toBe("error");
      expect(result.violations[0].message).toContain("Object of type `int`");
      expect(result.violations[1].severity).toBe("warning");
      expect(result.violations[1].code).toBe("possibly-unbound");
    });

    it("returns error on exit code 2 (configuration error)", async () => {
      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "Invalid configuration in ty.toml",
        exitCode: 2,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("ty configuration error");
    });

    it("returns skip when uvx/ty binary is not found (ENOENT)", async () => {
      mockExeca.mockRejectedValue(new Error("spawn uvx ENOENT"));

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("not installed");
    });

    it("returns skip when binary not found via result code", async () => {
      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 127,
        failed: true,
        code: "ENOENT",
      } as any);

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
    });

    it("returns error when exit code 1 but no diagnostics parsed", async () => {
      mockExeca.mockResolvedValue({
        stdout: "some unparseable output",
        stderr: "",
        exitCode: 1,
        failed: false,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("ty error");
    });

    it("handles unexpected exit codes with output parsing", async () => {
      const tyOutput =
        "test.py:1:1: error[invalid-syntax] Unexpected token";

      mockExeca.mockResolvedValue({
        stdout: tyOutput,
        stderr: "",
        exitCode: 3,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
    });

    it("returns error violation on unexpected thrown errors", async () => {
      mockExeca.mockRejectedValue(new Error("timeout exceeded"));

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("ty error");
      expect(result.violations[0].message).toContain("timeout exceeded");
    });
  });

  describe("audit", () => {
    it("passes when ty.toml exists", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("ty.toml")
      );

      const result = await runner.audit("/project");

      expect(result.passed).toBe(true);
    });

    it("passes when pyproject.toml has [tool.ty]", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pyproject.toml")
      );

      vi.mocked(fs.readFileSync).mockReturnValue("[tool.ty]\n");

      const result = await runner.audit("/project");

      expect(result.passed).toBe(true);
    });

    it("fails when no ty config found", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await runner.audit("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("ty config not found");
    });
  });
});
