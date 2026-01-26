/**
 * Utilities for safe error handling and extraction.
 * Provides type-safe error handling patterns.
 */

/**
 * Shape of an error from execSync/execFileSync operations.
 * Note: status can be null when process was killed (e.g., timeout)
 */
export interface ExecError {
  status?: number | null;
  stdout?: string;
  stderr?: string;
  message?: string;
}

/**
 * Type guard to check if an unknown error is an ExecError
 */
export function isExecError(error: unknown): error is ExecError {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const obj = error as Record<string, unknown>;
  // Check for at least one expected property
  return (
    "status" in obj || "stdout" in obj || "stderr" in obj || "message" in obj
  );
}

/**
 * Safely extract error information from an unknown error
 *
 * @param error - The unknown error to extract from
 * @returns An ExecError with available properties, or defaults
 */
export function extractExecError(error: unknown): ExecError {
  if (isExecError(error)) {
    // Preserve status even if null (indicates killed process)
    // Only use undefined if the property doesn't exist
    const obj = error as Record<string, unknown>;
    return {
      status: "status" in obj ? (obj.status as number | null) : undefined,
      stdout: typeof error.stdout === "string" ? error.stdout : undefined,
      stderr: typeof error.stderr === "string" ? error.stderr : undefined,
      message: typeof error.message === "string" ? error.message : undefined,
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: String(error) };
}

/**
 * Get a human-readable error message from an unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}
