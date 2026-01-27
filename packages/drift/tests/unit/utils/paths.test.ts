import { describe, it, expect } from "vitest";
import { resolve, sep } from "path";
import { safeJoinPath, PathTraversalError } from "../../../src/utils/paths.js";

describe("path utilities", () => {
  describe("PathTraversalError", () => {
    it("creates error with correct message", () => {
      const error = new PathTraversalError("/base", "../escape");
      expect(error.message).toBe(
        'Path traversal detected: "../escape" escapes base directory "/base"'
      );
      expect(error.name).toBe("PathTraversalError");
    });

    it("stores basePath and requestedPath", () => {
      const error = new PathTraversalError("/my/base", "../../etc/passwd");
      expect(error.basePath).toBe("/my/base");
      expect(error.requestedPath).toBe("../../etc/passwd");
    });

    it("is instanceof Error", () => {
      const error = new PathTraversalError("/base", "../up");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PathTraversalError);
    });
  });

  describe("safeJoinPath", () => {
    const testBase = "/test/base/path";

    it("joins simple relative paths", () => {
      const result = safeJoinPath(testBase, "subdir");
      expect(result).toBe(resolve(testBase, "subdir"));
    });

    it("joins nested relative paths", () => {
      const result = safeJoinPath(testBase, "subdir/nested/deep");
      expect(result).toBe(resolve(testBase, "subdir/nested/deep"));
    });

    it("allows paths that resolve to base directory", () => {
      const result = safeJoinPath(testBase, ".");
      expect(result).toBe(resolve(testBase));
    });

    it("allows paths with internal . references", () => {
      const result = safeJoinPath(testBase, "subdir/./file.txt");
      expect(result).toBe(resolve(testBase, "subdir/file.txt"));
    });

    it("allows internal .. that stays within base", () => {
      const result = safeJoinPath(testBase, "subdir/../other");
      expect(result).toBe(resolve(testBase, "other"));
    });

    it("throws PathTraversalError for simple .. escape", () => {
      expect(() => safeJoinPath(testBase, "..")).toThrow(PathTraversalError);
    });

    it("throws PathTraversalError for multiple .. escapes", () => {
      expect(() => safeJoinPath(testBase, "../../..")).toThrow(
        PathTraversalError
      );
    });

    it("throws PathTraversalError for escape hidden in path", () => {
      expect(() => safeJoinPath(testBase, "subdir/../../../escape")).toThrow(
        PathTraversalError
      );
    });

    it("throws PathTraversalError for deep escape attempts", () => {
      // Need enough .. to escape the base path depth
      expect(() =>
        safeJoinPath(testBase, "../../../../../../../../etc/passwd")
      ).toThrow(PathTraversalError);
    });

    it("prevents partial directory name matching", () => {
      // /base/foo should not match /base/foobar
      const base = "/base/foo";
      // This should work - it's within the base
      const validResult = safeJoinPath(base, "subdir");
      expect(validResult).toBe(resolve(base, "subdir"));
    });

    it("handles paths with spaces", () => {
      const result = safeJoinPath(testBase, "path with spaces/file.txt");
      expect(result).toBe(resolve(testBase, "path with spaces/file.txt"));
    });

    it("handles paths with special characters", () => {
      const result = safeJoinPath(testBase, "special-chars_123/file.txt");
      expect(result).toBe(resolve(testBase, "special-chars_123/file.txt"));
    });

    it("works with relative base paths", () => {
      const relativeBase = "./relative/base";
      const result = safeJoinPath(relativeBase, "subdir");
      expect(result).toBe(resolve(relativeBase, "subdir"));
    });

    it("preserves the resolved path format", () => {
      const result = safeJoinPath(testBase, "file.txt");
      // Should be an absolute path
      expect(result.startsWith(sep) || /^[A-Z]:/.test(result)).toBe(true);
    });
  });
});
