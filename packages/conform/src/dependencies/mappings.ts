/**
 * Built-in dependency mappings for tools
 *
 * Maps tool IDs to their known configuration file patterns.
 * These patterns may include globs that need to be expanded.
 */

import type { ToolDependencyMapping } from "./types.js";

/**
 * Built-in dependency mappings for all supported tools.
 * Keys match the toolId used in standards.toml config paths.
 */
export const BUILTIN_MAPPINGS: Record<string, ToolDependencyMapping> = {
  // Linting tools
  eslint: {
    toolId: "eslint",
    configFiles: [
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
      ".eslintrc.js",
      ".eslintrc.json",
      ".eslintrc.yml",
      ".eslintrc.yaml",
      ".eslintignore",
    ],
  },
  ruff: {
    toolId: "ruff",
    configFiles: ["ruff.toml", ".ruff.toml", "pyproject.toml"],
  },

  // Type checking tools
  tsc: {
    toolId: "tsc",
    configFiles: ["tsconfig.json", "tsconfig.*.json"],
  },
  ty: {
    toolId: "ty",
    configFiles: ["ty.toml", "pyproject.toml"],
  },

  // Unused code detection
  knip: {
    toolId: "knip",
    configFiles: [
      "knip.json",
      "knip.jsonc",
      "knip.js",
      "knip.ts",
      "knip.config.js",
      "knip.config.ts",
    ],
  },
  vulture: {
    toolId: "vulture",
    configFiles: ["pyproject.toml"],
  },

  // Test coverage / test runners
  vitest: {
    toolId: "vitest",
    configFiles: [
      "vitest.config.ts",
      "vitest.config.js",
      "vitest.config.mts",
      "vitest.config.mjs",
      "vite.config.ts",
      "vite.config.js",
    ],
  },
  jest: {
    toolId: "jest",
    configFiles: [
      "jest.config.js",
      "jest.config.ts",
      "jest.config.mjs",
      "jest.config.cjs",
      "jest.config.json",
    ],
  },
  pytest: {
    toolId: "pytest",
    configFiles: ["pytest.ini", "pyproject.toml", "setup.cfg", "conftest.py"],
  },

  // Security tools
  secrets: {
    toolId: "secrets",
    configFiles: [".gitleaks.toml", "gitleaks.toml"],
  },
  pnpmaudit: {
    toolId: "pnpmaudit",
    configFiles: ["pnpm-lock.yaml"],
  },
  pipaudit: {
    toolId: "pipaudit",
    configFiles: ["requirements.txt", "pyproject.toml", "setup.py"],
  },
};

/**
 * Files that are always tracked regardless of which tools are enabled.
 * These patterns may include globs.
 */
export const ALWAYS_TRACKED: string[] = [
  "standards.toml",
  ".github/workflows/*.yml",
  ".github/workflows/*.yaml",
  "repo-metadata.yaml",
];
