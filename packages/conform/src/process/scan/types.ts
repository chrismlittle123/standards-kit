import { type CheckResult, type Violation } from "../../core/index.js";

/** Repository identifier in owner/repo format */
export interface RemoteRepoInfo {
  owner: string;
  repo: string;
}

/** Options for the scan command */
export interface ScanOptions {
  repo: string; // owner/repo format
  config?: string;
  format: "text" | "json";
}

/** File check configuration */
export interface FileCheckConfig {
  path: string;
  alternativePaths?: string[];
  required: boolean;
  description: string;
}

/** Result of checking a single file */
export interface FileCheckResult {
  path: string;
  exists: boolean;
  checkedPaths: string[];
}

/** Result of the remote scan */
export interface ScanResult {
  repoInfo: RemoteRepoInfo;
  checks: CheckResult[];
  violations: Violation[];
  passed: boolean;
  summary: {
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    skippedChecks: number;
  };
}

/** Options for the validateProcess programmatic API */
export interface ValidateProcessOptions {
  repo: string; // owner/repo format
  config?: string;
}

/** Programmatic API result matching conform process check output */
export interface ValidateProcessResult {
  version: string;
  repoInfo: RemoteRepoInfo;
  domain: "process";
  checks: CheckResult[];
  summary: {
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    totalViolations: number;
    exitCode: number;
  };
}
