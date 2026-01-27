import { getProjectRoot, loadConfig } from "../../core/index.js";
import { ApplierError, applyBranchProtection, applyTagProtection } from "./applier.js";
import { computeDiff, computeTagDiff, formatValue } from "./differ.js";
import {
  fetchBranchProtection,
  FetcherError,
  fetchTagProtection,
  getRepoInfo,
  isGhAvailable,
} from "./fetcher.js";
import {
  type SyncDiffResult,
  type SyncOptions,
  type SyncResult,
  type TagProtectionDiffResult,
} from "./types.js";

/** Helper to write to stdout */
function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

/** Run diff command - show what would change */
export async function runDiff(options: SyncOptions): Promise<void> {
  try {
    const diffResult = await getDiffResult(options);
    outputDiff(diffResult, options.format);
    process.exit(diffResult.hasChanges ? 1 : 0);
  } catch (error) {
    handleError(error, options.format);
  }
}

/** Run sync command - apply changes (or preview if --apply not set) */
 
export async function runSync(options: SyncOptions): Promise<void> {
  try {
    const diffResult = await getDiffResult(options);

    if (!diffResult.hasChanges) {
      outputNoChanges(diffResult, options.format);
      process.exit(0);
    }

    // Validate actors if requested
    if (options.validateActors) {
      const validationPassed = await validateActorsBeforeApply(options);
      if (!validationPassed) {
        process.exit(1);
      }
    }

    if (!options.apply) {
      outputPreview(diffResult, options.format);
      process.exit(0);
    }

    const result = await applyChanges(options, diffResult);
    outputSyncResult(diffResult, result, options.format);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    handleError(error, options.format);
  }
}

/** Apply changes to GitHub */
async function applyChanges(options: SyncOptions, diffResult: SyncDiffResult): Promise<SyncResult> {
  const { config } = loadConfig(options.config);
  const projectRoot = getProjectRoot(loadConfig(options.config).configPath);
  const repoInfo = await getRepoInfo(projectRoot);
  const desired = config.process?.repo?.ruleset ?? {};

  return applyBranchProtection(repoInfo, diffResult.branch, desired, diffResult);
}

