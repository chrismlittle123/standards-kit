import { type Config } from "../core/index.js";
import { type CheckResult, type DomainResult, DomainResultBuilder, type IToolRunner } from "../core/index.js";
import {
  BackupsRunner,
  BranchesRunner,
  ChangesetsRunner,
  CiRunner,
  CodeownersRunner,
  CommitsRunner,
  CoverageRunner,
  DocsRunner,
  ForbiddenFilesRunner,
  HooksRunner,
  PrRunner,
  RepoRunner,
  TicketsRunner,
} from "./tools/index.js";

// Export tool runners for direct access
export { HooksRunner } from "./tools/index.js";

/** Tool configuration entry mapping config getter to runner or runner factory */
interface ToolEntry {
  isEnabled: (config: Config) => boolean;
  runner: IToolRunner | ((config: Config) => IToolRunner);
}

/** Check if a tool is enabled in config */
function isEnabled(toolConfig: { enabled?: boolean } | undefined): boolean {
  return toolConfig?.enabled === true;
}

/** Create a configured HooksRunner */
function createHooksRunner(config: Config): HooksRunner {
  const runner = new HooksRunner();
  const hooksConfig = config.process?.hooks;
  if (hooksConfig) {
    runner.setConfig({
      enabled: hooksConfig.enabled,
      require_husky: hooksConfig.require_husky,
      require_hooks: hooksConfig.require_hooks,
      commands: hooksConfig.commands,
      protected_branches: hooksConfig.protected_branches,
    });
  }
  return runner;
}

/** Create a configured CiRunner */
function createCiRunner(config: Config): CiRunner {
  const runner = new CiRunner();
  const ciConfig = config.process?.ci;
  if (ciConfig) {
    runner.setConfig({
      enabled: ciConfig.enabled,
      require_workflows: ciConfig.require_workflows,
      jobs: ciConfig.jobs,
      actions: ciConfig.actions,
      commands: ciConfig.commands,
    });
  }
  return runner;
}

/** Create a configured BranchesRunner */
function createBranchesRunner(config: Config): BranchesRunner {
  const runner = new BranchesRunner();
  const branchesConfig = config.process?.branches;
  if (branchesConfig) {
    runner.setConfig({
      enabled: branchesConfig.enabled,
      pattern: branchesConfig.pattern,
      exclude: branchesConfig.exclude,
      require_issue: branchesConfig.require_issue,
      issue_pattern: branchesConfig.issue_pattern,
    });
  }
  return runner;
}

/** Create a configured CommitsRunner */
function createCommitsRunner(config: Config): CommitsRunner {
  const runner = new CommitsRunner();
  const commitsConfig = config.process?.commits;
  if (commitsConfig) {
    runner.setConfig({
      enabled: commitsConfig.enabled,
      pattern: commitsConfig.pattern,
      types: commitsConfig.types,
      require_scope: commitsConfig.require_scope,
      max_subject_length: commitsConfig.max_subject_length,
    });
  }
  return runner;
}

/** Create a configured ChangesetsRunner */
function createChangesetsRunner(config: Config): ChangesetsRunner {
  const runner = new ChangesetsRunner();
  const changesetsConfig = config.process?.changesets;
  if (changesetsConfig) {
    runner.setConfig({
      enabled: changesetsConfig.enabled,
      require_for_paths: changesetsConfig.require_for_paths,
      exclude_paths: changesetsConfig.exclude_paths,
      validate_format: changesetsConfig.validate_format,
      allowed_bump_types: changesetsConfig.allowed_bump_types,
      require_description: changesetsConfig.require_description,
      min_description_length: changesetsConfig.min_description_length,
    });
  }
  return runner;
}

/** Create a configured PrRunner */
function createPrRunner(config: Config): PrRunner {
  const runner = new PrRunner();
  const prConfig = config.process?.pr;
  if (prConfig) {
    runner.setConfig({
      enabled: prConfig.enabled,
      max_files: prConfig.max_files,
      max_lines: prConfig.max_lines,
      require_issue: prConfig.require_issue,
      issue_keywords: prConfig.issue_keywords,
    });
  }
  return runner;
}

/** Create a configured TicketsRunner */
function createTicketsRunner(config: Config): TicketsRunner {
  const runner = new TicketsRunner();
  const ticketsConfig = config.process?.tickets;
  if (ticketsConfig) {
    runner.setConfig({
      enabled: ticketsConfig.enabled,
      pattern: ticketsConfig.pattern,
      require_in_commits: ticketsConfig.require_in_commits,
      require_in_branch: ticketsConfig.require_in_branch,
    });
  }
  return runner;
}

/** Create a configured CoverageRunner */
function createCoverageRunner(config: Config): CoverageRunner {
  const runner = new CoverageRunner();
  const coverageConfig = config.process?.coverage;
  if (coverageConfig) {
    runner.setConfig({
      enabled: coverageConfig.enabled,
      min_threshold: coverageConfig.min_threshold,
      enforce_in: coverageConfig.enforce_in,
      ci_workflow: coverageConfig.ci_workflow,
      ci_job: coverageConfig.ci_job,
    });
  }
  return runner;
}

/** Create a configured RepoRunner */
function createRepoRunner(config: Config): RepoRunner {
  const runner = new RepoRunner();
  const repoConfig = config.process?.repo;
  if (repoConfig) {
    runner.setConfig({
      enabled: repoConfig.enabled,
      require_branch_protection: repoConfig.require_branch_protection,
      require_codeowners: repoConfig.require_codeowners,
      ruleset: repoConfig.ruleset,
      tag_protection: repoConfig.tag_protection,
    });
  }
  return runner;
}

