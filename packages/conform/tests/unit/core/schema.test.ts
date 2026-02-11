import { describe, it, expect } from "vitest";
import { configSchema, defaultConfig } from "../../../src/core/index.js";

describe("configSchema", () => {
  describe("basic validation", () => {
    it("accepts empty config", () => {
      const result = configSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts minimal config with metadata", () => {
      const config = {
        metadata: {
          tier: "production",
          status: "active",
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("rejects invalid tier value", () => {
      const config = {
        metadata: {
          tier: "invalid",
          status: "active",
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("accepts valid tier values", () => {
      for (const tier of ["production", "internal", "prototype"]) {
        const config = {
          metadata: {
            tier,
            status: "active",
          },
        };
        const result = configSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });

    it("accepts valid status values", () => {
      for (const status of ["active", "pre-release", "deprecated"]) {
        const config = {
          metadata: {
            tier: "production",
            status,
          },
        };
        const result = configSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });

    it("rejects unknown top-level keys", () => {
      const config = {
        unknownKey: "value",
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe("code section", () => {
    it("accepts code.linting.eslint configuration", () => {
      const config = {
        code: {
          linting: {
            eslint: {
              enabled: true,
            },
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("accepts code.types.tsc configuration", () => {
      const config = {
        code: {
          types: {
            tsc: {
              enabled: true,
            },
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("accepts code.coverage_run configuration", () => {
      const config = {
        code: {
          coverage_run: {
            enabled: true,
            min_threshold: 80,
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("accepts code.security.secrets configuration", () => {
      const config = {
        code: {
          security: {
            secrets: {
              enabled: true,
              scan_mode: "branch",
            },
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("accepts code.naming configuration", () => {
      const config = {
        code: {
          naming: {
            enabled: true,
            rules: [
              {
                extensions: ["ts", "tsx"],
                file_case: "kebab-case",
                folder_case: "kebab-case",
              },
            ],
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("rejects invalid coverage threshold", () => {
      const config = {
        code: {
          coverage_run: {
            enabled: true,
            min_threshold: 150, // invalid: must be 0-100
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe("process section", () => {
    it("accepts process.hooks configuration", () => {
      const config = {
        process: {
          hooks: {
            enabled: true,
            require_husky: true,
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("accepts process.hooks with templates field", () => {
      const config = {
        process: {
          hooks: {
            enabled: true,
            templates: {
              "pre-commit": "#!/bin/sh\npnpm lint-staged",
              "pre-push": "#!/bin/sh\npnpm test",
            },
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("accepts process.ci configuration", () => {
      const config = {
        process: {
          ci: {
            enabled: true,
            require_workflows: ["ci.yml"],
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("accepts process.branches configuration", () => {
      const config = {
        process: {
          branches: {
            enabled: true,
            pattern: "^(feat|fix|chore)/.*$",
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("accepts process.commits configuration", () => {
      const config = {
        process: {
          commits: {
            enabled: true,
            types: ["feat", "fix", "chore"],
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("accepts process.pr configuration", () => {
      const config = {
        process: {
          pr: {
            enabled: true,
            max_files: 50,
            max_lines: 500,
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe("extends section", () => {
    it("accepts extends with registry and rulesets", () => {
      const config = {
        extends: {
          registry: "github:org/standards",
          rulesets: ["base", "typescript"],
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe("infra section", () => {
    it("accepts infra configuration", () => {
      const config = {
        infra: {
          enabled: true,
          manifest: "infra-manifest.json",
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe("mcp section", () => {
    it("accepts mcp.standards configuration", () => {
      const config = {
        mcp: {
          standards: {
            source: "github:org/standards",
          },
        },
      };
      const result = configSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });
});

describe("defaultConfig", () => {
  it("provides sensible defaults", () => {
    expect(defaultConfig).toBeDefined();
    expect(typeof defaultConfig).toBe("object");
  });

  it("has code section with defaults", () => {
    expect(defaultConfig.code).toBeDefined();
    expect(defaultConfig.code?.linting?.eslint?.enabled).toBe(false);
    expect(defaultConfig.code?.types?.tsc?.enabled).toBe(false);
  });

  it("has process section with defaults", () => {
    expect(defaultConfig.process).toBeDefined();
    expect(defaultConfig.process?.hooks?.enabled).toBe(false);
    expect(defaultConfig.process?.ci?.enabled).toBe(false);
  });

  it("has infra section with defaults", () => {
    expect(defaultConfig.infra).toBeDefined();
    expect(defaultConfig.infra?.enabled).toBe(false);
    expect(defaultConfig.infra?.manifest).toBe("infra-manifest.json");
  });

  it("validates against configSchema", () => {
    const result = configSchema.safeParse(defaultConfig);
    expect(result.success).toBe(true);
  });
});
