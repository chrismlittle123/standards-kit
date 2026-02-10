import { describe, it, expect } from "vitest";

import { formatJson, formatText, formatOutput } from "../../../src/output/index.js";
import type { FullResult, DomainResult } from "../../../src/core/index.js";

function makeResult(overrides: Partial<FullResult> = {}): FullResult {
  return {
    version: "1.0.0",
    configPath: "standards.toml",
    domains: {},
    summary: { totalViolations: 0, totalChecks: 0, duration: 100 },
    ...overrides,
  };
}

function makeDomain(overrides: Partial<DomainResult> = {}): DomainResult {
  return {
    status: "pass",
    checks: [],
    ...overrides,
  };
}

describe("formatJson", () => {
  it("returns pretty-printed JSON", () => {
    const result = makeResult();
    const output = formatJson(result);
    expect(JSON.parse(output)).toEqual(result);
  });

  it("includes all domain data", () => {
    const result = makeResult({
      domains: { code: makeDomain() },
    });
    const parsed = JSON.parse(formatJson(result));
    expect(parsed.domains.code).toBeDefined();
  });
});

describe("formatText", () => {
  it("includes version header", () => {
    const output = formatText(makeResult({ version: "2.0.0" }));
    expect(output).toContain("conform v2.0.0");
  });

  it("includes config path", () => {
    const output = formatText(makeResult({ configPath: "/path/to/config.toml" }));
    expect(output).toContain("Config: /path/to/config.toml");
  });

  it("shows all checks passed when no violations", () => {
    const output = formatText(makeResult({ summary: { totalViolations: 0, totalChecks: 1, duration: 50 } }));
    expect(output).toContain("All checks passed");
  });

  it("shows violation count when violations exist", () => {
    const output = formatText(
      makeResult({ summary: { totalViolations: 3, totalChecks: 5, duration: 50 } })
    );
    expect(output).toContain("3 violation(s) found");
  });

  it("formats passed check", () => {
    const domain = makeDomain({
      checks: [{ name: "eslint", passed: true, skipped: false, violations: [], duration: 100 }],
    });
    const output = formatText(makeResult({ domains: { code: domain } }));
    expect(output).toContain("eslint");
    expect(output).toContain("passed");
  });

  it("formats skipped check", () => {
    const domain = makeDomain({
      status: "skip",
      checks: [
        { name: "tsc", passed: true, skipped: true, skipReason: "not configured", violations: [] },
      ],
    });
    const output = formatText(makeResult({ domains: { code: domain } }));
    expect(output).toContain("skipped");
    expect(output).toContain("not configured");
  });

  it("formats check with violations", () => {
    const domain = makeDomain({
      status: "fail",
      checks: [
        {
          name: "eslint",
          passed: false,
          skipped: false,
          violations: [
            {
              message: "unused var",
              severity: "error",
              file: "src/index.ts",
              line: 10,
              column: 5,
              code: "no-unused-vars",
            },
          ],
          duration: 200,
        },
      ],
    });
    const output = formatText(
      makeResult({ domains: { code: domain }, summary: { totalViolations: 1, totalChecks: 1, duration: 200 } })
    );
    expect(output).toContain("1 violation(s)");
    expect(output).toContain("src/index.ts:10:5");
    expect(output).toContain("no-unused-vars");
    expect(output).toContain("unused var");
  });

  it("formats violation with file and line only", () => {
    const domain = makeDomain({
      status: "fail",
      checks: [
        {
          name: "ruff",
          passed: false,
          skipped: false,
          violations: [
            { message: "bad import", severity: "warning", file: "main.py", line: 3 },
          ],
        },
      ],
    });
    const output = formatText(
      makeResult({ domains: { code: domain }, summary: { totalViolations: 1, totalChecks: 1, duration: 10 } })
    );
    expect(output).toContain("main.py:3");
    expect(output).not.toContain("main.py:3:");
  });

  it("formats violation without file", () => {
    const domain = makeDomain({
      status: "fail",
      checks: [
        {
          name: "check",
          passed: false,
          skipped: false,
          violations: [{ message: "global issue", severity: "error" }],
        },
      ],
    });
    const output = formatText(
      makeResult({ domains: { code: domain }, summary: { totalViolations: 1, totalChecks: 1, duration: 10 } })
    );
    expect(output).toContain("global issue");
  });

  it("truncates violations beyond 10", () => {
    const violations = Array.from({ length: 15 }, (_, i) => ({
      message: `issue ${i}`,
      severity: "error" as const,
      file: `file${i}.ts`,
    }));
    const domain = makeDomain({
      status: "fail",
      checks: [{ name: "eslint", passed: false, skipped: false, violations }],
    });
    const output = formatText(
      makeResult({
        domains: { code: domain },
        summary: { totalViolations: 15, totalChecks: 1, duration: 10 },
      })
    );
    expect(output).toContain("and 5 more");
  });

  it("formats domain name in uppercase", () => {
    const output = formatText(makeResult({ domains: { code: makeDomain() } }));
    expect(output).toContain("CODE");
  });

  it("shows duration when present", () => {
    const domain = makeDomain({
      checks: [{ name: "eslint", passed: true, skipped: false, violations: [], duration: 500 }],
    });
    const output = formatText(makeResult({ domains: { code: domain } }));
    expect(output).toContain("500ms");
  });
});

describe("formatOutput", () => {
  it("delegates to formatJson for json format", () => {
    const result = makeResult();
    expect(formatOutput(result, "json")).toBe(formatJson(result));
  });

  it("delegates to formatText for text format", () => {
    const result = makeResult();
    expect(formatOutput(result, "text")).toBe(formatText(result));
  });
});
