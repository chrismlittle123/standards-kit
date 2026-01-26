/**
 * Smart keyword matching logic for guidelines
 */
import { type Guideline, type MatchedGuideline } from "./types.js";

/**
 * Parse a context string into keywords.
 * Extracts words, lowercases them, and removes duplicates.
 */
export function parseContext(context: string): string[] {
  const words = context
    .toLowerCase()
    .split(/[\s,.\-_/]+/)
    .filter((word) => word.length > 1);

  return [...new Set(words)];
}

/**
 * Score a guideline based on how many keywords match its tags.
 */
export function scoreGuideline(guideline: Guideline, keywords: string[]): number {
  const tags = new Set(guideline.tags.map((t) => t.toLowerCase()));
  let score = 0;

  for (const keyword of keywords) {
    if (tags.has(keyword)) {
      score++;
    }
  }

  // Also check if keyword appears in category or id
  const category = guideline.category.toLowerCase();
  const id = guideline.id.toLowerCase();

  for (const keyword of keywords) {
    if (category.includes(keyword) || id.includes(keyword)) {
      score += 0.5; // Partial match bonus
    }
  }

  return score;
}

/**
 * Match guidelines against a context string.
 * Returns guidelines sorted by score (descending) then priority (ascending).
 */
export function matchGuidelines(
  guidelines: Guideline[],
  context: string,
  limit?: number
): MatchedGuideline[] {
  const keywords = parseContext(context);

  if (keywords.length === 0) {
    return [];
  }

  const scored = guidelines
    .map((guideline) => ({
      guideline,
      score: scoreGuideline(guideline, keywords),
    }))
    .filter((m) => m.score > 0);

  // Sort by score descending, then by priority ascending
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.guideline.priority - b.guideline.priority;
  });

  return limit ? scored.slice(0, limit) : scored;
}

/**
 * Compose matched guidelines into a single markdown document.
 */
export function composeGuidelines(matches: MatchedGuideline[]): string {
  if (matches.length === 0) {
    return "No matching guidelines found for the given context.";
  }

  const sections = matches.map((m) => {
    const { guideline } = m;
    return `# ${guideline.title}\n\n**Category:** ${guideline.category} | **Priority:** ${guideline.priority}\n**Tags:** ${guideline.tags.join(", ")}\n\n${guideline.content}`;
  });

  return sections.join("\n\n---\n\n");
}
