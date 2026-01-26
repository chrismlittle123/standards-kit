/**
 * Output formatters for the conform dependencies command
 */

import type { DependenciesResult } from "./types.js";

/** Format a list of files with bullet points */
function formatFileList(files: string[]): string {
  return files
    .sort()
    .map((f) => `  - ${f}`)
    .join("\n");
}

/**
 * Format dependencies result as human-readable text
 */
export function formatDependenciesText(result: DependenciesResult): string {
  const sections: string[] = [`Dependencies for ${result.checkTomlPath}`, ""];

  // Add tool dependencies
  for (const toolId of Object.keys(result.dependencies).sort()) {
    const files = result.dependencies[toolId];
    if (files.length > 0) {
      sections.push(`${toolId}:`, formatFileList(files), "");
    }
  }

  // Add always tracked files
  if (result.alwaysTracked.length > 0) {
    sections.push("Always tracked:", formatFileList(result.alwaysTracked));
  }

  return sections.join("\n");
}

/**
 * Format dependencies result as JSON
 */
export function formatDependenciesJson(result: DependenciesResult): string {
  return JSON.stringify(result, null, 2);
}
