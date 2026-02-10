import { describe, it, expect } from "vitest";
import {
  formatProcessViolationsIssueBody,
  getProcessViolationsIssueTitle,
  getProcessViolationsIssueLabel,
} from "../../../src/github/process-issue-formatter.js";
import type { ProcessViolationsDetection } from "../../../src/types.js";

describe("process-issue-formatter", () => {
  describe("getProcessViolationsIssueTitle", () => {
    it("returns correct title", () => {
      expect(getProcessViolationsIssueTitle()).toBe(
        "[drift:process] Process violations detected"
      );
    });
  });

  describe("getProcessViolationsIssueLabel", () => {
    it("returns correct label", () => {
      expect(getProcessViolationsIssueLabel()).toBe("drift:process");
    });
  });

  describe("formatProcessViolationsIssueBody", () => {
    it("formats detection with violations", () => {
      const detection: ProcessViolationsDetection = {
        repository: "org/my-service",
        scanTime: "2024-06-15 14:30 UTC",
        summary: [
          { category: "branches", passed: 2, failed: 1 },
          { category: "required_files", passed: 3, failed: 0 },
        ],
        violations: [
          {
            category: "branches",
            check: "require-pr-reviews",
            rule: "min-reviewers",
            message: "Requires at least 2 reviewers",
            severity: "error",
          },
        ],
      };

      const body = formatProcessViolationsIssueBody(detection);

      expect(body).toContain("## Process Violations Detected");
      expect(body).toContain("`org/my-service`");
      expect(body).toContain("2024-06-15 14:30 UTC");
      expect(body).toContain("### Summary");
      expect(body).toContain("| branches | 2 | 1 |");
      expect(body).toContain("| required_files | 3 | 0 |");
      expect(body).toContain("### Violations");
      expect(body).toContain("#### Branch Protection");
      expect(body).toContain(
        "| require-pr-reviews | Requires at least 2 reviewers | :x: |"
      );
      expect(body).toContain("### How to Fix");
      expect(body).toContain("Created by @standards-kit/drift");
    });

    it("handles empty violations", () => {
      const detection: ProcessViolationsDetection = {
        repository: "org/clean-repo",
        scanTime: "2024-06-15 14:30 UTC",
        summary: [{ category: "branches", passed: 5, failed: 0 }],
        violations: [],
      };

      const body = formatProcessViolationsIssueBody(detection);

      expect(body).toContain("## Process Violations Detected");
      expect(body).toContain("### Summary");
      expect(body).toContain("| branches | 5 | 0 |");
      expect(body).not.toContain("### Violations");
      expect(body).toContain("### How to Fix");
      expect(body).toContain("Created by @standards-kit/drift");
    });

    it("formats known category names correctly", () => {
      const detection: ProcessViolationsDetection = {
        repository: "org/repo",
        scanTime: "2024-06-15 14:30 UTC",
        summary: [],
        violations: [
          {
            category: "branches",
            check: "check-a",
            rule: "rule-a",
            message: "msg-a",
            severity: "error",
          },
          {
            category: "required_files",
            check: "check-b",
            rule: "rule-b",
            message: "msg-b",
            severity: "error",
          },
          {
            category: "forbidden_files",
            check: "check-c",
            rule: "rule-c",
            message: "msg-c",
            severity: "warning",
          },
          {
            category: "commits",
            check: "check-d",
            rule: "rule-d",
            message: "msg-d",
            severity: "error",
          },
          {
            category: "pull_requests",
            check: "check-e",
            rule: "rule-e",
            message: "msg-e",
            severity: "warning",
          },
          {
            category: "ci",
            check: "check-f",
            rule: "rule-f",
            message: "msg-f",
            severity: "error",
          },
          {
            category: "repo",
            check: "check-g",
            rule: "rule-g",
            message: "msg-g",
            severity: "error",
          },
          {
            category: "codeowners",
            check: "check-h",
            rule: "rule-h",
            message: "msg-h",
            severity: "warning",
          },
          {
            category: "hooks",
            check: "check-i",
            rule: "rule-i",
            message: "msg-i",
            severity: "error",
          },
          {
            category: "docs",
            check: "check-j",
            rule: "rule-j",
            message: "msg-j",
            severity: "error",
          },
        ],
      };

      const body = formatProcessViolationsIssueBody(detection);

      expect(body).toContain("#### Branch Protection");
      expect(body).toContain("#### Required Files");
      expect(body).toContain("#### Forbidden Files");
      expect(body).toContain("#### Commit Standards");
      expect(body).toContain("#### Pull Request Requirements");
      expect(body).toContain("#### CI/CD Configuration");
      expect(body).toContain("#### Repository Settings");
      expect(body).toContain("#### CODEOWNERS");
      expect(body).toContain("#### Git Hooks");
      expect(body).toContain("#### Documentation");
    });

    it("falls back to capitalized category name for unknown categories", () => {
      const detection: ProcessViolationsDetection = {
        repository: "org/repo",
        scanTime: "2024-06-15 14:30 UTC",
        summary: [],
        violations: [
          {
            category: "custom_check",
            check: "check-x",
            rule: "rule-x",
            message: "msg-x",
            severity: "error",
          },
        ],
      };

      const body = formatProcessViolationsIssueBody(detection);

      expect(body).toContain("#### Custom_check");
    });

    it("formats warning severity with warning icon", () => {
      const detection: ProcessViolationsDetection = {
        repository: "org/repo",
        scanTime: "2024-06-15 14:30 UTC",
        summary: [],
        violations: [
          {
            category: "branches",
            check: "optional-check",
            rule: "soft-rule",
            message: "Consider enabling this",
            severity: "warning",
          },
        ],
      };

      const body = formatProcessViolationsIssueBody(detection);

      expect(body).toContain(
        "| optional-check | Consider enabling this | :warning: |"
      );
    });

    it("formats error severity with x icon", () => {
      const detection: ProcessViolationsDetection = {
        repository: "org/repo",
        scanTime: "2024-06-15 14:30 UTC",
        summary: [],
        violations: [
          {
            category: "branches",
            check: "required-check",
            rule: "hard-rule",
            message: "Must be enabled",
            severity: "error",
          },
        ],
      };

      const body = formatProcessViolationsIssueBody(detection);

      expect(body).toContain(
        "| required-check | Must be enabled | :x: |"
      );
    });

    it("appends file path to message when violation has a file", () => {
      const detection: ProcessViolationsDetection = {
        repository: "org/repo",
        scanTime: "2024-06-15 14:30 UTC",
        summary: [],
        violations: [
          {
            category: "required_files",
            check: "has-codeowners",
            rule: "codeowners-exists",
            message: "CODEOWNERS file is missing",
            severity: "error",
            file: ".github/CODEOWNERS",
          },
        ],
      };

      const body = formatProcessViolationsIssueBody(detection);

      expect(body).toContain(
        "| has-codeowners | CODEOWNERS file is missing (.github/CODEOWNERS) | :x: |"
      );
    });

    it("groups violations by category", () => {
      const detection: ProcessViolationsDetection = {
        repository: "org/repo",
        scanTime: "2024-06-15 14:30 UTC",
        summary: [],
        violations: [
          {
            category: "branches",
            check: "check-1",
            rule: "rule-1",
            message: "msg-1",
            severity: "error",
          },
          {
            category: "ci",
            check: "check-2",
            rule: "rule-2",
            message: "msg-2",
            severity: "warning",
          },
          {
            category: "branches",
            check: "check-3",
            rule: "rule-3",
            message: "msg-3",
            severity: "warning",
          },
        ],
      };

      const body = formatProcessViolationsIssueBody(detection);

      // Both branch violations should appear under Branch Protection
      const branchSection = body.indexOf("#### Branch Protection");
      const ciSection = body.indexOf("#### CI/CD Configuration");
      expect(branchSection).toBeGreaterThan(-1);
      expect(ciSection).toBeGreaterThan(-1);
      expect(branchSection).toBeLessThan(ciSection);

      // check-1 and check-3 both under branches
      expect(body).toContain("| check-1 | msg-1 | :x: |");
      expect(body).toContain("| check-3 | msg-3 | :warning: |");
      expect(body).toContain("| check-2 | msg-2 | :warning: |");
    });

    it("includes summary table headers", () => {
      const detection: ProcessViolationsDetection = {
        repository: "org/repo",
        scanTime: "2024-01-01 00:00 UTC",
        summary: [{ category: "branches", passed: 1, failed: 0 }],
        violations: [],
      };

      const body = formatProcessViolationsIssueBody(detection);

      expect(body).toContain("| Category | Passed | Failed |");
      expect(body).toContain("|----------|--------|--------|");
    });

    it("includes violation table headers", () => {
      const detection: ProcessViolationsDetection = {
        repository: "org/repo",
        scanTime: "2024-01-01 00:00 UTC",
        summary: [],
        violations: [
          {
            category: "branches",
            check: "check",
            rule: "rule",
            message: "msg",
            severity: "error",
          },
        ],
      };

      const body = formatProcessViolationsIssueBody(detection);

      expect(body).toContain("| Check | Message | Severity |");
      expect(body).toContain("|-------|---------|----------|");
    });

    it("truncates extremely large issue bodies", () => {
      const manyViolations = Array.from({ length: 1000 }, (_, i) => ({
        category: "branches",
        check: `check-with-a-very-long-name-for-padding-purposes-${i}`,
        rule: `rule-${i}`,
        message: `This is a detailed violation message explaining what went wrong in check number ${i} with enough detail to be useful`,
        severity: "error" as const,
      }));

      const detection: ProcessViolationsDetection = {
        repository: "org/repo",
        scanTime: "2024-06-15 14:30 UTC",
        summary: [{ category: "branches", passed: 0, failed: 1000 }],
        violations: manyViolations,
      };

      const body = formatProcessViolationsIssueBody(detection);

      expect(body.length).toBeLessThanOrEqual(60000);
      expect(body).toContain("(truncated)");
      expect(body).toContain("Created by @standards-kit/drift");
    });
  });
});
