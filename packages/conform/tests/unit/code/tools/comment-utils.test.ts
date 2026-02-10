import { describe, it, expect } from "vitest";

import {
  KNOWN_EXTENSIONS,
  findFirstPattern,
  findBlockEnd,
  findCommentInLine,
} from "../../../../src/code/tools/comment-utils.js";

describe("KNOWN_EXTENSIONS", () => {
  it("contains expected extensions", () => {
    expect(KNOWN_EXTENSIONS.has("py")).toBe(true);
    expect(KNOWN_EXTENSIONS.has("ts")).toBe(true);
    expect(KNOWN_EXTENSIONS.has("tsx")).toBe(true);
    expect(KNOWN_EXTENSIONS.has("js")).toBe(true);
    expect(KNOWN_EXTENSIONS.has("jsx")).toBe(true);
  });

  it("does not contain unknown extensions", () => {
    expect(KNOWN_EXTENSIONS.has("rb")).toBe(false);
    expect(KNOWN_EXTENSIONS.has("go")).toBe(false);
  });
});

describe("findFirstPattern", () => {
  it("returns the first matching pattern", () => {
    expect(findFirstPattern("eslint-disable-next-line", ["eslint-disable", "tsc"])).toBe(
      "eslint-disable"
    );
  });

  it("returns null when no pattern matches", () => {
    expect(findFirstPattern("hello world", ["eslint", "tsc"])).toBeNull();
  });

  it("returns the first pattern in order when multiple match", () => {
    expect(findFirstPattern("eslint-disable eslint-enable", ["eslint-enable", "eslint-disable"])).toBe(
      "eslint-enable"
    );
  });

  it("handles empty patterns array", () => {
    expect(findFirstPattern("some text", [])).toBeNull();
  });

  it("handles empty text", () => {
    expect(findFirstPattern("", ["pattern"])).toBeNull();
  });
});

describe("findBlockEnd", () => {
  it("finds block comment end", () => {
    expect(findBlockEnd("/* hello */", 0)).toBe(11);
  });

  it("finds end after start index", () => {
    expect(findBlockEnd("/* */ */", 4)).toBe(8);
  });

  it("returns -1 when no end found", () => {
    expect(findBlockEnd("/* hello", 0)).toBe(-1);
  });

  it("returns position after */", () => {
    expect(findBlockEnd("text */", 0)).toBe(7);
  });
});

describe("findCommentInLine", () => {
  // JavaScript/TypeScript line comments
  it("finds // comment in JS", () => {
    const result = findCommentInLine("const x = 1; // comment", 0, false);
    expect(result).toEqual({ index: 13, isBlock: false });
  });

  it("finds /* block comment in JS", () => {
    const result = findCommentInLine("const x = 1; /* block */", 0, false);
    expect(result).toEqual({ index: 13, isBlock: true });
  });

  // Python comments
  it("finds # comment in Python", () => {
    const result = findCommentInLine("x = 1  # comment", 0, true);
    expect(result).toEqual({ index: 7, isBlock: false });
  });

  it("does not find // as comment in Python", () => {
    const result = findCommentInLine("x = 'http://example.com'", 0, true);
    expect(result).toBeNull();
  });

  // String boundaries
  it("ignores // inside double-quoted string", () => {
    const result = findCommentInLine('const x = "http://url"', 0, false);
    expect(result).toBeNull();
  });

  it("ignores // inside single-quoted string", () => {
    const result = findCommentInLine("const x = 'http://url'", 0, false);
    expect(result).toBeNull();
  });

  it("ignores // inside template literal", () => {
    const result = findCommentInLine("const x = `http://url`", 0, false);
    expect(result).toBeNull();
  });

  it("ignores # inside double-quoted string in Python", () => {
    const result = findCommentInLine('x = "color #red"', 0, true);
    expect(result).toBeNull();
  });

  it("ignores # inside single-quoted string in Python", () => {
    const result = findCommentInLine("x = 'color #red'", 0, true);
    expect(result).toBeNull();
  });

  it("finds comment after string ends", () => {
    const result = findCommentInLine('"hello" // comment', 0, false);
    expect(result).toEqual({ index: 8, isBlock: false });
  });

  it("returns null when no comment found", () => {
    const result = findCommentInLine("const x = 1;", 0, false);
    expect(result).toBeNull();
  });

  it("respects startPos parameter", () => {
    const result = findCommentInLine("const x = 1; // comment", 13, false);
    expect(result).toEqual({ index: 13, isBlock: false });
  });

  it("handles escaped quotes in strings", () => {
    const result = findCommentInLine('const x = "say \\"hello\\"" // comment', 0, false);
    expect(result).not.toBeNull();
    expect(result!.isBlock).toBe(false);
  });

  it("does not treat backtick as template in Python", () => {
    const result = findCommentInLine("x = `something` # comment", 0, true);
    expect(result).toEqual({ index: 16, isBlock: false });
  });
});