/** Create a configured BackupsRunner */
function createBackupsRunner(config: Config): BackupsRunner {
  const runner = new BackupsRunner();
  const backupsConfig = config.process?.backups;
  if (backupsConfig) {
    runner.setConfig({
      enabled: backupsConfig.enabled,
      bucket: backupsConfig.bucket,
      prefix: backupsConfig.prefix,
      max_age_hours: backupsConfig.max_age_hours,
      region: backupsConfig.region,
    });
  }
  return runner;
}

/** Create a configured CodeownersRunner */
function createCodeownersRunner(config: Config): CodeownersRunner {
  const runner = new CodeownersRunner();
  const codeownersConfig = config.process?.codeowners;
  if (codeownersConfig) {
    runner.setConfig({
      enabled: codeownersConfig.enabled,
      rules: codeownersConfig.rules,
    });
  }
  return runner;
}

/** Create a configured DocsRunner */
function createDocsRunner(config: Config): DocsRunner {
  const runner = new DocsRunner();
  const docsConfig = config.process?.docs;
  if (docsConfig) {
    runner.setConfig({
      enabled: docsConfig.enabled,
      path: docsConfig.path,
      enforcement: docsConfig.enforcement,
      allowlist: docsConfig.allowlist,
      max_files: docsConfig.max_files,
      max_file_lines: docsConfig.max_file_lines,
      max_total_kb: docsConfig.max_total_kb,
      staleness_days: docsConfig.staleness_days,
      stale_mappings: docsConfig.stale_mappings,
      min_coverage: docsConfig.min_coverage,
      coverage_paths: docsConfig.coverage_paths,
      exclude_patterns: docsConfig.exclude_patterns,
      types: docsConfig.types,
    });
  }
  return runner;
}

/** Create a configured ForbiddenFilesRunner */
function createForbiddenFilesRunner(config: Config): ForbiddenFilesRunner {
  const runner = new ForbiddenFilesRunner();
  const forbiddenFilesConfig = config.process?.forbidden_files;
  if (forbiddenFilesConfig) {
    runner.setConfig({
      enabled: forbiddenFilesConfig.enabled,
      files: forbiddenFilesConfig.files,
      ignore: forbiddenFilesConfig.ignore,
      message: forbiddenFilesConfig.message,
    });
  }
  return runner;
}

/** All available process tools with their config predicates */
const toolRegistry: ToolEntry[] = [
  { isEnabled: (c) => isEnabled(c.process?.hooks), runner: createHooksRunner },
  { isEnabled: (c) => isEnabled(c.process?.ci), runner: createCiRunner },
  { isEnabled: (c) => isEnabled(c.process?.branches), runner: createBranchesRunner },
  { isEnabled: (c) => isEnabled(c.process?.commits), runner: createCommitsRunner },
  { isEnabled: (c) => isEnabled(c.process?.changesets), runner: createChangesetsRunner },
  { isEnabled: (c) => isEnabled(c.process?.pr), runner: createPrRunner },
  { isEnabled: (c) => isEnabled(c.process?.tickets), runner: createTicketsRunner },
  { isEnabled: (c) => isEnabled(c.process?.coverage), runner: createCoverageRunner },
  { isEnabled: (c) => isEnabled(c.process?.repo), runner: createRepoRunner },
  { isEnabled: (c) => isEnabled(c.process?.backups), runner: createBackupsRunner },
  { isEnabled: (c) => isEnabled(c.process?.codeowners), runner: createCodeownersRunner },
  { isEnabled: (c) => isEnabled(c.process?.docs), runner: createDocsRunner },
  { isEnabled: (c) => isEnabled(c.process?.forbidden_files), runner: createForbiddenFilesRunner },
];

/**
 * Get enabled tools based on configuration
 */
function getEnabledTools(config: Config): IToolRunner[] {
  return toolRegistry
    .filter((entry) => entry.isEnabled(config))
    .map((entry) => (typeof entry.runner === "function" ? entry.runner(config) : entry.runner));
}

/**
 * Run all process checks based on configuration
 */
export async function runProcessChecks(projectRoot: string, config: Config): Promise<DomainResult> {
  const tools = getEnabledTools(config);
  const checks = await runTools(tools, projectRoot, "run");
  return DomainResultBuilder.fromChecks("process", checks);
}

/**
 * Audit process configuration (check that configs exist without running tools)
 */
export async function auditProcessConfig(
  projectRoot: string,
  config: Config
): Promise<DomainResult> {
  const tools = getEnabledTools(config);
  const checks = await runTools(tools, projectRoot, "audit");
  return DomainResultBuilder.fromChecks("process", checks);
}

/**
 * Run tools in parallel with error isolation
 * Uses Promise.allSettled to ensure one failing tool doesn't lose all results
 */
async function runTools(
  tools: IToolRunner[],
  projectRoot: string,
  mode: "run" | "audit"
): Promise<CheckResult[]> {
  const promises = tools.map((tool) =>
    mode === "run" ? tool.run(projectRoot) : tool.audit(projectRoot)
  );

  const results = await Promise.allSettled(promises);

  return results.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    // Handle rejected promise - create error result for the tool
    const tool = tools[index];
    const errorMessage = result.reason instanceof Error ? result.reason.message : "Unknown error";

    return {
      name: tool.name,
      rule: tool.rule,
      passed: false,
      violations: [
        {
          rule: tool.rule,
          tool: tool.toolId,
          message: `Tool error: ${errorMessage}`,
          severity: "error" as const,
        },
      ],
      skipped: false,
      duration: 0,
    };
  });
}
