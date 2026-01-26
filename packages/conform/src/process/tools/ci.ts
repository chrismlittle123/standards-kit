/* eslint-disable max-lines -- CI workflow validation requires comprehensive coverage of jobs, actions, and commands */
import * as yaml from "js-yaml";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";

/** Commands configuration value - workflow-level or job-level */
type CommandsValue = string[] | Record<string, string[]>;

/** CI configuration from standards.toml */
interface CiConfig {
  enabled?: boolean;
  require_workflows?: string[];
  jobs?: Record<string, string[]>;
  actions?: Record<string, string[]>;
  commands?: Record<string, CommandsValue>;
}

/** Parsed GitHub Actions workflow structure */
interface WorkflowFile {
  on?: WorkflowTriggers;
  jobs?: Record<string, WorkflowJob>;
}

/** Workflow triggers - can be string, array, or object */
type WorkflowTriggers =
  | string
  | string[]
  | {
      pull_request?: TriggerConfig;
      pull_request_target?: TriggerConfig;
      push?: TriggerConfig;
      [key: string]: unknown;
    };

interface TriggerConfig {
  branches?: string[];
}

interface WorkflowJob {
  if?: string | boolean; // GitHub Actions allows boolean literals
  steps?: WorkflowStep[];
  uses?: string; // Reusable workflow reference
}

interface WorkflowStep {
  if?: string | boolean; // GitHub Actions allows boolean literals
  run?: string;
  uses?: string;
}

/** Result of searching for a command in a workflow */
interface CommandSearchResult {
  found: boolean;
  conditional: boolean;
  conditionExpression?: string | boolean;
  commentedOut: boolean;
}

/**
 * CI/CD workflow validation runner.
 * Checks that GitHub Actions workflows exist and contain required jobs/actions/commands.
 */
export class CiRunner extends BaseProcessToolRunner {
  readonly name = "CI";
  readonly rule = "process.ci";
  readonly toolId = "ci";

  private config: CiConfig = {
    enabled: false,
  };

  setConfig(config: CiConfig): void {
    this.config = { ...this.config, ...config };
  }

  private checkWorkflowsDirectory(projectRoot: string): Violation | null {
    if (this.directoryExists(projectRoot, ".github/workflows")) {
      return null;
    }
    return {
      rule: `${this.rule}.directory`,
      tool: this.toolId,
      message: "GitHub workflows directory not found (.github/workflows/)",
      severity: "error",
    };
  }

  private checkRequiredWorkflows(projectRoot: string): Violation[] {
    const workflows = this.config.require_workflows ?? [];
    return workflows
      .filter((workflow) => !this.fileExists(projectRoot, `.github/workflows/${workflow}`))
      .map((workflow) => ({
        rule: `${this.rule}.workflow`,
        tool: this.toolId,
        file: `.github/workflows/${workflow}`,
        message: `Required workflow '${workflow}' not found`,
        severity: "error" as const,
      }));
  }

  private parseWorkflow(
    projectRoot: string,
    workflowFile: string
  ): { workflow: WorkflowFile | null; parseError?: string } {
    const content = this.readFile(projectRoot, `.github/workflows/${workflowFile}`);
    if (content === null) {
      return { workflow: null };
    }
    try {
      return { workflow: yaml.load(content) as WorkflowFile };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown YAML parse error";
      return { workflow: null, parseError: message };
    }
  }

  private triggersPRToMain(workflow: WorkflowFile): boolean {
    const triggers = workflow.on;
    if (!triggers) {
      return false;
    }

    if (typeof triggers === "string") {
      return ["pull_request", "pull_request_target", "push"].includes(triggers);
    }

    if (Array.isArray(triggers)) {
      return triggers.some((t) => ["pull_request", "pull_request_target", "push"].includes(t));
    }

    const checkBranches = (config: TriggerConfig | undefined): boolean => {
      if (!config) {
        return false;
      }
      const branches = config.branches;
      if (!branches || branches.length === 0) {
        return true;
      }
      return branches.some((b) => ["main", "master", "*"].includes(b));
    };

    return (
      checkBranches(triggers.pull_request as TriggerConfig) ||
      checkBranches(triggers.pull_request_target as TriggerConfig) ||
      checkBranches(triggers.push as TriggerConfig)
    );
  }

  private isUnconditionalExpression(expression: string | boolean | undefined): boolean {
    if (expression === undefined) {
      return true;
    }
    // Handle boolean values (YAML parses `if: true` as boolean)
    if (typeof expression === "boolean") {
      return expression;
    }
    const expr = String(expression).trim().toLowerCase();
    return ["true", "success()", "always()"].includes(expr);
  }

  private extractRunCommands(runContent: string): string[] {
    return runContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  }

  private commandMatches(actual: string, required: string): boolean {
    return actual.includes(required);
  }

  /** Check if run content has a commented version of the command */
  private hasCommentedCommand(runContent: string, command: string): boolean {
    return runContent
      .split("\n")
      .some((line) => line.trim().startsWith("#") && this.commandMatches(line, command));
  }

