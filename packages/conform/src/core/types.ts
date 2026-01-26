/**
 * Shared types for standards-kit
 */

// =============================================================================
// Core Types
// =============================================================================

/** Severity levels for violations */
export type Severity = "error" | "warning";

/** Status for domain results */
export type DomainStatus = "pass" | "fail" | "skip";

/** A single violation found by a check */
export interface Violation {
  rule: string;
  tool: string;
  file?: string;
  line?: number;
  column?: number;
  message: string;
  code?: string;
  severity: Severity;
}

/** Result of running a single check */
export interface CheckResult {
  name: string;
  rule: string;
  passed: boolean;
  violations: Violation[];
  skipped: boolean;
  skipReason?: string;
  duration?: number;
}

/** Result of running all checks in a domain */
export interface DomainResult {
  domain: string;
  status: DomainStatus;
  checks: CheckResult[];
  violationCount: number;
}

/** Full result of conform check or conform audit */
export interface FullResult {
  version: string;
  configPath: string;
  domains: Record<string, DomainResult>;
  summary: {
    totalViolations: number;
    exitCode: number;
  };
}

// =============================================================================
// Tool Interface
// =============================================================================

/** Interface for tool runners (ESLint, Ruff, tsc, etc.) */
export interface IToolRunner {
  /** Display name of the tool */
  readonly name: string;
  /** Rule category (e.g., "code.linting") */
  readonly rule: string;
  /** Tool identifier for violations */
  readonly toolId: string;
  /** Config file patterns to look for */
  readonly configFiles: string[];

  /** Run the tool and return check results */
  run(projectRoot: string): Promise<CheckResult>;

  /** Audit that config exists without running the tool */
  audit(projectRoot: string): Promise<CheckResult>;
}

// =============================================================================
// Builders
// =============================================================================

/** Options for creating a violation */
export interface ViolationOptions {
  rule: string;
  tool: string;
  message: string;
  severity: Severity;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
}

/** Builder for creating Violation objects */
export const ViolationBuilder = {
  create(options: ViolationOptions): Violation {
    return {
      rule: options.rule,
      tool: options.tool,
      message: options.message,
      severity: options.severity,
      ...(options.file && { file: options.file }),
      ...(options.line && { line: options.line }),
      ...(options.column && { column: options.column }),
      ...(options.code && { code: options.code }),
    };
  },

  error(rule: string, tool: string, message: string, code?: string): Violation {
    return { rule, tool, message, severity: "error", code };
  },

  warning(rule: string, tool: string, message: string, code?: string): Violation {
    return { rule, tool, message, severity: "warning", code };
  },
};

/** Builder for creating CheckResult objects */
export const CheckResultBuilder = {
  pass(name: string, rule: string, duration?: number): CheckResult {
    return {
      name,
      rule,
      passed: true,
      violations: [],
      skipped: false,
      duration,
    };
  },

  fail(name: string, rule: string, violations: Violation[], duration?: number): CheckResult {
    return {
      name,
      rule,
      passed: false,
      violations,
      skipped: false,
      duration,
    };
  },

  skip(name: string, rule: string, reason: string, duration?: number): CheckResult {
    return {
      name,
      rule,
      passed: true,
      violations: [],
      skipped: true,
      skipReason: reason,
      duration,
    };
  },

  fromViolations(
    name: string,
    rule: string,
    violations: Violation[],
    duration?: number
  ): CheckResult {
    return violations.length === 0
      ? CheckResultBuilder.pass(name, rule, duration)
      : CheckResultBuilder.fail(name, rule, violations, duration);
  },
};

/** Builder for creating DomainResult objects */
export const DomainResultBuilder = {
  fromChecks(domain: string, checks: CheckResult[]): DomainResult {
    const violationCount = checks.reduce((sum, check) => sum + check.violations.length, 0);
    const allPassed = checks.every((check) => check.passed || check.skipped);
    const allSkipped = checks.length === 0 || checks.every((check) => check.skipped);

    let status: DomainStatus = "fail";
    if (allSkipped) {
      status = "skip";
    } else if (allPassed) {
      status = "pass";
    }

    return { domain, status, checks, violationCount };
  },
};

// =============================================================================
// Exit Codes
// =============================================================================

export const ExitCode = {
  SUCCESS: 0,
  VIOLATIONS_FOUND: 1,
  CONFIG_ERROR: 2,
  RUNTIME_ERROR: 3,
} as const;

export type ExitCodeType = (typeof ExitCode)[keyof typeof ExitCode];
