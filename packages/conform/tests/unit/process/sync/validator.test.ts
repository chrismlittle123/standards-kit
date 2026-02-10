vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";

import {
  validateBypassActors,
  formatValidationResult,
} from "../../../../src/process/sync/validator.js";
import type { BypassActorConfig, ValidationResult } from "../../../../src/process/sync/validator.js";

const mockedExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
});

const repoInfo = { owner: "acme", repo: "app" };

describe("validateBypassActors", () => {
  it("returns valid for empty actors array", async () => {
    const result = await validateBypassActors(repoInfo, []);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  describe("RepositoryRole validation", () => {
    it("validates known role IDs", async () => {
      const actors: BypassActorConfig[] = [
        { actor_type: "RepositoryRole", actor_id: 3 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(true);
    });

    it("rejects missing actor_id", async () => {
      const actors: BypassActorConfig[] = [
        { actor_type: "RepositoryRole" },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(false);
      expect(result.errors[0].error).toContain("requires an actor_id");
    });

    it("rejects invalid role ID", async () => {
      const actors: BypassActorConfig[] = [
        { actor_type: "RepositoryRole", actor_id: 99 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(false);
      expect(result.errors[0].error).toContain("Invalid RepositoryRole ID");
    });

    it("adds warning for Admin role (ID 5)", async () => {
      const actors: BypassActorConfig[] = [
        { actor_type: "RepositoryRole", actor_id: 5 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Admin role");
    });
  });

  describe("OrganizationAdmin validation", () => {
    it("accepts OrganizationAdmin without actor_id", async () => {
      const actors: BypassActorConfig[] = [
        { actor_type: "OrganizationAdmin" },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(true);
    });
  });

  describe("Team validation", () => {
    it("rejects missing actor_id", async () => {
      const actors: BypassActorConfig[] = [
        { actor_type: "Team" },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(false);
      expect(result.errors[0].error).toContain("requires an actor_id");
    });

    it("validates team exists via API", async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: '{"id": 10}' } as never);
      const actors: BypassActorConfig[] = [
        { actor_type: "Team", actor_id: 10 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(true);
      expect(mockedExeca).toHaveBeenCalledWith(
        "gh",
        ["api", "orgs/acme/teams", "--jq", ".[] | select(.id == 10)"]
      );
    });

    it("reports error when team not found (404)", async () => {
      mockedExeca.mockRejectedValueOnce(new Error("404 Not Found"));
      const actors: BypassActorConfig[] = [
        { actor_type: "Team", actor_id: 99 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(false);
      expect(result.errors[0].error).toContain("not found");
    });

    it("skips validation on 403 permission error", async () => {
      mockedExeca.mockRejectedValueOnce(new Error("403 Forbidden"));
      const actors: BypassActorConfig[] = [
        { actor_type: "Team", actor_id: 10 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(true);
    });

    it("reports error on other API failures", async () => {
      mockedExeca.mockRejectedValueOnce(new Error("network error"));
      const actors: BypassActorConfig[] = [
        { actor_type: "Team", actor_id: 10 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(false);
      expect(result.errors[0].error).toContain("Failed to validate team");
    });
  });

  describe("Integration validation", () => {
    it("rejects missing actor_id", async () => {
      const actors: BypassActorConfig[] = [
        { actor_type: "Integration" },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(false);
      expect(result.errors[0].error).toContain("requires an actor_id");
    });

    it("validates integration via org installations API", async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: "123" } as never);
      const actors: BypassActorConfig[] = [
        { actor_type: "Integration", actor_id: 123 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(true);
    });

    it("falls back to repo installation when org returns empty", async () => {
      mockedExeca
        .mockResolvedValueOnce({ stdout: "" } as never)
        .mockResolvedValueOnce({ stdout: "456" } as never);
      const actors: BypassActorConfig[] = [
        { actor_type: "Integration", actor_id: 456 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(true);
    });

    it("reports error when integration not found", async () => {
      mockedExeca
        .mockResolvedValueOnce({ stdout: "" } as never)
        .mockResolvedValueOnce({ stdout: "999" } as never);
      const actors: BypassActorConfig[] = [
        { actor_type: "Integration", actor_id: 456 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(false);
      expect(result.errors[0].error).toContain("not found");
    });

    it("reports error on 404", async () => {
      mockedExeca.mockRejectedValueOnce(new Error("404 Not Found"));
      const actors: BypassActorConfig[] = [
        { actor_type: "Integration", actor_id: 123 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(false);
      expect(result.errors[0].error).toContain("not found");
    });

    it("skips validation on 403", async () => {
      mockedExeca.mockRejectedValueOnce(new Error("403 Forbidden"));
      const actors: BypassActorConfig[] = [
        { actor_type: "Integration", actor_id: 123 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(true);
    });
  });

  describe("DeployKey validation", () => {
    it("rejects missing actor_id", async () => {
      const actors: BypassActorConfig[] = [
        { actor_type: "DeployKey" },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(false);
      expect(result.errors[0].error).toContain("requires an actor_id");
    });

    it("validates deploy key exists via API", async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: '{"id": 7}' } as never);
      const actors: BypassActorConfig[] = [
        { actor_type: "DeployKey", actor_id: 7 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(true);
      expect(mockedExeca).toHaveBeenCalledWith("gh", [
        "api",
        "repos/acme/app/keys/7",
      ]);
    });

    it("reports error when deploy key not found", async () => {
      mockedExeca.mockRejectedValueOnce(new Error("404 Not Found"));
      const actors: BypassActorConfig[] = [
        { actor_type: "DeployKey", actor_id: 7 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(false);
      expect(result.errors[0].error).toContain("not found");
    });

    it("skips validation on 403", async () => {
      mockedExeca.mockRejectedValueOnce(new Error("403 Forbidden"));
      const actors: BypassActorConfig[] = [
        { actor_type: "DeployKey", actor_id: 7 },
      ];
      const result = await validateBypassActors(repoInfo, actors);
      expect(result.valid).toBe(true);
    });
  });
});

describe("formatValidationResult", () => {
  it("formats valid result", () => {
    const result: ValidationResult = { valid: true, errors: [], warnings: [] };
    expect(formatValidationResult(result)).toBe("All bypass actors are valid.");
  });

  it("formats result with errors", () => {
    const result: ValidationResult = {
      valid: false,
      errors: [
        {
          actor: { actor_type: "RepositoryRole", actor_id: 99 },
          error: "Invalid RepositoryRole ID: 99",
        },
      ],
      warnings: [],
    };
    const output = formatValidationResult(result);
    expect(output).toContain("validation failed");
    expect(output).toContain("RepositoryRole");
    expect(output).toContain("ID: 99");
  });

  it("formats result with warnings", () => {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: ["Warning: Repository Admin role (ID 5) can bypass rules."],
    };
    const output = formatValidationResult(result);
    expect(output).toContain("All bypass actors are valid.");
    expect(output).toContain("Admin role");
  });

  it("formats actor without actor_id", () => {
    const result: ValidationResult = {
      valid: false,
      errors: [
        {
          actor: { actor_type: "Team" },
          error: "Team requires an actor_id",
        },
      ],
      warnings: [],
    };
    const output = formatValidationResult(result);
    expect(output).toContain("Team:");
    expect(output).not.toContain("ID:");
  });
});