  /** Search for a command in a single step */
  private searchCommandInStep(
    step: WorkflowStep,
    requiredCommand: string,
    jobConditional: boolean,
    jobCondition: string | boolean | undefined
  ): CommandSearchResult | null {
    if (!step.run) {
      return null;
    }

    const commentedOut = this.hasCommentedCommand(step.run, requiredCommand);
    const commands = this.extractRunCommands(step.run);
    const found = commands.some((cmd) => this.commandMatches(cmd, requiredCommand));

    if (!found) {
      return commentedOut ? { found: false, conditional: false, commentedOut: true } : null;
    }

    const stepConditional = !this.isUnconditionalExpression(step.if);
    const conditional = jobConditional || stepConditional;
    const conditionExpression = jobConditional ? jobCondition : step.if;

    return { found: true, conditional, conditionExpression, commentedOut };
  }

  private searchCommandInJob(job: WorkflowJob, requiredCommand: string): CommandSearchResult {
    const jobConditional = !this.isUnconditionalExpression(job.if);
    let commentedOut = false;

    for (const step of job.steps ?? []) {
      const result = this.searchCommandInStep(step, requiredCommand, jobConditional, job.if);
      if (result?.commentedOut) {
        commentedOut = true;
      }
      if (result?.found) {
        return result;
      }
    }

    return { found: false, conditional: false, commentedOut };
  }

  private searchCommandInWorkflow(
    workflow: WorkflowFile,
    requiredCommand: string
  ): CommandSearchResult {
    let commentedOut = false;
    let conditionalResult: CommandSearchResult | null = null;

    for (const job of Object.values(workflow.jobs ?? {})) {
      if (job.uses) {
        continue;
      }
      const result = this.searchCommandInJob(job, requiredCommand);
      if (result.commentedOut) {
        commentedOut = true;
      }
      if (result.found && !result.conditional) {
        return result;
      }
      if (result.found && !conditionalResult) {
        conditionalResult = result;
      }
    }
    return conditionalResult ?? { found: false, conditional: false, commentedOut };
  }

  private cmdViolation(workflowFile: string, msg: string): Violation {
    return {
      rule: `${this.rule}.commands`,
      tool: this.toolId,
      file: `.github/workflows/${workflowFile}`,
      message: msg,
      severity: "error",
    };
  }

  private workflowCmdViolation(wf: string, cmd: string, r: CommandSearchResult): Violation | null {
    if (!r.found && r.commentedOut) {
      return this.cmdViolation(wf, `Command '${cmd}' appears commented out in workflow '${wf}'`);
    }
    if (!r.found) {
      return this.cmdViolation(wf, `Required command '${cmd}' not found in workflow '${wf}'`);
    }
    if (r.conditional) {
      return this.cmdViolation(
        wf,
        `Command '${cmd}' in workflow '${wf}' may not execute on PRs (has condition: ${r.conditionExpression})`
      );
    }
    return null;
  }

  private jobCmdViolation(
    wf: string,
    jobId: string,
    cmd: string,
    r: CommandSearchResult
  ): Violation | null {
    if (!r.found && r.commentedOut) {
      return this.cmdViolation(
        wf,
        `Command '${cmd}' appears commented out in job '${jobId}' of workflow '${wf}'`
      );
    }
    if (!r.found) {
      return this.cmdViolation(
        wf,
        `Required command '${cmd}' not found in job '${jobId}' of workflow '${wf}'`
      );
    }
    if (r.conditional) {
      return this.cmdViolation(
        wf,
        `Command '${cmd}' in job '${jobId}' of workflow '${wf}' may not execute on PRs (has condition: ${r.conditionExpression})`
      );
    }
    return null;
  }

  private checkWorkflowLevelCommands(
    workflow: WorkflowFile,
    wf: string,
    commands: string[]
  ): Violation[] {
    return commands
      .map((cmd) => this.workflowCmdViolation(wf, cmd, this.searchCommandInWorkflow(workflow, cmd)))
      .filter((v): v is Violation => v !== null);
  }

  private checkJobLevelCommands(
    workflow: WorkflowFile,
    wf: string,
    jobCommands: Record<string, string[]>
  ): Violation[] {
    const violations: Violation[] = [];
    for (const [jobId, commands] of Object.entries(jobCommands)) {
      const job = workflow.jobs?.[jobId];
      if (!job) {
        violations.push(this.cmdViolation(wf, `Job '${jobId}' not found in workflow '${wf}'`));
        continue;
      }
      if (job.uses) {
        violations.push(
          this.cmdViolation(
            wf,
            `Job '${jobId}' in workflow '${wf}' uses a reusable workflow - command validation not supported`
          )
        );
        continue;
      }
      for (const cmd of commands) {
        const v = this.jobCmdViolation(wf, jobId, cmd, this.searchCommandInJob(job, cmd));
        if (v) {
          violations.push(v);
        }
      }
    }
    return violations;
  }

