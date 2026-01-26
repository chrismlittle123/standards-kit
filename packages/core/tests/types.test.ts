import { describe, it, expect } from "vitest";
import {
  ViolationBuilder,
  CheckResultBuilder,
  DomainResultBuilder,
  ExitCode,
} from "../src/types.js";

describe("ViolationBuilder", () => {
  it("creates a violation with create()", () => {
    const violation = ViolationBuilder.create({
      rule: "test.rule",
      tool: "test-tool",
      message: "Test message",
      severity: "error",
      file: "test.ts",
      line: 10,
    });

    expect(violation).toEqual({
      rule: "test.rule",
      tool: "test-tool",
      message: "Test message",
      severity: "error",
      file: "test.ts",
      line: 10,
    });
  });

  it("creates an error violation", () => {
    const violation = ViolationBuilder.error("rule", "tool", "message", "CODE");
    expect(violation.severity).toBe("error");
    expect(violation.code).toBe("CODE");
  });

  it("creates a warning violation", () => {
    const violation = ViolationBuilder.warning("rule", "tool", "message");
    expect(violation.severity).toBe("warning");
  });
});

describe("CheckResultBuilder", () => {
  it("creates a passing check result", () => {
    const result = CheckResultBuilder.pass("Test Check", "test.rule", 100);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.violations).toEqual([]);
    expect(result.duration).toBe(100);
  });

  it("creates a failing check result", () => {
    const violations = [ViolationBuilder.error("rule", "tool", "error")];
    const result = CheckResultBuilder.fail("Test Check", "test.rule", violations);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  it("creates a skipped check result", () => {
    const result = CheckResultBuilder.skip("Test Check", "test.rule", "Not configured");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("Not configured");
  });

  it("creates result from violations - empty = pass", () => {
    const result = CheckResultBuilder.fromViolations("Test", "rule", []);
    expect(result.passed).toBe(true);
  });

  it("creates result from violations - has violations = fail", () => {
    const violations = [ViolationBuilder.error("rule", "tool", "error")];
    const result = CheckResultBuilder.fromViolations("Test", "rule", violations);
    expect(result.passed).toBe(false);
  });
});

describe("DomainResultBuilder", () => {
  it("creates pass status when all checks pass", () => {
    const checks = [
      CheckResultBuilder.pass("Check 1", "rule1"),
      CheckResultBuilder.pass("Check 2", "rule2"),
    ];
    const result = DomainResultBuilder.fromChecks("code", checks);
    expect(result.status).toBe("pass");
    expect(result.violationCount).toBe(0);
  });

  it("creates fail status when any check fails", () => {
    const checks = [
      CheckResultBuilder.pass("Check 1", "rule1"),
      CheckResultBuilder.fail("Check 2", "rule2", [
        ViolationBuilder.error("rule2", "tool", "error"),
      ]),
    ];
    const result = DomainResultBuilder.fromChecks("code", checks);
    expect(result.status).toBe("fail");
    expect(result.violationCount).toBe(1);
  });

  it("creates skip status when all checks skipped", () => {
    const checks = [
      CheckResultBuilder.skip("Check 1", "rule1", "disabled"),
      CheckResultBuilder.skip("Check 2", "rule2", "disabled"),
    ];
    const result = DomainResultBuilder.fromChecks("code", checks);
    expect(result.status).toBe("skip");
  });
});

describe("ExitCode", () => {
  it("has correct values", () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.VIOLATIONS_FOUND).toBe(1);
    expect(ExitCode.CONFIG_ERROR).toBe(2);
    expect(ExitCode.RUNTIME_ERROR).toBe(3);
  });
});
