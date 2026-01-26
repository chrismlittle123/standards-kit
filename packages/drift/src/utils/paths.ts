/**
 * Utilities for safe path handling.
 * Provides protection against path traversal attacks.
 */

import { join, resolve, sep } from "path";

/**
 * Error thrown when a path traversal attempt is detected
 */
export class PathTraversalError extends Error {
  constructor(
    public readonly basePath: string,
    public readonly requestedPath: string
  ) {
    super(
      `Path traversal detected: "${requestedPath}" escapes base directory "${basePath}"`
    );
    this.name = "PathTraversalError";
  }
}

/**
 * Safely join a base path with a relative path, preventing path traversal.
 * Throws PathTraversalError if the resulting path escapes the base directory.
 *
 * @param basePath - The base directory that the result must stay within
 * @param relativePath - The relative path to join (may contain user input)
 * @returns The resolved absolute path that is guaranteed to be within basePath
 * @throws PathTraversalError if the path would escape the base directory
 */
export function safeJoinPath(basePath: string, relativePath: string): string {
  const resolvedBase = resolve(basePath);
  const resolvedPath = resolve(join(basePath, relativePath));

  // Ensure the resolved path starts with the base path
  // We add sep to prevent matching partial directory names
  // e.g., /foo/bar should not match /foo/barbaz
  if (
    !resolvedPath.startsWith(resolvedBase + sep) &&
    resolvedPath !== resolvedBase
  ) {
    throw new PathTraversalError(basePath, relativePath);
  }

  return resolvedPath;
}
