import { describe, it, expect } from "vitest";
import {
  ViolationBuilder,
  CheckResultBuilder,
  DomainResultBuilder,
  ExitCode,
} from "../../../src/core/index.js";

describe("ExitCode", () => {
  it("defines SUCCESS as 0", () => {
    expect(ExitCode.SUCCESS).toBe(0);
  });

  it("defines VIOLATIONS_FOUND as 1", () => {
    expect(ExitCode.VIOLATIONS_FOUND).toBe(1);
  });

  it("defines CONFIG_ERROR as 2", () => {
    expect(ExitCode.CONFIG_ERROR).toBe(2);
  });

  it("defines RUNTIME_ERROR as 3", () => {
    expect(ExitCode.RUNTIME_ERROR).toBe(3);
  });
});

describe("ViolationBuilder", () => {
  it("creates a violation with create()", () => {
    const violation = ViolationBuilder.create({
      rule: "code.linting",
      tool: "eslint",
      message: "Test message",
      severity: "error",
    });

    expect(violation.rule).toBe("code.linting");
    expect(violation.tool).toBe("eslint");
    expect(violation.message).toBe("Test message");
    expect(violation.severity).toBe("error");
  });

  it("creates a violation with optional fields", () => {
    const violation = ViolationBuilder.create({
      rule: "code.linting",
      tool: "eslint",
      message: "Test message",
      severity: "warning",
      file: "test.ts",
      line: 10,
      column: 5,
      code: "no-console",
    });

    expect(violation.file).toBe("test.ts");
    expect(violation.line).toBe(10);
    expect(violation.column).toBe(5);
    expect(violation.code).toBe("no-console");
  });

  it("creates an error violation with error()", () => {
    const violation = ViolationBuilder.error(
      "code.linting",
      "eslint",
      "Error message"
    );

    expect(violation.rule).toBe("code.linting");
    expect(violation.tool).toBe("eslint");
    expect(violation.message).toBe("Error message");
    expect(violation.severity).toBe("error");
  });

  it("creates a warning violation with warning()", () => {
    const violation = ViolationBuilder.warning(
      "code.linting",
      "eslint",
      "Warning message"
    );

    expect(violation.rule).toBe("code.linting");
    expect(violation.tool).toBe("eslint");
    expect(violation.message).toBe("Warning message");
    expect(violation.severity).toBe("warning");
  });

  it("includes code when provided to error()", () => {
    const violation = ViolationBuilder.error(
      "code.linting",
      "eslint",
      "Error message",
      "no-unused-vars"
    );

    expect(violation.code).toBe("no-unused-vars");
  });
});

describe("CheckResultBuilder", () => {
  it("creates a passing check result", () => {
    const result = CheckResultBuilder.pass("ESLint", "code.linting");

    expect(result.name).toBe("ESLint");
    expect(result.rule).toBe("code.linting");
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.skipped).toBe(false);
  });

  it("creates a passing check result with duration", () => {
    const result = CheckResultBuilder.pass("ESLint", "code.linting", 150);

    expect(result.duration).toBe(150);
  });

  it("creates a failing check result with violations", () => {
    const violation = ViolationBuilder.error(
      "code.linting",
      "eslint",
      "Error"
    );

    const result = CheckResultBuilder.fail(
      "ESLint",
      "code.linting",
      [violation]
    );

    expect(result.name).toBe("ESLint");
    expect(result.rule).toBe("code.linting");
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.skipped).toBe(false);
  });

  it("creates a skipped check result with reason", () => {
    const result = CheckResultBuilder.skip(
      "ESLint",
      "code.linting",
      "Config not found"
    );

    expect(result.name).toBe("ESLint");
    expect(result.rule).toBe("code.linting");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("Config not found");
  });

  it("creates result from violations - pass when empty", () => {
    const result = CheckResultBuilder.fromViolations(
      "ESLint",
      "code.linting",
      []
    );

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("creates result from violations - fail when not empty", () => {
    const violation = ViolationBuilder.error(
      "code.linting",
      "eslint",
      "Error"
    );

    const result = CheckResultBuilder.fromViolations(
      "ESLint",
      "code.linting",
      [violation]
    );

    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
  });
});

describe("DomainResultBuilder", () => {
  it("creates a domain result from passing checks", () => {
    const checkResult = CheckResultBuilder.pass("ESLint", "code.linting");

    const result = DomainResultBuilder.fromChecks("code", [checkResult]);

    expect(result.domain).toBe("code");
    expect(result.status).toBe("pass");
    expect(result.checks).toHaveLength(1);
    expect(result.violationCount).toBe(0);
  });

  it("creates a failing domain result when check fails", () => {
    const violation = ViolationBuilder.error(
      "code.linting",
      "eslint",
      "Error"
    );
    const checkResult = CheckResultBuilder.fail(
      "ESLint",
      "code.linting",
      [violation]
    );

    const result = DomainResultBuilder.fromChecks("code", [checkResult]);

    expect(result.domain).toBe("code");
    expect(result.status).toBe("fail");
    expect(result.violationCount).toBe(1);
  });

  it("counts violations correctly across multiple checks", () => {
    const violation = ViolationBuilder.error(
      "code.linting",
      "eslint",
      "Error"
    );

    const check1 = CheckResultBuilder.fail("ESLint", "code.linting", [
      violation,
      violation,
    ]);
    const check2 = CheckResultBuilder.fail("TSC", "code.types", [violation]);

    const result = DomainResultBuilder.fromChecks("code", [check1, check2]);

    expect(result.violationCount).toBe(3);
  });

  it("returns skip status when all checks are skipped", () => {
    const check1 = CheckResultBuilder.skip(
      "ESLint",
      "code.linting",
      "No config"
    );
    const check2 = CheckResultBuilder.skip("TSC", "code.types", "Disabled");

    const result = DomainResultBuilder.fromChecks("code", [check1, check2]);

    expect(result.status).toBe("skip");
  });

  it("returns skip status when no checks provided", () => {
    const result = DomainResultBuilder.fromChecks("code", []);

    expect(result.status).toBe("skip");
  });

  it("returns pass when mix of passed and skipped checks", () => {
    const pass = CheckResultBuilder.pass("ESLint", "code.linting");
    const skip = CheckResultBuilder.skip("TSC", "code.types", "Disabled");

    const result = DomainResultBuilder.fromChecks("code", [pass, skip]);

    expect(result.status).toBe("pass");
  });
});
