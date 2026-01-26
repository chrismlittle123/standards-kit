import { execa } from "execa";

import { type RepoInfo } from "./types.js";

/** Bypass actor configuration from standards.toml */
export interface BypassActorConfig {
  actor_type: "Integration" | "OrganizationAdmin" | "RepositoryRole" | "Team" | "DeployKey";
  actor_id?: number;
  bypass_mode?: "always" | "pull_request";
}

/** Validation error for a single actor */
export interface ActorValidationError {
  actor: BypassActorConfig;
  error: string;
}

/** Result of validating bypass actors */
export interface ValidationResult {
  valid: boolean;
  errors: ActorValidationError[];
  warnings: string[];
}

/** Valid repository role IDs */
const VALID_REPO_ROLE_IDS: Record<number, string> = {
  1: "Read",
  2: "Triage",
  3: "Write",
  4: "Maintain",
  5: "Admin",
};

/** Validate bypass actors against GitHub API */
export async function validateBypassActors(
  repoInfo: RepoInfo,
  actors: BypassActorConfig[]
): Promise<ValidationResult> {
  const errors: ActorValidationError[] = [];
  const warnings: string[] = [];

  for (const actor of actors) {
    const error = await validateSingleActor(repoInfo, actor);
    if (error) {
      errors.push({ actor, error });
    }
  }

  // Add warnings for common issues
  const hasAdmin = actors.some((a) => a.actor_type === "RepositoryRole" && a.actor_id === 5);
  if (hasAdmin) {
    warnings.push(
      "Warning: Repository Admin role (ID 5) can bypass rules. Consider if this is intended."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** Validate a single bypass actor */
async function validateSingleActor(
  repoInfo: RepoInfo,
  actor: BypassActorConfig
): Promise<string | null> {
  switch (actor.actor_type) {
    case "RepositoryRole":
      return validateRepositoryRole(actor);

    case "OrganizationAdmin":
      // OrganizationAdmin doesn't require an actor_id
      return null;

    case "Team":
      return validateTeam(repoInfo, actor);

    case "Integration":
      return validateIntegration(repoInfo, actor);

    case "DeployKey":
      return validateDeployKey(repoInfo, actor);

    default:
      return `Unknown actor type: ${actor.actor_type}`;
  }
}

/** Validate RepositoryRole actor */
function validateRepositoryRole(actor: BypassActorConfig): string | null {
  if (actor.actor_id === undefined) {
    return "RepositoryRole requires an actor_id (1=Read, 2=Triage, 3=Write, 4=Maintain, 5=Admin)";
  }

  const roleName = VALID_REPO_ROLE_IDS[actor.actor_id];
  if (!roleName) {
    return `Invalid RepositoryRole ID: ${actor.actor_id}. Valid IDs: 1=Read, 2=Triage, 3=Write, 4=Maintain, 5=Admin`;
  }

  return null;
}

/** Validate Team actor by checking if team exists */
async function validateTeam(repoInfo: RepoInfo, actor: BypassActorConfig): Promise<string | null> {
  if (actor.actor_id === undefined) {
    return "Team requires an actor_id (the team's numeric ID)";
  }

  try {
    // Try to fetch the team - requires org membership
    await execa("gh", [
      "api",
      `orgs/${repoInfo.owner}/teams`,
      "--jq",
      `.[] | select(.id == ${actor.actor_id})`,
    ]);
    return null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes("404") || msg.includes("Not Found")) {
      return `Team with ID ${actor.actor_id} not found in organization '${repoInfo.owner}'`;
    }

    if (msg.includes("403")) {
      // Can't validate due to permissions, but don't fail
      return null;
    }

    return `Failed to validate team: ${msg}`;
  }
}

/** Validate Integration (GitHub App) actor */
async function validateIntegration(
  repoInfo: RepoInfo,
  actor: BypassActorConfig
): Promise<string | null> {
  if (actor.actor_id === undefined) {
    return "Integration requires an actor_id (the GitHub App installation ID)";
  }

  try {
    // Try to list installations and find the one with matching ID
    const result = await execa("gh", [
      "api",
      `orgs/${repoInfo.owner}/installations`,
      "--jq",
      `.installations[] | select(.id == ${actor.actor_id}) | .id`,
    ]);

    if (!result.stdout.trim()) {
      // Also try repo-level installations for non-org repos
      const repoResult = await execa("gh", [
        "api",
        `repos/${repoInfo.owner}/${repoInfo.repo}/installation`,
        "--jq",
        ".id",
      ]).catch(() => ({ stdout: "" }));

      if (repoResult.stdout.trim() !== String(actor.actor_id)) {
        return `GitHub App installation with ID ${actor.actor_id} not found`;
      }
    }

    return null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes("404") || msg.includes("Not Found")) {
      return `GitHub App installation with ID ${actor.actor_id} not found`;
    }

    if (msg.includes("403")) {
      // Can't validate due to permissions, but don't fail
      return null;
    }

    return `Failed to validate integration: ${msg}`;
  }
}

/** Validate DeployKey actor */
async function validateDeployKey(
  repoInfo: RepoInfo,
  actor: BypassActorConfig
): Promise<string | null> {
  if (actor.actor_id === undefined) {
    return "DeployKey requires an actor_id (the deploy key's numeric ID)";
  }

  try {
    await execa("gh", ["api", `repos/${repoInfo.owner}/${repoInfo.repo}/keys/${actor.actor_id}`]);
    return null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes("404") || msg.includes("Not Found")) {
      return `Deploy key with ID ${actor.actor_id} not found in repository`;
    }

    if (msg.includes("403")) {
      // Can't validate due to permissions, but don't fail
      return null;
    }

    return `Failed to validate deploy key: ${msg}`;
  }
}

/** Format validation result for display */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push("All bypass actors are valid.");
  } else {
    lines.push("Bypass actor validation failed:");
    for (const { actor, error } of result.errors) {
      lines.push(
        `  - ${actor.actor_type}${actor.actor_id ? ` (ID: ${actor.actor_id})` : ""}: ${error}`
      );
    }
  }

  if (result.warnings.length > 0) {
    lines.push("");
    for (const warning of result.warnings) {
      lines.push(warning);
    }
  }

  return lines.join("\n");
}