/** Validate bypass actors before applying changes */
async function validateActorsBeforeApply(options: SyncOptions): Promise<boolean> {
  const { validateBypassActors, formatValidationResult } = await import("./validator.js");
  const { config } = loadConfig(options.config);
  const projectRoot = getProjectRoot(loadConfig(options.config).configPath);
  const repoInfo = await getRepoInfo(projectRoot);

  const rulesetConfig = config.process?.repo?.ruleset;
  const actors = rulesetConfig?.bypass_actors ?? [];

  if (actors.length === 0) {
    return true;
  }

  const result = await validateBypassActors(repoInfo, actors);

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatValidationResult(result)}\n`);
  }

  return result.valid;
}

/** Get the diff result (shared by diff and sync) */
async function getDiffResult(options: SyncOptions): Promise<SyncDiffResult> {
  if (!(await isGhAvailable())) {
    throw new FetcherError("GitHub CLI (gh) not available", "NO_GH");
  }

  const { config, configPath } = loadConfig(options.config);
  const projectRoot = getProjectRoot(configPath);
  const repoInfo = await getRepoInfo(projectRoot);

  const repoConfig = config.process?.repo;
  const desired = repoConfig?.ruleset;
  if (!desired) {
    throw new Error("No [process.repo.ruleset] configured in standards.toml");
  }
  const branch = getBranch(desired.branch);
  const current = await fetchBranchProtection(repoInfo, branch);

  return computeDiff(repoInfo, current, desired);
}

/** Get branch name with default */
function getBranch(configuredBranch: string | undefined): string {
  return configuredBranch ?? "main";
}

/** Output diff result */
function outputDiff(result: SyncDiffResult, format: "text" | "json"): void {
  if (format === "json") {
    writeLine(JSON.stringify(result, null, 2));
  } else {
    outputDiffText(result);
  }
}

/** Output diff in text format */
function outputDiffText(result: SyncDiffResult): void {
  writeRepoHeader(result);

  if (!result.hasChanges) {
    writeLine("No changes needed. Settings match configuration.");
    return;
  }

  writeDiffTable(result);
  writeLine("");
  writeLine(
    `${result.diffs.length} setting(s) differ. Run 'conform process sync --apply' to apply changes.`
  );
}

/** Write repository header */
function writeRepoHeader(result: SyncDiffResult): void {
  writeLine(`Repository: ${result.repoInfo.owner}/${result.repoInfo.repo}`);
  writeLine(`Branch: ${result.branch}`);
  writeLine("");
}

/** Write diff table */
function writeDiffTable(result: SyncDiffResult): void {
  const settingWidth = Math.max(...result.diffs.map((d) => d.setting.length), 7);
  const currentWidth = Math.max(...result.diffs.map((d) => formatValue(d.current).length), 7);

  writeLine(`${"Setting".padEnd(settingWidth)}  ${"Current".padEnd(currentWidth)}  Desired`);
  writeLine("-".repeat(settingWidth + currentWidth + 20));

  for (const diff of result.diffs) {
    const currentStr = formatValue(diff.current);
    const desiredStr = formatValue(diff.desired);
    writeLine(
      `${diff.setting.padEnd(settingWidth)}  ${currentStr.padEnd(currentWidth)}  ${desiredStr}`
    );
  }
}

/** Output when no changes are needed */
function outputNoChanges(result: SyncDiffResult, format: "text" | "json"): void {
  if (format === "json") {
    writeLine(JSON.stringify({ ...result, message: "No changes needed" }, null, 2));
  } else {
    writeRepoHeader(result);
    writeLine("No changes needed. Settings match configuration.");
  }
}

/** Output preview (sync without --apply) */
function outputPreview(result: SyncDiffResult, format: "text" | "json"): void {
  if (format === "json") {
    writeLine(JSON.stringify({ ...result, preview: true }, null, 2));
  } else {
    writeRepoHeader(result);
    writeLine("Would apply the following changes:");
    for (const diff of result.diffs) {
      writeLine(`  ${diff.setting}: ${formatValue(diff.current)} -> ${formatValue(diff.desired)}`);
    }
    writeLine("");
    writeLine("Run with --apply to make these changes.");
  }
}

/** Output sync result */
function outputSyncResult(
  diffResult: SyncDiffResult,
  result: SyncResult,
  format: "text" | "json"
): void {
  if (format === "json") {
    writeLine(
      JSON.stringify(
        { repoInfo: diffResult.repoInfo, branch: diffResult.branch, ...result },
        null,
        2
      )
    );
  } else {
    outputSyncResultText(diffResult, result);
  }
}

/** Output sync result in text format */
function outputSyncResultText(diffResult: SyncDiffResult, result: SyncResult): void {
  writeRepoHeader(diffResult);
  writeLine("Applying changes...");

  for (const diff of result.applied) {
    writeLine(`  + ${diff.setting}: ${formatValue(diff.current)} -> ${formatValue(diff.desired)}`);
  }

  for (const { diff, error } of result.failed) {
    writeLine(`  x ${diff.setting}: ${error}`);
  }

  writeLine("");
  if (result.success) {
    writeLine(`+ ${result.applied.length} setting(s) synchronized successfully.`);
  } else {
    writeLine(`x ${result.failed.length} setting(s) failed to sync.`);
  }
}

/** Handle errors */
function handleError(error: unknown, format: "text" | "json"): void {
  const { message, code } = extractErrorInfo(error);

  if (format === "json") {
    writeLine(JSON.stringify({ error: true, code, message }, null, 2));
  } else {
    writeLine(`Error: ${message}`);
  }

  process.exit(2);
}

/** Extract error message and code */
function extractErrorInfo(error: unknown): { message: string; code: string } {
  if (error instanceof FetcherError) {
    return { message: error.message, code: error.code };
  }
  if (error instanceof ApplierError) {
    return { message: error.message, code: error.code };
  }
  if (error instanceof Error) {
    return { message: error.message, code: "ERROR" };
  }
  return { message: String(error), code: "ERROR" };
}

// =============================================================================
// Tag Protection Sync
// =============================================================================

/** Run tag protection diff command - show what would change */
export async function runTagDiff(options: SyncOptions): Promise<void> {
  try {
    const diffResult = await getTagDiffResult(options);
    outputTagDiff(diffResult, options.format);
    process.exit(diffResult.hasChanges ? 1 : 0);
  } catch (error) {
    handleError(error, options.format);
  }
}

/** Run tag protection sync command - apply changes (or preview if --apply not set) */
export async function runTagSync(options: SyncOptions): Promise<void> {
  try {
    const diffResult = await getTagDiffResult(options);

    if (!diffResult.hasChanges) {
      outputTagNoChanges(diffResult, options.format);
      process.exit(0);
    }

    if (!options.apply) {
      outputTagPreview(diffResult, options.format);
      process.exit(0);
    }

    const result = await applyTagChanges(options, diffResult);
    outputTagSyncResult(diffResult, result, options.format);
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    handleError(error, options.format);
  }
}

/** Get the tag diff result */
async function getTagDiffResult(options: SyncOptions): Promise<TagProtectionDiffResult> {
  if (!(await isGhAvailable())) {
    throw new FetcherError("GitHub CLI (gh) not available", "NO_GH");
  }

  const { config, configPath } = loadConfig(options.config);
  const projectRoot = getProjectRoot(configPath);
  const repoInfo = await getRepoInfo(projectRoot);

  const repoConfig = config.process?.repo;
  if (!repoConfig?.tag_protection?.patterns || repoConfig.tag_protection.patterns.length === 0) {
    throw new Error("No [process.repo.tag_protection] patterns configured in standards.toml");
  }

  const desired = repoConfig.tag_protection;
  const current = await fetchTagProtection(repoInfo);

  return computeTagDiff(repoInfo, current, desired);
}

/** Apply tag protection changes to GitHub */
async function applyTagChanges(
  options: SyncOptions,
  diffResult: TagProtectionDiffResult
): Promise<SyncResult> {
  const { config } = loadConfig(options.config);
  const desired = config.process?.repo?.tag_protection ?? {};

  return applyTagProtection(diffResult.repoInfo, desired, diffResult);
}

/** Output tag diff result */
function outputTagDiff(result: TagProtectionDiffResult, format: "text" | "json"): void {
  if (format === "json") {
    writeLine(JSON.stringify(result, null, 2));
  } else {
    outputTagDiffText(result);
  }
}

/** Output tag diff in text format */
function outputTagDiffText(result: TagProtectionDiffResult): void {
  writeTagRepoHeader(result);

  if (!result.hasChanges) {
    writeLine("No changes needed. Tag protection settings match configuration.");
    return;
  }

  writeTagDiffTable(result);
  writeLine("");
  writeLine(
    `${result.diffs.length} setting(s) differ. Run 'conform process sync-tags --apply' to apply changes.`
  );
}

/** Write tag repository header */
function writeTagRepoHeader(result: TagProtectionDiffResult): void {
  writeLine(`Repository: ${result.repoInfo.owner}/${result.repoInfo.repo}`);
  writeLine(`Target: Tag Protection Ruleset`);
  writeLine("");
}

/** Write tag diff table */
function writeTagDiffTable(result: TagProtectionDiffResult): void {
  const settingWidth = Math.max(...result.diffs.map((d) => d.setting.length), 7);
  const currentWidth = Math.max(...result.diffs.map((d) => formatValue(d.current).length), 7);

  writeLine(`${"Setting".padEnd(settingWidth)}  ${"Current".padEnd(currentWidth)}  Desired`);
  writeLine("-".repeat(settingWidth + currentWidth + 20));

  for (const diff of result.diffs) {
    const currentStr = formatValue(diff.current);
    const desiredStr = formatValue(diff.desired);
    writeLine(
      `${diff.setting.padEnd(settingWidth)}  ${currentStr.padEnd(currentWidth)}  ${desiredStr}`
    );
  }
}

/** Output when no tag changes are needed */
function outputTagNoChanges(result: TagProtectionDiffResult, format: "text" | "json"): void {
  if (format === "json") {
    writeLine(JSON.stringify({ ...result, message: "No changes needed" }, null, 2));
  } else {
    writeTagRepoHeader(result);
    writeLine("No changes needed. Tag protection settings match configuration.");
  }
}

/** Output tag preview (sync without --apply) */
function outputTagPreview(result: TagProtectionDiffResult, format: "text" | "json"): void {
  if (format === "json") {
    writeLine(JSON.stringify({ ...result, preview: true }, null, 2));
  } else {
    writeTagRepoHeader(result);
    writeLine("Would apply the following changes:");
    for (const diff of result.diffs) {
      writeLine(`  ${diff.setting}: ${formatValue(diff.current)} -> ${formatValue(diff.desired)}`);
    }
    writeLine("");
    writeLine("Run with --apply to make these changes.");
  }
}

/** Output tag sync result */
function outputTagSyncResult(
  diffResult: TagProtectionDiffResult,
  result: SyncResult,
  format: "text" | "json"
): void {
  if (format === "json") {
    writeLine(JSON.stringify({ repoInfo: diffResult.repoInfo, ...result }, null, 2));
  } else {
    outputTagSyncResultText(diffResult, result);
  }
}

/** Output tag sync result in text format */
function outputTagSyncResultText(diffResult: TagProtectionDiffResult, result: SyncResult): void {
  writeTagRepoHeader(diffResult);
  writeLine("Applying tag protection changes...");

  for (const diff of result.applied) {
    writeLine(`  + ${diff.setting}: ${formatValue(diff.current)} -> ${formatValue(diff.desired)}`);
  }

  for (const { diff, error } of result.failed) {
    writeLine(`  x ${diff.setting}: ${error}`);
  }

  writeLine("");
  if (result.success) {
    writeLine(`+ ${result.applied.length} setting(s) synchronized successfully.`);
  } else {
    writeLine(`x ${result.failed.length} setting(s) failed to sync.`);
  }
}
