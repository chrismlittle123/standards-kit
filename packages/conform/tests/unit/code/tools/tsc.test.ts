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
  };
});

import { execa } from "execa";
import * as fs from "node:fs";
import { TscRunner } from "../../../../src/code/tools/tsc.js";

const mockExeca = vi.mocked(execa);
const mockExistsSync = vi.mocked(fs.existsSync);

describe("TscRunner", () => {
  let runner: TscRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new TscRunner();
  });

  describe("run", () => {
    it("returns failNoConfig when tsconfig.json does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("Config not found");
    });

    it("returns pass when tsc exits with code 0", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("tsconfig.json")
      );
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

    it("parses tsc error output into violations", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("tsconfig.json")
      );

      const tscOutput = [
        "/project/src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
        "/project/src/utils.ts(3,1): error TS7006: Parameter 'x' implicitly has an 'any' type.",
      ].join("\n");

      mockExeca.mockResolvedValue({
        stdout: tscOutput,
        stderr: "",
        exitCode: 2,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0].file).toBe("src/index.ts");
      expect(result.violations[0].line).toBe(10);
      expect(result.violations[0].column).toBe(5);
      expect(result.violations[0].code).toBe("TS2322");
      expect(result.violations[0].message).toContain("Type 'string' is not assignable");
      expect(result.violations[1].code).toBe("TS7006");
    });

    it("returns skip when tsc is not installed (ENOENT error)", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("tsconfig.json")
      );
      mockExeca.mockRejectedValue(new Error("spawn npx ENOENT"));

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("not installed");
    });

    it("returns skip when tsc output indicates it is not found", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("tsconfig.json")
      );
      mockExeca.mockResolvedValue({
        stdout: "This is not the tsc command you are looking for",
        stderr: "",
        exitCode: 1,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.skipped).toBe(true);
    });

    it("returns error violation on unexpected thrown errors", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("tsconfig.json")
      );
      mockExeca.mockRejectedValue(new Error("something unexpected"));

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("TypeScript error");
      expect(result.violations[0].message).toContain("something unexpected");
    });

    it("returns error violation when exit code is non-zero with stderr output", async () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("tsconfig.json")
      );
      mockExeca.mockResolvedValue({
        stdout: "",
        stderr: "Cannot find tsconfig.json",
        exitCode: 1,
        failed: true,
      } as any);

      const result = await runner.run("/project");

      expect(result.passed).toBe(false);
      expect(result.violations[0].message).toContain("TypeScript error");
    });
  });
});
