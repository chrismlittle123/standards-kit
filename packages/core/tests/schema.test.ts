import { describe, it, expect } from "vitest";
import { configSchema, defaultConfig } from "../src/schema.js";

describe("configSchema", () => {
  it("validates an empty config", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("validates a minimal code config", () => {
    const config = {
      code: {
        linting: {
          eslint: { enabled: true },
        },
      },
    };
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("validates process config", () => {
    const config = {
      process: {
        hooks: {
          enabled: true,
          require_husky: true,
          require_hooks: ["pre-commit", "pre-push"],
        },
      },
    };
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields in strict mode", () => {
    const config = {
      unknownField: "value",
    };
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("validates extends config", () => {
    const config = {
      extends: {
        registry: "github:owner/repo",
        rulesets: ["base", "typescript"],
      },
    };
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("validates infra config", () => {
    const config = {
      infra: {
        enabled: true,
        manifest: "custom-manifest.json",
      },
    };
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});

describe("defaultConfig", () => {
  it("has code domain defaults", () => {
    expect(defaultConfig.code?.linting?.eslint?.enabled).toBe(false);
    expect(defaultConfig.code?.linting?.ruff?.enabled).toBe(false);
  });

  it("has process domain defaults", () => {
    expect(defaultConfig.process?.hooks?.enabled).toBe(false);
    expect(defaultConfig.process?.hooks?.require_husky).toBe(true);
  });

  it("has infra domain defaults", () => {
    expect(defaultConfig.infra?.enabled).toBe(false);
    expect(defaultConfig.infra?.manifest).toBe("infra-manifest.json");
  });
});
