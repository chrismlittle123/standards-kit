import { describe, it, expect } from "vitest";
import { createEmptyResults, createEmptyOrgSummary } from "./results.js";

describe("results utilities", () => {
  describe("createEmptyResults", () => {
    it("creates results with correct path", () => {
      const path = "/test/path";
      const results = createEmptyResults(path);
      expect(results.path).toBe(path);
    });

    it("includes a timestamp", () => {
      const results = createEmptyResults("/test");
      expect(results.timestamp).toBeDefined();
      expect(new Date(results.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe("createEmptyOrgSummary", () => {
    it("creates summary with zero counts", () => {
      const summary = createEmptyOrgSummary();
      expect(summary.reposScanned).toBe(0);
      expect(summary.reposWithIssues).toBe(0);
      expect(summary.reposSkipped).toBe(0);
    });
  });
});
