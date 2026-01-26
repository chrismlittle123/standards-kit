export type Guideline = {
  id: string;
  title: string;
  category: string;
  priority: number;
  tags: string[];
  content: string;
};

export type Ruleset = {
  id: string;
  guidelines: string[];
};

export type Config = {
  ruleset: string;
};
