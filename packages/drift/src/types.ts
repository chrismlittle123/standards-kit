// Metadata schema for validating repo-metadata.yaml

export interface MetadataSchema {
  tiers?: string[];
  teams?: string[];
}

// Configuration

export interface DriftConfig {
  schema?: MetadataSchema;
  exclude?: string[]; // repo name patterns to exclude from org scanning
}

// Overall results

export interface DriftResults {
  path: string;
  timestamp: string;
}

// Organization scanning

export interface RepoScanResult {
  repo: string;
  results: DriftResults;
  missingProjects?: MissingProject[];
  tierValidation?: TierValidationResult;
  dependencyChanges?: DependencyChangesDetection;
  error?: string;
}

export interface OrgScanSummary {
  reposScanned: number;
  reposWithIssues: number;
  reposSkipped: number;
}

export interface OrgScanResults {
  org: string;
  configRepo: string;
  timestamp: string;
  repos: RepoScanResult[];
  summary: OrgScanSummary;
}

// GitHub issue creation

export interface DriftIssueResult {
  created: boolean;
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
}

// New project detection (projects missing standards.toml)

export interface MissingProject {
  path: string;
  type: string; // "typescript", "python", etc.
}

export interface MissingProjectsDetection {
  repository: string;
  scanTime: string;
  projects: MissingProject[];
}

// Tier validation (tier-ruleset alignment)

export interface TierValidationResult {
  valid: boolean;
  tier: string;
  rulesets: string[];
  expectedPattern: string;
  matchedRulesets: string[];
  error?: string;
}

export interface TierMismatchDetection {
  repository: string;
  scanTime: string;
  tier: string;
  rulesets: string[];
  expectedPattern: string;
  error: string;
}

// Dependency file changes detection

export interface DependencyFileChange {
  file: string;
  status: "added" | "modified" | "deleted";
  checkType: string | null;
  diff?: string;
}

export interface DependencyChangesDetection {
  repository: string;
  scanTime: string;
  commit: string;
  commitUrl: string;
  changes: DependencyFileChange[];
  byCheck: Record<string, DependencyFileChange[]>;
}

// Process violations detection

export interface ProcessCheckSummary {
  category: string;
  passed: number;
  failed: number;
}

export interface ProcessViolation {
  category: string;
  check: string;
  rule: string;
  message: string;
  severity: "error" | "warning";
  file?: string;
}

export interface ProcessViolationsDetection {
  repository: string;
  scanTime: string;
  summary: ProcessCheckSummary[];
  violations: ProcessViolation[];
}

// Org-wide process scanning

export interface ProcessRepoScanResult {
  repo: string;
  detection?: ProcessViolationsDetection;
  issueCreated?: boolean;
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
}

export interface ProcessOrgScanSummary {
  reposScanned: number;
  reposWithViolations: number;
  reposSkipped: number;
  issuesCreated: number;
}

export interface ProcessOrgScanResults {
  org: string;
  timestamp: string;
  repos: ProcessRepoScanResult[];
  summary: ProcessOrgScanSummary;
}

// Infrastructure drift detection

export interface InfraResourceResult {
  arn: string;
  exists: boolean;
  error?: string;
  service: string;
  resourceType: string;
  resourceId: string;
}

export interface InfraScanSummary {
  total: number;
  found: number;
  missing: number;
  errors: number;
}

export interface InfraDriftDetection {
  repository: string;
  scanTime: string;
  manifest: string;
  summary: InfraScanSummary;
  resources: InfraResourceResult[];
}

export interface InfraRepoScanResult {
  repo: string;
  detection?: InfraDriftDetection;
  issueCreated?: boolean;
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
}

export interface InfraOrgScanSummary {
  reposScanned: number;
  reposWithDrift: number;
  reposSkipped: number;
  issuesCreated: number;
}

export interface InfraOrgScanResults {
  org: string;
  timestamp: string;
  repos: InfraRepoScanResult[];
  summary: InfraOrgScanSummary;
}
