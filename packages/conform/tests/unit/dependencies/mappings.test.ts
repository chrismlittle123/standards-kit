import { describe, it, expect } from "vitest";

import { BUILTIN_MAPPINGS, ALWAYS_TRACKED } from "../../../src/dependencies/mappings.js";
import {
  formatDependenciesText,
  formatDependenciesJson,
} from "../../../src/dependencies/output.js";
import type { DependenciesResult } from "../../../src/dependencies/types.js";

// =============================================================================
// BUILTIN_MAPPINGS
// =============================================================================

describe("BUILTIN_MAPPINGS", () => {
  it("has eslint mapping", () => {
    expect(BUILTIN_MAPPINGS.eslint).toBeDefined();
    expect(BUILTIN_MAPPINGS.eslint.toolId).toBe("eslint");
    expect(BUILTIN_MAPPINGS.eslint.configFiles).toContain("eslint.config.js");
  });

  it("has ruff mapping", () => {
    expect(BUILTIN_MAPPINGS.ruff).toBeDefined();
    expect(BUILTIN_MAPPINGS.ruff.toolId).toBe("ruff");
    expect(BUILTIN_MAPPINGS.ruff.configFiles).toContain("ruff.toml");
  });

  it("has tsc mapping", () => {
    expect(BUILTIN_MAPPINGS.tsc).toBeDefined();
    expect(BUILTIN_MAPPINGS.tsc.configFiles).toContain("tsconfig.json");
  });

  it("has ty mapping", () => {
    expect(BUILTIN_MAPPINGS.ty).toBeDefined();
    expect(BUILTIN_MAPPINGS.ty.configFiles).toContain("ty.toml");
  });

  it("has knip mapping", () => {
    expect(BUILTIN_MAPPINGS.knip).toBeDefined();
    expect(BUILTIN_MAPPINGS.knip.configFiles).toContain("knip.json");
  });

  it("has vulture mapping", () => {
    expect(BUILTIN_MAPPINGS.vulture).toBeDefined();
  });

  it("has vitest mapping", () => {
    expect(BUILTIN_MAPPINGS.vitest).toBeDefined();
    expect(BUILTIN_MAPPINGS.vitest.configFiles).toContain("vitest.config.ts");
  });

  it("has jest mapping", () => {
    expect(BUILTIN_MAPPINGS.jest).toBeDefined();
    expect(BUILTIN_MAPPINGS.jest.configFiles).toContain("jest.config.js");
  });

  it("has pytest mapping", () => {
    expect(BUILTIN_MAPPINGS.pytest).toBeDefined();
    expect(BUILTIN_MAPPINGS.pytest.configFiles).toContain("pytest.ini");
  });

  it("has secrets mapping", () => {
    expect(BUILTIN_MAPPINGS.secrets).toBeDefined();
    expect(BUILTIN_MAPPINGS.secrets.configFiles).toContain(".gitleaks.toml");
  });

  it("has pnpmaudit mapping", () => {
    expect(BUILTIN_MAPPINGS.pnpmaudit).toBeDefined();
  });

  it("has pipaudit mapping", () => {
    expect(BUILTIN_MAPPINGS.pipaudit).toBeDefined();
  });

  it("each mapping has toolId matching its key", () => {
    for (const [key, mapping] of Object.entries(BUILTIN_MAPPINGS)) {
      expect(mapping.toolId).toBe(key);
    }
  });

  it("each mapping has non-empty configFiles", () => {
    for (const mapping of Object.values(BUILTIN_MAPPINGS)) {
      expect(mapping.configFiles.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// ALWAYS_TRACKED
// =============================================================================

describe("ALWAYS_TRACKED", () => {
  it("includes standards.toml", () => {
    expect(ALWAYS_TRACKED).toContain("standards.toml");
  });

  it("includes workflow YAML patterns", () => {
    expect(ALWAYS_TRACKED.some((f) => f.includes(".github/workflows"))).toBe(true);
  });

  it("includes repo-metadata.yaml", () => {
    expect(ALWAYS_TRACKED).toContain("repo-metadata.yaml");
  });
});

// =============================================================================
// formatDependenciesText
// =============================================================================

describe("formatDependenciesText", () => {
  function makeResult(overrides: Partial<DependenciesResult> = {}): DependenciesResult {
    return {
      project: ".",
      checkTomlPath: "standards.toml",
      dependencies: {},
      alwaysTracked: [],
      allFiles: [],
      ...overrides,
    };
  }

  it("includes the config path in header", () => {
    const output = formatDependenciesText(makeResult());
    expect(output).toContain("Dependencies for standards.toml");
  });

  it("lists tool dependencies alphabetically", () => {
    const output = formatDependenciesText(
      makeResult({
        dependencies: {
          tsc: ["tsconfig.json"],
          eslint: ["eslint.config.js"],
        },
      })
    );
    const eslintIndex = output.indexOf("eslint:");
    const tscIndex = output.indexOf("tsc:");
    expect(eslintIndex).toBeLessThan(tscIndex);
  });

  it("lists files with bullet points", () => {
    const output = formatDependenciesText(
      makeResult({ dependencies: { eslint: ["eslint.config.js"] } })
    );
    expect(output).toContain("  - eslint.config.js");
  });

  it("skips tools with no files", () => {
    const output = formatDependenciesText(makeResult({ dependencies: { eslint: [] } }));
    expect(output).not.toContain("eslint:");
  });

  it("includes always tracked section", () => {
    const output = formatDependenciesText(
      makeResult({ alwaysTracked: ["standards.toml"] })
    );
    expect(output).toContain("Always tracked:");
    expect(output).toContain("  - standards.toml");
  });

  it("omits always tracked section when empty", () => {
    const output = formatDependenciesText(makeResult({ alwaysTracked: [] }));
    expect(output).not.toContain("Always tracked:");
  });
});

// =============================================================================
// formatDependenciesJson
// =============================================================================

describe("formatDependenciesJson", () => {
  it("returns valid JSON", () => {
    const result: DependenciesResult = {
      project: ".",
      checkTomlPath: "standards.toml",
      dependencies: { eslint: ["eslint.config.js"] },
      alwaysTracked: ["standards.toml"],
      allFiles: ["eslint.config.js", "standards.toml"],
    };
    const parsed = JSON.parse(formatDependenciesJson(result));
    expect(parsed).toEqual(result);
  });
});
