import { describe, it, expect } from "vitest";
import {
  formatMissingProjectsIssueBody,
  getMissingProjectsIssueTitle,
  getMissingProjectsIssueLabel,
  formatTierMismatchIssueBody,
  getTierMismatchIssueTitle,
  getTierMismatchIssueLabel,
  formatDependencyChangesIssueBody,
  getDependencyChangesIssueTitle,
  getDependencyChangesIssueLabel,
} from "./issue-formatter.js";
import type {
  MissingProjectsDetection,
  TierMismatchDetection,
  DependencyChangesDetection,
} from "../types.js";

describe("issue-formatter", () => {
  describe("formatMissingProjectsIssueBody", () => {
    it("formats basic missing projects detection", () => {
      const detection: MissingProjectsDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        projects: [{ path: "packages/api", type: "typescript" }],
      };

      const body = formatMissingProjectsIssueBody(detection);

      expect(body).toContain("New Project Detected Without Standards");
      expect(body).toContain("`org/repo`");
      expect(body).toContain("2024-01-15 02:00 UTC");
      expect(body).toContain("Projects Missing standards.toml");
      expect(body).toContain("| packages/api | typescript |");
      expect(body).toContain("Action Required");
      expect(body).toContain("`cm init`");
      expect(body).toContain("Created by drift-toolkit");
    });

    it("handles multiple missing projects", () => {
      const detection: MissingProjectsDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        projects: [
          { path: "packages/api", type: "typescript" },
          { path: "packages/web", type: "typescript" },
          { path: "lambdas/processor", type: "python" },
        ],
      };

      const body = formatMissingProjectsIssueBody(detection);

      expect(body).toContain("| packages/api | typescript |");
      expect(body).toContain("| packages/web | typescript |");
      expect(body).toContain("| lambdas/processor | python |");
    });

    it("handles root-level project", () => {
      const detection: MissingProjectsDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        projects: [{ path: ".", type: "typescript" }],
      };

      const body = formatMissingProjectsIssueBody(detection);

      expect(body).toContain("| . | typescript |");
    });

    it("truncates extremely large issue bodies", () => {
      const manyProjects = Array.from({ length: 1000 }, (_, i) => ({
        path: `very/long/nested/path/to/package${i}/that/is/really/deep`,
        type: "typescript",
      }));

      const detection: MissingProjectsDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        projects: manyProjects,
      };

      const body = formatMissingProjectsIssueBody(detection);

      expect(body.length).toBeLessThanOrEqual(60000);
      expect(body).toContain("(content truncated due to length)");
      expect(body).toContain("Created by drift-toolkit");
    });

    it("includes table headers", () => {
      const detection: MissingProjectsDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        projects: [{ path: "pkg", type: "go" }],
      };

      const body = formatMissingProjectsIssueBody(detection);

      expect(body).toContain("| Path | Type |");
      expect(body).toContain("|------|------|");
    });
  });

  describe("getMissingProjectsIssueTitle", () => {
    it("returns correct title", () => {
      expect(getMissingProjectsIssueTitle()).toBe(
        "[drift:code] New project detected without standards"
      );
    });
  });

  describe("getMissingProjectsIssueLabel", () => {
    it("returns correct label", () => {
      expect(getMissingProjectsIssueLabel()).toBe("drift:code");
    });
  });

  describe("formatTierMismatchIssueBody", () => {
    it("formats tier mismatch detection correctly", () => {
      const detection: TierMismatchDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        tier: "production",
        rulesets: ["typescript-internal"],
        expectedPattern: "*-production",
        error:
          "No ruleset matching pattern '*-production' found. Rulesets: [typescript-internal]",
      };

      const body = formatTierMismatchIssueBody(detection);

      expect(body).toContain("## Tier-Ruleset Mismatch Detected");
      expect(body).toContain("Repository: `org/repo`");
      expect(body).toContain("2024-01-15 02:00 UTC");
      expect(body).toContain("| **Tier** | production |");
      expect(body).toContain("| **Expected Pattern** | `*-production` |");
      expect(body).toContain(
        "| **Current Rulesets** | `typescript-internal` |"
      );
      expect(body).toContain("No ruleset matching pattern");
      expect(body).toContain("Action Required");
      expect(body).toContain("Created by drift-toolkit");
    });

    it("handles multiple rulesets", () => {
      const detection: TierMismatchDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        tier: "internal",
        rulesets: ["typescript-production", "security-production"],
        expectedPattern: "*-internal",
        error: "Mismatch detected",
      };

      const body = formatTierMismatchIssueBody(detection);

      expect(body).toContain(
        "| **Current Rulesets** | `typescript-production`, `security-production` |"
      );
    });

    it("handles empty rulesets", () => {
      const detection: TierMismatchDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        tier: "prototype",
        rulesets: [],
        expectedPattern: "*-prototype",
        error: "No rulesets found",
      };

      const body = formatTierMismatchIssueBody(detection);

      expect(body).toContain("| **Current Rulesets** | _none_ |");
    });

    it("includes remediation steps", () => {
      const detection: TierMismatchDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        tier: "production",
        rulesets: ["typescript-internal"],
        expectedPattern: "*-production",
        error: "Mismatch",
      };

      const body = formatTierMismatchIssueBody(detection);

      expect(body).toContain(
        "Update `standards.toml` to use a ruleset matching `*-production`"
      );
      expect(body).toContain("`standards.toml` `[metadata].tier`");
    });
  });

  describe("getTierMismatchIssueTitle", () => {
    it("returns correct title", () => {
      expect(getTierMismatchIssueTitle()).toBe(
        "[drift:code] Tier-ruleset mismatch detected"
      );
    });
  });

  describe("getTierMismatchIssueLabel", () => {
    it("returns correct label", () => {
      expect(getTierMismatchIssueLabel()).toBe("drift:code");
    });
  });

  describe("formatDependencyChangesIssueBody", () => {
    it("formats basic dependency changes detection", () => {
      const detection: DependencyChangesDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        commit: "abc1234567890",
        commitUrl: "https://github.com/org/repo/commit/abc1234567890",
        changes: [
          {
            file: ".eslintrc.js",
            status: "modified",
            checkType: "eslint",
            diff: '- "warn"\n+ "off"',
          },
        ],
        byCheck: {
          eslint: [
            {
              file: ".eslintrc.js",
              status: "modified",
              checkType: "eslint",
              diff: '- "warn"\n+ "off"',
            },
          ],
        },
      };

      const body = formatDependencyChangesIssueBody(detection);

      expect(body).toContain("Dependency File Changes Detected");
      expect(body).toContain("`org/repo`");
      expect(body).toContain("2024-01-15 02:00 UTC");
      expect(body).toContain("[abc1234](");
      expect(body).toContain(".eslintrc.js");
      expect(body).toContain("[eslint]");
      expect(body).toContain("```diff");
      expect(body).toContain('- "warn"');
      expect(body).toContain('+ "off"');
      expect(body).toContain("Action Required");
      expect(body).toContain("Created by drift-toolkit");
    });

    it("groups changes by check type", () => {
      const detection: DependencyChangesDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        commit: "abc1234",
        commitUrl: "https://github.com/org/repo/commit/abc1234",
        changes: [
          {
            file: ".eslintrc.js",
            status: "modified",
            checkType: "eslint",
            diff: "eslint diff",
          },
          {
            file: "tsconfig.json",
            status: "modified",
            checkType: "tsc",
            diff: "tsc diff",
          },
        ],
        byCheck: {
          eslint: [
            {
              file: ".eslintrc.js",
              status: "modified",
              checkType: "eslint",
              diff: "eslint diff",
            },
          ],
          tsc: [
            {
              file: "tsconfig.json",
              status: "modified",
              checkType: "tsc",
              diff: "tsc diff",
            },
          ],
        },
      };

      const body = formatDependencyChangesIssueBody(detection);

      expect(body).toContain("Changes by Check Type");
      expect(body).toContain("#### eslint");
      expect(body).toContain("#### tsc");
    });

    it("handles ungrouped changes", () => {
      const detection: DependencyChangesDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        commit: "abc1234",
        commitUrl: "https://github.com/org/repo/commit/abc1234",
        changes: [
          {
            file: ".github/workflows/ci.yml",
            status: "modified",
            checkType: null,
            diff: "workflow diff",
          },
        ],
        byCheck: {},
      };

      const body = formatDependencyChangesIssueBody(detection);

      expect(body).toContain("Other Changed Files");
      expect(body).toContain(".github/workflows/ci.yml");
      expect(body).not.toContain("[null]");
    });

    it("handles deleted files", () => {
      const detection: DependencyChangesDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        commit: "abc1234",
        commitUrl: "https://github.com/org/repo/commit/abc1234",
        changes: [
          {
            file: ".prettierrc",
            status: "deleted",
            checkType: null,
          },
        ],
        byCheck: {},
      };

      const body = formatDependencyChangesIssueBody(detection);

      expect(body).toContain(".prettierrc");
      expect(body).toContain("(deleted)");
      expect(body).toContain("File was deleted");
    });

    it("handles added files", () => {
      const detection: DependencyChangesDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        commit: "abc1234",
        commitUrl: "https://github.com/org/repo/commit/abc1234",
        changes: [
          {
            file: "eslint.config.mjs",
            status: "added",
            checkType: "eslint",
            diff: "+ new config",
          },
        ],
        byCheck: {
          eslint: [
            {
              file: "eslint.config.mjs",
              status: "added",
              checkType: "eslint",
              diff: "+ new config",
            },
          ],
        },
      };

      const body = formatDependencyChangesIssueBody(detection);

      expect(body).toContain("eslint.config.mjs");
      expect(body).toContain("(new)");
      expect(body).toContain("+ new config");
    });

    it("truncates large diffs", () => {
      const largeDiff = Array(100).fill("+ line").join("\n");
      const detection: DependencyChangesDetection = {
        repository: "org/repo",
        scanTime: "2024-01-15 02:00 UTC",
        commit: "abc1234",
        commitUrl: "https://github.com/org/repo/commit/abc1234",
        changes: [
          {
            file: "large-config.json",
            status: "modified",
            checkType: null,
            diff: largeDiff,
          },
        ],
        byCheck: {},
      };

      const body = formatDependencyChangesIssueBody(detection);

      expect(body).toContain("(truncated)");
    });
  });

  describe("getDependencyChangesIssueTitle", () => {
    it("returns correct title", () => {
      expect(getDependencyChangesIssueTitle()).toBe(
        "[drift:code] Dependency file changes detected"
      );
    });
  });

  describe("getDependencyChangesIssueLabel", () => {
    it("returns correct label", () => {
      expect(getDependencyChangesIssueLabel()).toBe("drift:code");
    });
  });
});
