import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";

/** Single CODEOWNERS rule from config */
interface CodeownersRule {
  pattern: string;
  owners: string[];
}

/** CODEOWNERS configuration */
interface CodeownersConfig {
  enabled?: boolean;
  rules?: CodeownersRule[];
}

/** Parsed rule from CODEOWNERS file */
interface ParsedRule {
  pattern: string;
  owners: string[];
  line: number;
}

/** Common CODEOWNERS file locations */
const CODEOWNERS_LOCATIONS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

/**
 * Runner for CODEOWNERS file validation.
 * Validates that CODEOWNERS file exists and contains all required rules.
 */
export class CodeownersRunner extends BaseProcessToolRunner {
  readonly name = "CODEOWNERS";
  readonly rule = "process.codeowners";
  readonly toolId = "codeowners";

  private config: CodeownersConfig = { enabled: false };

  setConfig(config: CodeownersConfig): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Run check - validates CODEOWNERS content matches config
   */
  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    // Find CODEOWNERS file
    const codeownersPath = this.findCodeownersFile(projectRoot);
    if (!codeownersPath) {
      return this.fail(
        [
          {
            rule: `${this.rule}.file`,
            tool: this.toolId,
            message:
              "CODEOWNERS file not found (checked .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS)",
            severity: "error",
          },
        ],
        elapsed()
      );
    }

    // Read and parse CODEOWNERS file
    const content = this.readFile(projectRoot, codeownersPath);
    if (content === null) {
      return this.fail(
        [
          {
            rule: `${this.rule}.file`,
            tool: this.toolId,
            message: `Could not read CODEOWNERS file: ${codeownersPath}`,
            severity: "error",
          },
        ],
        elapsed()
      );
    }

    const { rules: parsedRules, malformedViolations } = this.parseCodeowners(
      content,
      codeownersPath
    );
    const validationViolations = this.validateRules(parsedRules, codeownersPath);

    // Combine malformed line violations with validation violations
    const violations = [...malformedViolations, ...validationViolations];
    return this.fromViolations(violations, elapsed());
  }

  /**
   * Audit - just checks that CODEOWNERS file exists
   */
  async audit(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    const codeownersPath = this.findCodeownersFile(projectRoot);
    if (!codeownersPath) {
      return this.fail(
        [
          {
            rule: `${this.rule}.file`,
            tool: this.toolId,
            message:
              "CODEOWNERS file not found (checked .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS)",
            severity: "error",
          },
        ],
        elapsed()
      );
    }

    return this.pass(elapsed());
  }

  /**
   * Find CODEOWNERS file in one of the standard locations
   */
  private findCodeownersFile(projectRoot: string): string | null {
    for (const location of CODEOWNERS_LOCATIONS) {
      if (this.fileExists(projectRoot, location)) {
        return location;
      }
    }
    return null;
  }

  /**
   * Parse result including both valid rules and malformed line violations
   */
  private parseCodeowners(
    content: string,
    filePath: string
  ): { rules: ParsedRule[]; malformedViolations: Violation[] } {
    const rules: ParsedRule[] = [];
    const malformedViolations: Violation[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;

      // Skip empty lines and comments
      if (!line || line.startsWith("#")) {
        continue;
      }

      const parsed = this.parseCodeownersLine(line, lineNumber);
      if (parsed) {
        rules.push(parsed);
      } else {
        // Report malformed line as violation
        malformedViolations.push({
          rule: `${this.rule}.malformed`,
          tool: this.toolId,
          file: filePath,
          line: lineNumber,
          message: `Malformed CODEOWNERS line: pattern "${line}" has no owners`,
          severity: "error",
        });
      }
    }

    return { rules, malformedViolations };
  }

  /**
   * Parse a single CODEOWNERS line into pattern and owners
   */
  private parseCodeownersLine(line: string, lineNumber: number): ParsedRule | null {
    // Split on whitespace - first token is pattern, rest are owners
    const tokens = line.split(/\s+/).filter(Boolean);

    if (tokens.length < 2) {
      // Invalid line - pattern without owners
      return null;
    }

    const [pattern, ...owners] = tokens;
    return { pattern, owners, line: lineNumber };
  }

  /**
   * Validate rules against config
   */
  private validateRules(parsedRules: ParsedRule[], filePath: string): Violation[] {
    const configRules = this.config.rules ?? [];
    const parsedRuleMap = this.buildParsedRuleMap(parsedRules);

    const missingViolations = this.checkMissingRules(configRules, parsedRuleMap, filePath);
    const extraViolations = this.checkExtraRules(parsedRules, configRules, filePath);

    return [...missingViolations, ...extraViolations];
  }

  /**
   * Build a map of parsed rules for quick lookup
   */
  private buildParsedRuleMap(parsedRules: ParsedRule[]): Map<string, ParsedRule> {
    const map = new Map<string, ParsedRule>();
    for (const rule of parsedRules) {
      map.set(rule.pattern, rule);
    }
    return map;
  }

  /**
   * Check that all configured rules exist with correct owners
   */
  private checkMissingRules(
    configRules: CodeownersRule[],
    parsedRuleMap: Map<string, ParsedRule>,
    filePath: string
  ): Violation[] {
    const violations: Violation[] = [];

    for (const configRule of configRules) {
      const parsedRule = parsedRuleMap.get(configRule.pattern);
      const violation = this.validateConfigRule(configRule, parsedRule, filePath);
      if (violation) {
        violations.push(violation);
      }
    }

    return violations;
  }

  /**
   * Validate a single config rule against parsed rule
   */
  private validateConfigRule(
    configRule: CodeownersRule,
    parsedRule: ParsedRule | undefined,
    filePath: string
  ): Violation | null {
    if (!parsedRule) {
      return {
        rule: `${this.rule}.missing`,
        tool: this.toolId,
        file: filePath,
        message: `Missing required rule: ${configRule.pattern} ${configRule.owners.join(" ")}`,
        severity: "error",
      };
    }

    if (!this.ownersMatch(configRule.owners, parsedRule.owners)) {
      return {
        rule: `${this.rule}.owners`,
        tool: this.toolId,
        file: filePath,
        line: parsedRule.line,
        message: `Owner mismatch for ${configRule.pattern}: expected [${configRule.owners.join(", ")}], got [${parsedRule.owners.join(", ")}]`,
        severity: "error",
      };
    }

    return null;
  }

  /**
   * Check for rules in CODEOWNERS that aren't in config
   */
  private checkExtraRules(
    parsedRules: ParsedRule[],
    configRules: CodeownersRule[],
    filePath: string
  ): Violation[] {
    const configPatterns = new Set(configRules.map((r) => r.pattern));
    const violations: Violation[] = [];

    for (const parsedRule of parsedRules) {
      if (!configPatterns.has(parsedRule.pattern)) {
        violations.push({
          rule: `${this.rule}.extra`,
          tool: this.toolId,
          file: filePath,
          line: parsedRule.line,
          message: `Unexpected rule not in config: ${parsedRule.pattern} ${parsedRule.owners.join(" ")}`,
          severity: "error",
        });
      }
    }

    return violations;
  }

  /**
   * Check if two owner arrays match exactly (order-sensitive)
   */
  private ownersMatch(expected: string[], actual: string[]): boolean {
    if (expected.length !== actual.length) {
      return false;
    }
    return expected.every((owner, index) => owner === actual[index]);
  }
}
