import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    statSync: vi.fn(),
    lstatSync: vi.fn(),
  };
});

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("glob", () => ({
  globSync: vi.fn(),
}));

import * as fs from "node:fs";
import { execa } from "execa";

import {
  parseRegistryUrl,
  loadRuleset,
  mergeConfigs,
  resolveExtends,
  fetchRegistry,
} from "../../../src/core/registry.js";
import { ConfigError } from "../../../src/core/loader.js";
import type { Config } from "../../../src/core/schema.js";

const mockedFs = vi.mocked(fs);
const mockedExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
  // Clean env vars for auth detection tests
  delete process.env.CONFORM_REGISTRY_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.SSH_AUTH_SOCK;
});

// ---------------------------------------------------------------------------
// parseRegistryUrl
// ---------------------------------------------------------------------------
describe("parseRegistryUrl", () => {
  it("parses github:owner/repo URL", () => {
    const result = parseRegistryUrl("github:myorg/standards");
    expect(result.type).toBe("github");
    expect(result.owner).toBe("myorg");
    expect(result.repo).toBe("standards");
    expect(result.ref).toBeUndefined();
    expect(result.auth).toBe("none");
  });

  it("parses github:owner/repo@ref URL", () => {
    const result = parseRegistryUrl("github:myorg/standards@v1.0");
    expect(result.type).toBe("github");
    expect(result.owner).toBe("myorg");
    expect(result.repo).toBe("standards");
    expect(result.ref).toBe("v1.0");
  });

  it("parses github+ssh:owner/repo URL", () => {
    const result = parseRegistryUrl("github+ssh:myorg/standards");
    expect(result.type).toBe("github");
    expect(result.auth).toBe("ssh");
    expect(result.path).toBe("git@github.com:myorg/standards.git");
  });

  it("parses github+token:owner/repo URL with GITHUB_TOKEN", () => {
    process.env.GITHUB_TOKEN = "ghp_testtoken123";
    const result = parseRegistryUrl("github+token:myorg/standards");
    expect(result.type).toBe("github");
    expect(result.auth).toBe("token");
    expect(result.path).toContain("ghp_testtoken123");
  });

  it("parses github+token:owner/repo URL with CONFORM_REGISTRY_TOKEN", () => {
    process.env.CONFORM_REGISTRY_TOKEN = "custom-token";
    const result = parseRegistryUrl("github+token:myorg/standards");
    expect(result.auth).toBe("token");
    expect(result.path).toContain("custom-token");
  });

  it("falls back to HTTPS when token auth but no token found", () => {
    const result = parseRegistryUrl("github+token:myorg/standards");
    expect(result.auth).toBe("token");
    expect(result.path).toBe("https://github.com/myorg/standards.git");
  });

  it("auto-detects ssh auth when SSH_AUTH_SOCK is set", () => {
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-agent.sock";
    const result = parseRegistryUrl("github:myorg/standards");
    expect(result.auth).toBe("ssh");
    expect(result.path).toBe("git@github.com:myorg/standards.git");
  });

  it("auto-detects token auth when GITHUB_TOKEN is set", () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    const result = parseRegistryUrl("github:myorg/standards");
    expect(result.auth).toBe("token");
  });

  it("returns local type for relative paths", () => {
    const result = parseRegistryUrl("./my-registry", "/project");
    expect(result.type).toBe("local");
    expect(result.path).toContain("my-registry");
  });

  it("returns local type for absolute paths", () => {
    const result = parseRegistryUrl("/absolute/registry");
    expect(result.type).toBe("local");
    expect(result.path).toBe("/absolute/registry");
  });

  it("resolves relative paths against configDir", () => {
    const result = parseRegistryUrl("../shared-registry", "/project/config");
    expect(result.type).toBe("local");
    // Should resolve relative to configDir
    expect(result.path).toContain("shared-registry");
  });

  it("throws ConfigError for invalid github URL format", () => {
    expect(() => parseRegistryUrl("github:just-owner")).toThrow(ConfigError);
  });

  it("throws ConfigError for invalid github+ssh URL format", () => {
    expect(() => parseRegistryUrl("github+ssh:just-owner")).toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// loadRuleset
// ---------------------------------------------------------------------------
describe("loadRuleset", () => {
  it("loads and parses a valid TOML ruleset", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(`
[code.linting.eslint]
enabled = true
`);
    const result = loadRuleset("/registry", "typescript");
    expect(result.code?.linting?.eslint?.enabled).toBe(true);
  });

  it("throws ConfigError when ruleset file not found", () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(() => loadRuleset("/registry", "missing")).toThrow(ConfigError);
    expect(() => loadRuleset("/registry", "missing")).toThrow("Ruleset not found");
  });

  it("throws ConfigError for invalid TOML", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("invalid [ toml {");
    expect(() => loadRuleset("/registry", "bad")).toThrow(ConfigError);
    expect(() => loadRuleset("/registry", "bad")).toThrow("Failed to parse ruleset");
  });

  it("throws ConfigError for invalid schema", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(`
[metadata]
tier = "invalid_tier_value"
`);
    expect(() => loadRuleset("/registry", "bad-schema")).toThrow(ConfigError);
    expect(() => loadRuleset("/registry", "bad-schema")).toThrow("Invalid ruleset");
  });

  it("reads from rulesets subdirectory", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("");
    loadRuleset("/registry", "base");
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("rulesets/base.toml"),
      "utf-8"
    );
  });
});

