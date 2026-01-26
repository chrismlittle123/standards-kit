import * as fs from "node:fs";
import * as path from "node:path";

import type { ProjectType } from "./types.js";

/** Default standards.toml templates per project type */
const TEMPLATES: Record<ProjectType, string> = {
  typescript: `# standards.toml - TypeScript project configuration

[code.linting.eslint]
enabled = true

[code.types.tsc]
enabled = true
`,

  python: `# standards.toml - Python project configuration

[code.linting.ruff]
enabled = true
`,
};

/** Registry ruleset templates per project type */
const REGISTRY_RULESETS: Record<ProjectType, string> = {
  typescript: `# TypeScript ruleset

[code.linting.eslint]
enabled = true

[code.types.tsc]
enabled = true
`,

  python: `# Python ruleset

[code.linting.ruff]
enabled = true
`,
};

/** Get the default template for a project type */
export function getTemplate(type: ProjectType): string {
  return TEMPLATES[type];
}

/** Get a template that extends from a registry */
export function getExtendsTemplate(registryPath: string, projectType: ProjectType): string {
  return `# standards.toml - Extends from shared registry

[extends]
registry = "${registryPath}"
rulesets = ["${projectType}"]
`;
}

/** Get the registry ruleset content for a project type */
function getRegistryRuleset(type: ProjectType): string {
  return REGISTRY_RULESETS[type];
}

/**
 * Create a standards.toml file for a project.
 * @returns true if file was created (or would be created in dry-run)
 */
export function createCheckToml(
  projectPath: string,
  type: ProjectType,
  dryRun: boolean,
  registryPath?: string
): boolean {
  const checkTomlPath = path.join(projectPath, "standards.toml");

  // Skip if file already exists
  if (fs.existsSync(checkTomlPath)) {
    return false;
  }

  const content = registryPath ? getExtendsTemplate(registryPath, type) : getTemplate(type);

  if (!dryRun) {
    fs.writeFileSync(checkTomlPath, content, "utf-8");
  }

  return true;
}

/**
 * Create a shared registry with rulesets.
 * @param projectTypes - Set of project types that need rulesets
 */
export function createRegistry(
  registryPath: string,
  projectTypes: Set<ProjectType>,
  dryRun: boolean
): void {
  const rulesetsDir = path.join(registryPath, "rulesets");

  if (!dryRun) {
    fs.mkdirSync(rulesetsDir, { recursive: true });

    // Create rulesets for each project type found
    for (const type of projectTypes) {
      const rulesetPath = path.join(rulesetsDir, `${type}.toml`);
      fs.writeFileSync(rulesetPath, getRegistryRuleset(type), "utf-8");
    }
  }
}
