/** Quote state for tracking string contexts */
interface QuoteState {
  single: boolean;
  double: boolean;
  template: boolean;
}

/** File extensions with known comment syntax */
export const KNOWN_EXTENSIONS = new Set(["py", "ts", "tsx", "js", "jsx"]);

/**
 * Check if a character at the given index starts a block comment.
 */
function isBlockCommentStart(line: string, index: number): boolean {
  return line[index] === "/" && line[index + 1] === "*";
}

/**
 * Check if a character at the given index starts a line comment.
 */
function isLineCommentStart(line: string, index: number): boolean {
  return line[index] === "/" && line[index + 1] === "/";
}

/**
 * Find the first pattern that appears in the given text range.
 */
export function findFirstPattern(text: string, patterns: string[]): string | null {
  for (const pattern of patterns) {
    if (text.includes(pattern)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Find where a block comment ends in a line. Returns -1 if not found.
 */
export function findBlockEnd(line: string, startIndex: number): number {
  const idx = line.indexOf("*/", startIndex);
  return idx === -1 ? -1 : idx + 2;
}

/**
 * Check if a quote character can be toggled given current state.
 */
function canToggle(char: string, target: string, state: QuoteState, isPython: boolean): boolean {
  if (char !== target) {
    return false;
  }
  if (target === "'") {
    return !state.double && !state.template;
  }
  if (target === '"') {
    return !state.single && !state.template;
  }
  return !isPython && !state.single && !state.double; // backtick
}

/**
 * Update quote state based on current character.
 */
function updateQuotes(char: string, prev: string, state: QuoteState, isPython: boolean): void {
  if (prev === "\\") {
    return;
  }
  if (canToggle(char, "'", state, isPython)) {
    state.single = !state.single;
  } else if (canToggle(char, '"', state, isPython)) {
    state.double = !state.double;
  } else if (canToggle(char, "`", state, isPython)) {
    state.template = !state.template;
  }
}

/**
 * Check if currently inside a string based on quote state.
 */
function inString(state: QuoteState): boolean {
  return state.single || state.double || state.template;
}

/**
 * Check for comment marker at position, return type or null.
 */
function getCommentAt(line: string, i: number, isPython: boolean): { isBlock: boolean } | null {
  if (isPython) {
    return line[i] === "#" ? { isBlock: false } : null;
  }
  if (isLineCommentStart(line, i)) {
    return { isBlock: false };
  }
  if (isBlockCommentStart(line, i)) {
    return { isBlock: true };
  }
  return null;
}

/**
 * Build quote state for a line up to the given position.
 */
function buildQuoteState(line: string, endPos: number, isPython: boolean): QuoteState {
  const quotes: QuoteState = { single: false, double: false, template: false };
  for (let i = 0; i < endPos; i++) {
    updateQuotes(line[i], line[i - 1] || "", quotes, isPython);
  }
  return quotes;
}

/**
 * Find comment start in a line, respecting string boundaries.
 */
export function findCommentInLine(
  line: string,
  startPos: number,
  isPython: boolean
): { index: number; isBlock: boolean } | null {
  const quotes = buildQuoteState(line, startPos, isPython);

  for (let i = startPos; i < line.length; i++) {
    updateQuotes(line[i], line[i - 1] || "", quotes, isPython);
    if (inString(quotes)) {
      continue;
    }

    const comment = getCommentAt(line, i, isPython);
    if (comment) {
      return { index: i, isBlock: comment.isBlock };
    }
  }

  return null;
}