// ---------------------------------------------------------------------------
// mergeConfigs
// ---------------------------------------------------------------------------
describe("mergeConfigs", () => {
  it("returns base config when override is empty", () => {
    const base: Config = {
      code: { linting: { eslint: { enabled: true } } },
    };
    const result = mergeConfigs(base, {});
    expect(result.code?.linting?.eslint?.enabled).toBe(true);
  });

  it("override code section replaces base values", () => {
    const base: Config = {
      code: { linting: { eslint: { enabled: true } } },
    };
    const override: Config = {
      code: { linting: { eslint: { enabled: false } } },
    };
    const result = mergeConfigs(base, override);
    expect(result.code?.linting?.eslint?.enabled).toBe(false);
  });

  it("override adds new sections", () => {
    const base: Config = {};
    const override: Config = {
      code: { linting: { ruff: { enabled: true } } },
    };
    const result = mergeConfigs(base, override);
    expect(result.code?.linting?.ruff?.enabled).toBe(true);
  });

  it("merges process section", () => {
    const base: Config = {
      process: { hooks: { enabled: true, require_husky: true } },
    };
    const override: Config = {
      process: { ci: { enabled: true } },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.hooks?.enabled).toBe(true);
    expect(result.process?.ci?.enabled).toBe(true);
  });

  it("merges process hooks section", () => {
    const base: Config = {
      process: {
        hooks: {
          enabled: true,
          require_husky: true,
          require_hooks: ["pre-commit"],
        },
      },
    };
    const override: Config = {
      process: {
        hooks: {
          enabled: true,
          require_husky: false,
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.hooks?.require_husky).toBe(false);
    // require_hooks should come from base since override doesn't specify it
    expect(result.process?.hooks?.require_hooks).toEqual(["pre-commit"]);
  });

  it("merges process hooks templates field", () => {
    const base: Config = {
      process: {
        hooks: {
          enabled: true,
          require_husky: true,
          templates: { "pre-commit": "#!/bin/sh\npnpm lint-staged" },
        },
      },
    };
    const override: Config = {
      process: {
        hooks: {
          enabled: true,
          require_husky: true,
        },
      },
    };
    const result = mergeConfigs(base, override);
    // templates should come from base since override doesn't specify it
    expect(result.process?.hooks?.templates).toEqual({ "pre-commit": "#!/bin/sh\npnpm lint-staged" });
  });

  it("override templates replaces base templates", () => {
    const base: Config = {
      process: {
        hooks: {
          enabled: true,
          require_husky: true,
          templates: { "pre-commit": "#!/bin/sh\nold-command" },
        },
      },
    };
    const override: Config = {
      process: {
        hooks: {
          enabled: true,
          require_husky: true,
          templates: { "pre-commit": "#!/bin/sh\nnew-command" },
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.hooks?.templates).toEqual({ "pre-commit": "#!/bin/sh\nnew-command" });
  });

  it("override infra section replaces entirely", () => {
    const base: Config = {
      infra: { enabled: false, manifest: "old.json" },
    };
    const override: Config = {
      infra: { enabled: true, manifest: "new.json" },
    };
    const result = mergeConfigs(base, override);
    expect(result.infra?.enabled).toBe(true);
    expect(result.infra?.manifest).toBe("new.json");
  });

  it("override monorepo section replaces entirely", () => {
    const base: Config = {
      monorepo: { exclude: ["old/**"] },
    };
    const override: Config = {
      monorepo: { exclude: ["new/**"] },
    };
    const result = mergeConfigs(base, override);
    expect(result.monorepo?.exclude).toEqual(["new/**"]);
  });

  it("merges code security section", () => {
    const base: Config = {
      code: {
        security: {
          secrets: { enabled: true, scan_mode: "branch", base_branch: "main" },
        },
      },
    };
    const override: Config = {
      code: {
        security: {
          pnpmaudit: { enabled: true, exclude_dev: false },
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.code?.security?.secrets?.enabled).toBe(true);
    expect(result.code?.security?.pnpmaudit?.enabled).toBe(true);
  });

  it("merges code types section", () => {
    const base: Config = {
      code: { types: { tsc: { enabled: true } } },
    };
    const override: Config = {
      code: { types: { ty: { enabled: true } } },
    };
    const result = mergeConfigs(base, override);
    expect(result.code?.types?.tsc?.enabled).toBe(true);
    expect(result.code?.types?.ty?.enabled).toBe(true);
  });

  it("merges code unused section", () => {
    const base: Config = {
      code: { unused: { knip: { enabled: true } } },
    };
    const override: Config = {
      code: { unused: { vulture: { enabled: true } } },
    };
    const result = mergeConfigs(base, override);
    expect(result.code?.unused?.knip?.enabled).toBe(true);
    expect(result.code?.unused?.vulture?.enabled).toBe(true);
  });

  it("merges code naming section", () => {
    const base: Config = {
      code: {
        naming: {
          enabled: false,
          rules: [{ extensions: ["ts"], file_case: "kebab-case", folder_case: "kebab-case" }],
        },
      },
    };
    const override: Config = {
      code: {
        naming: {
          enabled: true,
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.code?.naming?.enabled).toBe(true);
    // rules should come from base since override doesn't specify them
    expect(result.code?.naming?.rules).toEqual([
      { extensions: ["ts"], file_case: "kebab-case", folder_case: "kebab-case" },
    ]);
  });

  it("merges code quality section", () => {
    const base: Config = {
      code: { quality: { "disable-comments": { enabled: true } } },
    };
    const override: Config = {
      code: { quality: { "disable-comments": { enabled: false } } },
    };
    const result = mergeConfigs(base, override);
    expect(result.code?.quality?.["disable-comments"]?.enabled).toBe(false);
  });

  it("merges process branches section", () => {
    const base: Config = {
      process: {
        branches: {
          enabled: true,
          require_issue: false,
          pattern: "^(feat|fix)/.*",
          exclude: ["main"],
        },
      },
    };
    const override: Config = {
      process: {
        branches: {
          enabled: true,
          require_issue: true,
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.branches?.require_issue).toBe(true);
    expect(result.process?.branches?.pattern).toBe("^(feat|fix)/.*");
    expect(result.process?.branches?.exclude).toEqual(["main"]);
  });

  it("merges process commits section", () => {
    const base: Config = {
      process: {
        commits: {
          enabled: true,
          require_scope: false,
          types: ["feat", "fix"],
        },
      },
    };
    const override: Config = {
      process: {
        commits: {
          enabled: true,
          require_scope: true,
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.commits?.require_scope).toBe(true);
    expect(result.process?.commits?.types).toEqual(["feat", "fix"]);
  });

  it("merges process pr section", () => {
    const base: Config = {
      process: {
        pr: { enabled: true, require_issue: false, max_files: 20 },
      },
    };
    const override: Config = {
      process: {
        pr: { enabled: true, require_issue: true },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.pr?.require_issue).toBe(true);
    expect(result.process?.pr?.max_files).toBe(20);
  });

  it("merges process tickets section", () => {
    const base: Config = {
      process: {
        tickets: {
          enabled: true,
          require_in_commits: true,
          require_in_branch: false,
          pattern: "^ABC-\\d+",
        },
      },
    };
    const override: Config = {
      process: {
        tickets: {
          enabled: true,
          require_in_commits: false,
          require_in_branch: true,
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.tickets?.require_in_commits).toBe(false);
    expect(result.process?.tickets?.require_in_branch).toBe(true);
    expect(result.process?.tickets?.pattern).toBe("^ABC-\\d+");
  });

  it("merges process coverage section", () => {
    const base: Config = {
      process: {
        coverage: {
          enabled: true,
          enforce_in: "config",
          min_threshold: 80,
        },
      },
    };
    const override: Config = {
      process: {
        coverage: {
          enabled: true,
          enforce_in: "ci",
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.coverage?.enforce_in).toBe("ci");
    expect(result.process?.coverage?.min_threshold).toBe(80);
  });

  it("merges process repo section", () => {
    const base: Config = {
      process: {
        repo: {
          enabled: true,
          require_branch_protection: true,
          require_codeowners: false,
        },
      },
    };
    const override: Config = {
      process: {
        repo: {
          enabled: true,
          require_branch_protection: true,
          require_codeowners: true,
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.repo?.require_codeowners).toBe(true);
  });

  it("merges process backups section", () => {
    const base: Config = {
      process: {
        backups: {
          enabled: true,
          max_age_hours: 24,
          bucket: "my-bucket",
        },
      },
    };
    const override: Config = {
      process: {
        backups: {
          enabled: true,
          max_age_hours: 48,
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.backups?.max_age_hours).toBe(48);
    expect(result.process?.backups?.bucket).toBe("my-bucket");
  });

  it("merges process codeowners section", () => {
    const base: Config = {
      process: {
        codeowners: {
          enabled: true,
          rules: [{ pattern: "*.ts", owners: ["@team-a"] }],
        },
      },
    };
    const override: Config = {
      process: {
        codeowners: {
          enabled: true,
          rules: [{ pattern: "*.py", owners: ["@team-b"] }],
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.codeowners?.enabled).toBe(true);
  });

  it("merges process ci section", () => {
    const base: Config = {
      process: {
        ci: {
          enabled: true,
          require_workflows: ["ci.yml"],
        },
      },
    };
    const override: Config = {
      process: {
        ci: {
          enabled: true,
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.ci?.require_workflows).toEqual(["ci.yml"]);
  });

  it("merges process changesets section", () => {
    const base: Config = {
      process: {
        changesets: {
          enabled: true,
          validate_format: true,
          require_description: true,
          require_for_paths: ["src/**"],
        },
      },
    };
    const override: Config = {
      process: {
        changesets: {
          enabled: true,
          validate_format: false,
          require_description: true,
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.changesets?.validate_format).toBe(false);
    expect(result.process?.changesets?.require_for_paths).toEqual(["src/**"]);
  });

  it("merges process docs section", () => {
    const base: Config = {
      process: {
        docs: {
          enabled: true,
          path: "docs/",
          enforcement: "warn",
          staleness_days: 30,
          allowlist: ["README.md"],
        },
      },
    };
    const override: Config = {
      process: {
        docs: {
          enabled: true,
          path: "documentation/",
          enforcement: "block",
          staleness_days: 60,
        },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result.process?.docs?.path).toBe("documentation/");
    expect(result.process?.docs?.enforcement).toBe("block");
    expect(result.process?.docs?.staleness_days).toBe(60);
    expect(result.process?.docs?.allowlist).toEqual(["README.md"]);
  });
});

// ---------------------------------------------------------------------------
// fetchRegistry
// ---------------------------------------------------------------------------
describe("fetchRegistry", () => {
  it("returns local path when type is local and path exists", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    const result = await fetchRegistry({ type: "local", path: "/local/registry" });
    expect(result).toBe("/local/registry");
  });

  it("throws ConfigError when local registry not found", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    await expect(
      fetchRegistry({ type: "local", path: "/missing/registry" })
    ).rejects.toThrow(ConfigError);
  });

  it("clones a new github repo when cache does not exist", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedExeca.mockResolvedValue({} as any);

    await fetchRegistry({
      type: "github",
      owner: "myorg",
      repo: "standards",
      path: "https://github.com/myorg/standards.git",
      auth: "none",
    });

    expect(mockedExeca).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["clone"]),
      expect.any(Object)
    );
  });

  it("pulls existing repo when cache exists", async () => {
    // First existsSync: check if repoDir exists -> true
    // Second existsSync: after update, check again -> true
    mockedFs.existsSync.mockReturnValue(true);
    mockedExeca.mockResolvedValue({} as any);

    const result = await fetchRegistry({
      type: "github",
      owner: "myorg",
      repo: "standards",
      path: "https://github.com/myorg/standards.git",
      auth: "none",
    });

    expect(mockedExeca).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["pull"]),
      expect.any(Object)
    );
    expect(result).toContain("myorg-standards");
  });

  it("fetches and checks out a specific ref", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedExeca.mockResolvedValue({} as any);

    await fetchRegistry({
      type: "github",
      owner: "myorg",
      repo: "standards",
      ref: "v1.0",
      path: "https://github.com/myorg/standards.git",
      auth: "none",
    });

    expect(mockedExeca).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["fetch"]),
      expect.any(Object)
    );
    expect(mockedExeca).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["checkout", "v1.0"]),
      expect.any(Object)
    );
  });

  it("re-clones when update fails", async () => {
    // First existsSync: repoDir exists -> true (triggers update)
    // Update fails -> rmSync called
    // Second existsSync: repoDir no longer exists -> false (triggers clone)
    let callCount = 0;
    mockedFs.existsSync.mockImplementation(() => {
      callCount++;
      return callCount <= 1; // true first time, false after
    });
    mockedExeca
      .mockRejectedValueOnce(new Error("pull failed")) // update fails
      .mockResolvedValueOnce({} as any); // clone succeeds

    await fetchRegistry({
      type: "github",
      owner: "myorg",
      repo: "standards",
      path: "https://github.com/myorg/standards.git",
      auth: "none",
    });

    expect(mockedFs.rmSync).toHaveBeenCalled();
    expect(mockedExeca).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["clone"]),
      expect.any(Object)
    );
  });
});

// ---------------------------------------------------------------------------
// resolveExtends
// ---------------------------------------------------------------------------
describe("resolveExtends", () => {
  it("returns config as-is when no extends", async () => {
    const config: Config = {
      code: { linting: { eslint: { enabled: true } } },
    };
    const result = await resolveExtends(config, "/project");
    expect(result).toEqual(config);
  });

  it("merges registry rulesets with local config", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(`
[code.linting.eslint]
enabled = true
`);

    const config: Config = {
      extends: {
        registry: "/local/registry",
        rulesets: ["base"],
      },
      code: { linting: { ruff: { enabled: true } } },
    };

    const result = await resolveExtends(config, "/project");
    // Registry eslint + local ruff should both be present
    expect(result.code?.linting?.eslint?.enabled).toBe(true);
    expect(result.code?.linting?.ruff?.enabled).toBe(true);
  });

  it("local config overrides registry values", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(`
[code.linting.eslint]
enabled = true
max-warnings = 10
`);

    const config: Config = {
      extends: {
        registry: "/local/registry",
        rulesets: ["base"],
      },
      code: { linting: { eslint: { enabled: false } } },
    };

    const result = await resolveExtends(config, "/project");
    // Local override should win
    expect(result.code?.linting?.eslint?.enabled).toBe(false);
  });
});
