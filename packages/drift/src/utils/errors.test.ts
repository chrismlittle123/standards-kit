import { describe, it, expect } from "vitest";
import {
  isExecError,
  extractExecError,
  getErrorMessage,
  type ExecError,
} from "./errors.js";

describe("error utilities", () => {
  describe("isExecError", () => {
    it("returns false for null", () => {
      expect(isExecError(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isExecError(undefined)).toBe(false);
    });

    it("returns false for primitive types", () => {
      expect(isExecError("string")).toBe(false);
      expect(isExecError(123)).toBe(false);
      expect(isExecError(true)).toBe(false);
    });

    it("returns false for empty object", () => {
      expect(isExecError({})).toBe(false);
    });

    it("returns true for object with status property", () => {
      expect(isExecError({ status: 1 })).toBe(true);
      expect(isExecError({ status: 0 })).toBe(true);
      expect(isExecError({ status: null })).toBe(true);
    });

    it("returns true for object with stdout property", () => {
      expect(isExecError({ stdout: "output" })).toBe(true);
    });

    it("returns true for object with stderr property", () => {
      expect(isExecError({ stderr: "error output" })).toBe(true);
    });

    it("returns true for object with message property", () => {
      expect(isExecError({ message: "error message" })).toBe(true);
    });

    it("returns true for object with multiple ExecError properties", () => {
      expect(
        isExecError({
          status: 1,
          stdout: "out",
          stderr: "err",
          message: "msg",
        })
      ).toBe(true);
    });
  });

  describe("extractExecError", () => {
    it("extracts all properties from a full ExecError", () => {
      const error: ExecError = {
        status: 1,
        stdout: "standard output",
        stderr: "standard error",
        message: "command failed",
      };
      const result = extractExecError(error);
      expect(result).toEqual({
        status: 1,
        stdout: "standard output",
        stderr: "standard error",
        message: "command failed",
      });
    });

    it("preserves null status (indicates killed process)", () => {
      const error = { status: null, stderr: "killed" };
      const result = extractExecError(error);
      expect(result.status).toBeNull();
    });

    it("handles missing properties gracefully", () => {
      const error = { status: 2 };
      const result = extractExecError(error);
      expect(result.status).toBe(2);
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toBeUndefined();
      expect(result.message).toBeUndefined();
    });

    it("extracts message from Error instance", () => {
      const error = new Error("Something went wrong");
      const result = extractExecError(error);
      expect(result.message).toBe("Something went wrong");
    });

    it("converts non-ExecError objects to string message", () => {
      const result = extractExecError("plain string error");
      expect(result.message).toBe("plain string error");
    });

    it("converts numbers to string message", () => {
      const result = extractExecError(42);
      expect(result.message).toBe("42");
    });

    it("handles undefined input", () => {
      const result = extractExecError(undefined);
      expect(result.message).toBe("undefined");
    });

    it("ignores non-string stdout/stderr values", () => {
      const error = { status: 1, stdout: 123, stderr: { obj: true } };
      const result = extractExecError(error);
      expect(result.status).toBe(1);
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toBeUndefined();
    });

    it("ignores non-string message values in ExecError", () => {
      const error = { status: 0, message: 456 };
      const result = extractExecError(error);
      expect(result.status).toBe(0);
      expect(result.message).toBeUndefined();
    });
  });

  describe("getErrorMessage", () => {
    it("extracts message from Error instance", () => {
      const error = new Error("Test error message");
      expect(getErrorMessage(error)).toBe("Test error message");
    });

    it("returns string errors as-is", () => {
      expect(getErrorMessage("Direct string error")).toBe(
        "Direct string error"
      );
    });

    it("returns 'Unknown error' for non-Error, non-string values", () => {
      expect(getErrorMessage(123)).toBe("Unknown error");
      expect(getErrorMessage(null)).toBe("Unknown error");
      expect(getErrorMessage(undefined)).toBe("Unknown error");
      expect(getErrorMessage({ some: "object" })).toBe("Unknown error");
      expect(getErrorMessage(["array"])).toBe("Unknown error");
    });

    it("handles custom error classes", () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }
      const error = new CustomError("Custom error message");
      expect(getErrorMessage(error)).toBe("Custom error message");
    });
  });
});