  private yamlErrorViolation(wf: string, parseError: string): Violation {
    return {
      rule: `${this.rule}.yaml`,
      tool: this.toolId,
      file: `.github/workflows/${wf}`,
      message: `Invalid YAML in workflow '${wf}': ${parseError}`,
      severity: "error",
    };
  }

  private checkWorkflowCommands(projectRoot: string): Violation[] {
    const violations: Violation[] = [];
    for (const [wf, commandsValue] of Object.entries(this.config.commands ?? {})) {
      const { workflow, parseError } = this.parseWorkflow(projectRoot, wf);
      if (parseError) {
        violations.push(this.yamlErrorViolation(wf, parseError));
        continue;
      }
      if (!workflow) {
        violations.push({
          rule: `${this.rule}.commands`,
          tool: this.toolId,
          file: `.github/workflows/${wf}`,
          message: `Workflow file '${wf}' not found`,
          severity: "error",
        });
        continue;
      }
      if (!this.triggersPRToMain(workflow)) {
        violations.push(
          this.cmdViolation(wf, `Workflow '${wf}' does not trigger on pull_request to main/master`)
        );
        continue;
      }
      violations.push(
        ...(Array.isArray(commandsValue)
          ? this.checkWorkflowLevelCommands(workflow, wf, commandsValue)
          : this.checkJobLevelCommands(workflow, wf, commandsValue))
      );
    }
    return violations;
  }

  private checkRequiredJobs(projectRoot: string): Violation[] {
    const violations: Violation[] = [];
    for (const [workflowFile, requiredJobs] of Object.entries(this.config.jobs ?? {})) {
      const { workflow, parseError } = this.parseWorkflow(projectRoot, workflowFile);
      if (parseError) {
        violations.push(this.yamlErrorViolation(workflowFile, parseError));
        continue;
      }
      if (!workflow) {
        continue;
      }
      const existingJobs = Object.keys(workflow.jobs ?? {});
      for (const job of requiredJobs.filter((j) => !existingJobs.includes(j))) {
        violations.push({
          rule: `${this.rule}.jobs`,
          tool: this.toolId,
          file: `.github/workflows/${workflowFile}`,
          message: `Workflow '${workflowFile}' missing required job: ${job}`,
          severity: "error",
        });
      }
    }
    return violations;
  }

  /**
   * Parse a GitHub Actions reference to extract the action name.
   * Handles:
   * - Standard refs: "actions/checkout@v4" -> "actions/checkout"
   * - SHA refs: "actions/checkout@abc123" -> "actions/checkout"
   * - Local actions: "./path/to/action" -> "./path/to/action"
   * - Docker actions: "docker://image:tag" -> null (excluded)
   */
  private parseActionReference(uses: string): string | null {
    // Skip Docker actions - they're container images, not GitHub Actions
    if (uses.startsWith("docker://")) {
      return null;
    }

    // Local actions don't have version tags
    if (uses.startsWith("./") || uses.startsWith("../")) {
      return uses;
    }

    // Standard GitHub Actions: extract name before @ version tag
    const atIndex = uses.indexOf("@");
    return atIndex > 0 ? uses.slice(0, atIndex) : uses;
  }

  private extractUsedActions(workflow: WorkflowFile): string[] {
    return Object.values(workflow.jobs ?? {}).flatMap((job) =>
      (job.steps ?? [])
        .map((s) => (s.uses ? this.parseActionReference(s.uses) : null))
        .filter((u): u is string => u !== null)
    );
  }

  private checkRequiredActions(projectRoot: string): Violation[] {
    const violations: Violation[] = [];
    for (const [workflowFile, requiredActions] of Object.entries(this.config.actions ?? {})) {
      const { workflow, parseError } = this.parseWorkflow(projectRoot, workflowFile);
      if (parseError) {
        violations.push(this.yamlErrorViolation(workflowFile, parseError));
        continue;
      }
      if (!workflow) {
        continue;
      }
      const usedActions = this.extractUsedActions(workflow);
      for (const action of requiredActions.filter((a) => !usedActions.includes(a))) {
        violations.push({
          rule: `${this.rule}.actions`,
          tool: this.toolId,
          file: `.github/workflows/${workflowFile}`,
          message: `Workflow '${workflowFile}' missing required action: ${action}`,
          severity: "error",
        });
      }
    }
    return violations;
  }

  async run(projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    const directoryViolation = this.checkWorkflowsDirectory(projectRoot);
    if (directoryViolation) {
      return this.fromViolations([directoryViolation], elapsed());
    }

    const violations = [
      ...this.checkRequiredWorkflows(projectRoot),
      ...this.checkRequiredJobs(projectRoot),
      ...this.checkRequiredActions(projectRoot),
      ...this.checkWorkflowCommands(projectRoot),
    ];

    return this.fromViolations(violations, elapsed());
  }
}
