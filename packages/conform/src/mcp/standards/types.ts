/**
 * Type definitions for coding standards (guidelines and rulesets)
 */

/** YAML frontmatter from a guideline markdown file */
export interface GuidelineFrontmatter {
  id: string;
  title: string;
  category: string;
  priority: number;
  tags: string[];
}

/** Full guideline including frontmatter and markdown content */
export interface Guideline extends GuidelineFrontmatter {
  content: string;
}

/** Summary item for listing guidelines */
export interface GuidelineListItem {
  id: string;
  title: string;
  tags: string[];
  category: string;
}

/** Guideline with match score for smart matching */
export interface MatchedGuideline {
  guideline: Guideline;
  score: number;
}

/** Ruleset metadata */
export interface Ruleset {
  id: string;
  content: string;
}
