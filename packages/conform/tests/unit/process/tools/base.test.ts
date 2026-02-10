vi.mock("node:fs");

import * as fs from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { type CheckResult } from "../../../../src/core/index.js";
import { BaseProcessToolRunner } from "../../../../src/process/tools/base.js";

const mockedFs = vi.mocked(fs);

/** Concrete subclass for testing the abstract base class */
class TestRunner extends BaseProcessToolRunner {
  readonly name = "TestTool";
  readonly rule = "process.test";
  readonly toolId = "test";

  async run(_projectRoot: string): Promise<CheckResult> {
    return this.pass(0);
  }

  // Expose protected methods for testing
  public testDirectoryExists(projectRoot: string, dirPath: string): boolean {
    return this.directoryExists(projectRoot, dirPath);
  }

  public testFileExists(projectRoot: string, filePath: string): boolean {
    return this.fileExists(projectRoot, filePath);
  }

  public testReadFile(projectRoot: string, filePath: string): string | null {
    return this.readFile(projectRoot, filePath);
  }

  public testFileContains(projectRoot: string, filePath: string, pattern: string): boolean {
    return this.fileContains(projectRoot, filePath, pattern);
  }

  public testPass(duration: number): CheckResult {
    return this.pass(duration);
  }

  public testFail(violations: { rule: string; tool: string; message: string; severity: "error" }[], duration: number): CheckResult {
    return this.fail(violations, duration);
  }

  public testFromViolations(violations: { rule: string; tool: string; message: string; severity: "error" }[], duration: number): CheckResult {
    return this.fromViolations(violations, duration);
  }

  public testSkip(reason: string, duration: number): CheckResult {
    return this.skip(reason, duration);
  }
}

beforeEach(() => vi.clearAllMocks());

describe("BaseProcessToolRunner", () => {
  let runner: TestRunner;

  beforeEach(() => {
    runner = new TestRunner();
  });

  describe("configFiles", () => {
    it("returns an empty array", () => {
      expect(runner.configFiles).toEqual([]);
    });
  });

  describe("directoryExists", () => {
    it("returns true when directory exists", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({ isDirectory: () => true } as fs.Stats);

      expect(runner.testDirectoryExists("/root", "src")).toBe(true);
      expect(mockedFs.existsSync).toHaveBeenCalledWith(expect.stringContaining("src"));
    });

    it("returns false when path does not exist", () => {
      mockedFs.existsSync.mockReturnValue(false);

      expect(runner.testDirectoryExists("/root", "missing")).toBe(false);
    });

    it("returns false when path is a file not a directory", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({ isDirectory: () => false } as fs.Stats);

      expect(runner.testDirectoryExists("/root", "file.txt")).toBe(false);
    });
  });

  describe("fileExists", () => {
    it("returns true when file exists", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({ isFile: () => true } as fs.Stats);

      expect(runner.testFileExists("/root", "file.txt")).toBe(true);
    });

    it("returns false when path does not exist", () => {
      mockedFs.existsSync.mockReturnValue(false);

      expect(runner.testFileExists("/root", "missing.txt")).toBe(false);
    });

    it("returns false when path is a directory not a file", () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({ isFile: () => false } as fs.Stats);

      expect(runner.testFileExists("/root", "src")).toBe(false);
    });
  });

  describe("readFile", () => {
    it("returns file content on success", () => {
      mockedFs.readFileSync.mockReturnValue("file content");

      expect(runner.testReadFile("/root", "file.txt")).toBe("file content");
    });

    it("returns null on error", () => {
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      expect(runner.testReadFile("/root", "missing.txt")).toBeNull();
    });
  });

  describe("fileContains", () => {
    it("returns true when file contains pattern", () => {
      mockedFs.readFileSync.mockReturnValue("hello world");

      expect(runner.testFileContains("/root", "file.txt", "world")).toBe(true);
    });

    it("returns false when file does not contain pattern", () => {
      mockedFs.readFileSync.mockReturnValue("hello world");

      expect(runner.testFileContains("/root", "file.txt", "missing")).toBe(false);
    });

    it("returns false when file cannot be read", () => {
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      expect(runner.testFileContains("/root", "missing.txt", "pattern")).toBe(false);
    });
  });

  describe("pass", () => {
    it("returns a passing CheckResult", () => {
      const result = runner.testPass(10);
      expect(result.passed).toBe(true);
      expect(result.violations).toEqual([]);
      expect(result.name).toBe("TestTool");
      expect(result.rule).toBe("process.test");
    });
  });

  describe("fail", () => {
    it("returns a failing CheckResult with violations", () => {
      const violations = [
        { rule: "process.test.x", tool: "test", message: "bad", severity: "error" as const },
      ];
      const result = runner.testFail(violations, 5);
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
    });
  });

  describe("fromViolations", () => {
    it("returns pass when violations array is empty", () => {
      const result = runner.testFromViolations([], 5);
      expect(result.passed).toBe(true);
    });

    it("returns fail when violations array is non-empty", () => {
      const violations = [
        { rule: "process.test.x", tool: "test", message: "bad", severity: "error" as const },
      ];
      const result = runner.testFromViolations(violations, 5);
      expect(result.passed).toBe(false);
    });
  });

  describe("skip", () => {
    it("returns a skipped CheckResult", () => {
      const result = runner.testSkip("not applicable", 0);
      expect(result.passed).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe("not applicable");
    });
  });

  describe("audit", () => {
    it("delegates to run by default", async () => {
      const result = await runner.audit("/root");
      expect(result.passed).toBe(true);
    });
  });
});
