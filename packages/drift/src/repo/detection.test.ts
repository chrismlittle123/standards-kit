import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  findMetadataPath,
  parseRepoMetadata,
  getRepoMetadata,
  findCheckTomlFiles,
  hasCheckToml,
  hasMetadata,
  isScannableRepo,
} from "./detection.js";

describe("repo detection", () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(
      tmpdir(),
      `drift-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("findMetadataPath", () => {
    it("returns null when no metadata file exists", () => {
      expect(findMetadataPath(testDir)).toBeNull();
    });

    it("finds repo-metadata.yaml", () => {
      writeFileSync(join(testDir, "repo-metadata.yaml"), "tier: production");
      expect(findMetadataPath(testDir)).toBe(
        join(testDir, "repo-metadata.yaml")
      );
    });

    it("finds repo-metadata.yml", () => {
      writeFileSync(join(testDir, "repo-metadata.yml"), "tier: production");
      expect(findMetadataPath(testDir)).toBe(
        join(testDir, "repo-metadata.yml")
      );
    });

    it("prefers .yaml over .yml", () => {
      writeFileSync(join(testDir, "repo-metadata.yaml"), "tier: production");
      writeFileSync(join(testDir, "repo-metadata.yml"), "tier: internal");
      expect(findMetadataPath(testDir)).toBe(
        join(testDir, "repo-metadata.yaml")
      );
    });
  });

  describe("parseRepoMetadata", () => {
    it("returns defaults with warning for invalid YAML", () => {
      const result = parseRepoMetadata("{{invalid");
      expect(result).not.toBeNull();
      expect(result?.metadata.tier).toBe("internal");
      expect(result?.metadata.status).toBe("active");
      expect(result?.warnings).toHaveLength(1);
      expect(result?.warnings[0]).toContain("Failed to parse YAML");
    });

    it("returns defaults with warning for non-object YAML", () => {
      const result = parseRepoMetadata("just a string");
      expect(result).not.toBeNull();
      expect(result?.metadata.tier).toBe("internal");
      expect(result?.metadata.status).toBe("active");
      expect(result?.warnings).toHaveLength(1);
      expect(result?.warnings[0]).toContain("Invalid metadata format");
    });

    it("returns defaults with warning for empty file", () => {
      const result = parseRepoMetadata("");
      expect(result).not.toBeNull();
      expect(result?.metadata.tier).toBe("internal");
      expect(result?.metadata.status).toBe("active");
      expect(result?.warnings).toHaveLength(1);
      expect(result?.warnings[0]).toContain("File is empty");
    });

    it("returns defaults with warning for whitespace-only file", () => {
      const result = parseRepoMetadata("   \n\t\n   ");
      expect(result).not.toBeNull();
      expect(result?.metadata.tier).toBe("internal");
      expect(result?.metadata.status).toBe("active");
      expect(result?.warnings).toHaveLength(1);
      expect(result?.warnings[0]).toContain("File is empty");
    });

    it("parses valid metadata with all fields", () => {
      const result = parseRepoMetadata(`
tier: production
status: active
team: backend
`);
      expect(result).not.toBeNull();
      expect(result?.metadata.tier).toBe("production");
      expect(result?.metadata.status).toBe("active");
      expect(result?.metadata.team).toBe("backend");
      expect(result?.warnings).toHaveLength(0);
    });

    it("applies defaults for missing fields", () => {
      const result = parseRepoMetadata("team: frontend");
      expect(result).not.toBeNull();
      expect(result?.metadata.tier).toBe("internal");
      expect(result?.metadata.status).toBe("active");
      expect(result?.metadata.team).toBe("frontend");
    });

    it("warns about invalid tier", () => {
      const result = parseRepoMetadata("tier: invalid-tier");
      expect(result).not.toBeNull();
      expect(result?.metadata.tier).toBe("internal"); // default
      expect(result?.warnings).toHaveLength(1);
      expect(result?.warnings[0]).toContain("Invalid tier");
    });

    it("warns about invalid status", () => {
      const result = parseRepoMetadata("status: invalid-status");
      expect(result).not.toBeNull();
      expect(result?.metadata.status).toBe("active"); // default
      expect(result?.warnings).toHaveLength(1);
      expect(result?.warnings[0]).toContain("Invalid status");
    });

    it("preserves raw metadata", () => {
      const result = parseRepoMetadata(`
tier: production
custom_field: custom_value
`);
      expect(result?.metadata.raw).toEqual({
        tier: "production",
        custom_field: "custom_value",
      });
    });
  });

  describe("getRepoMetadata", () => {
    it("returns { metadata: null, warnings: [] } when no metadata file exists", () => {
      const result = getRepoMetadata(testDir);
      expect(result.metadata).toBeNull();
      expect(result.warnings).toEqual([]);
    });

    it("loads and parses metadata file", () => {
      writeFileSync(
        join(testDir, "repo-metadata.yaml"),
        "tier: production\nstatus: pre-release"
      );
      const result = getRepoMetadata(testDir);
      expect(result.metadata).not.toBeNull();
      expect(result.metadata?.tier).toBe("production");
      expect(result.metadata?.status).toBe("pre-release");
    });

    it("returns defaults with warning for empty metadata file", () => {
      writeFileSync(join(testDir, "repo-metadata.yaml"), "");
      const result = getRepoMetadata(testDir);
      expect(result.metadata).not.toBeNull();
      expect(result.metadata?.tier).toBe("internal");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("File is empty");
    });

    it("returns defaults with warning for invalid YAML in metadata file", () => {
      writeFileSync(
        join(testDir, "repo-metadata.yaml"),
        "tier: production\n  bad: yaml"
      );
      const result = getRepoMetadata(testDir);
      expect(result.metadata).not.toBeNull();
      expect(result.metadata?.tier).toBe("internal");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Failed to parse YAML");
    });
  });

  describe("findCheckTomlFiles", () => {
    it("returns empty array when no standards.toml exists", () => {
      expect(findCheckTomlFiles(testDir)).toEqual([]);
    });

    it("finds standards.toml at root", () => {
      writeFileSync(join(testDir, "standards.toml"), "[code]");
      expect(findCheckTomlFiles(testDir)).toEqual(["standards.toml"]);
    });

    it("finds standards.toml in subdirectories", () => {
      mkdirSync(join(testDir, "packages", "api"), { recursive: true });
      mkdirSync(join(testDir, "packages", "web"), { recursive: true });
      writeFileSync(join(testDir, "packages", "api", "standards.toml"), "[code]");
      writeFileSync(join(testDir, "packages", "web", "standards.toml"), "[code]");

      const files = findCheckTomlFiles(testDir);
      expect(files).toHaveLength(2);
      expect(files).toContain(join("packages", "api", "standards.toml"));
      expect(files).toContain(join("packages", "web", "standards.toml"));
    });

    it("finds standards.toml at root and in subdirectories", () => {
      mkdirSync(join(testDir, "packages", "lib"), { recursive: true });
      writeFileSync(join(testDir, "standards.toml"), "[code]");
      writeFileSync(join(testDir, "packages", "lib", "standards.toml"), "[code]");

      const files = findCheckTomlFiles(testDir);
      expect(files).toHaveLength(2);
      expect(files).toContain("standards.toml");
      expect(files).toContain(join("packages", "lib", "standards.toml"));
    });

    it("skips node_modules", () => {
      mkdirSync(join(testDir, "node_modules", "some-pkg"), { recursive: true });
      writeFileSync(
        join(testDir, "node_modules", "some-pkg", "standards.toml"),
        "[code]"
      );
      expect(findCheckTomlFiles(testDir)).toEqual([]);
    });

    it("skips .git directory", () => {
      mkdirSync(join(testDir, ".git", "hooks"), { recursive: true });
      writeFileSync(join(testDir, ".git", "hooks", "standards.toml"), "[code]");
      expect(findCheckTomlFiles(testDir)).toEqual([]);
    });

    it("respects maxDepth", () => {
      mkdirSync(join(testDir, "a", "b", "c", "d"), { recursive: true });
      writeFileSync(join(testDir, "a", "standards.toml"), "[code]");
      writeFileSync(join(testDir, "a", "b", "c", "d", "standards.toml"), "[code]");

      // With default maxDepth=3, should find the one at depth 1 but not depth 4
      const files = findCheckTomlFiles(testDir, 2);
      expect(files).toHaveLength(1);
      expect(files).toContain(join("a", "standards.toml"));
    });
  });

  describe("hasCheckToml", () => {
    it("returns false when no standards.toml exists", () => {
      expect(hasCheckToml(testDir)).toBe(false);
    });

    it("returns true when standards.toml exists at root", () => {
      writeFileSync(join(testDir, "standards.toml"), "[code]");
      expect(hasCheckToml(testDir)).toBe(true);
    });

    it("returns true when standards.toml exists in subdirectory", () => {
      mkdirSync(join(testDir, "packages", "api"), { recursive: true });
      writeFileSync(join(testDir, "packages", "api", "standards.toml"), "[code]");
      expect(hasCheckToml(testDir)).toBe(true);
    });
  });

  describe("hasMetadata", () => {
    it("returns false when no metadata file exists", () => {
      expect(hasMetadata(testDir)).toBe(false);
    });

    it("returns true when repo-metadata.yaml exists", () => {
      writeFileSync(join(testDir, "repo-metadata.yaml"), "tier: production");
      expect(hasMetadata(testDir)).toBe(true);
    });
  });

  describe("isScannableRepo", () => {
    it("returns not scannable when both files are missing", () => {
      const result = isScannableRepo(testDir);
      expect(result.scannable).toBe(false);
      expect(result.hasMetadata).toBe(false);
      expect(result.hasCheckToml).toBe(false);
      expect(result.checkTomlPaths).toEqual([]);
      expect(result.metadata).toBeUndefined();
    });

    it("returns not scannable when only metadata exists", () => {
      writeFileSync(join(testDir, "repo-metadata.yaml"), "tier: production");
      const result = isScannableRepo(testDir);
      expect(result.scannable).toBe(false);
      expect(result.hasMetadata).toBe(true);
      expect(result.hasCheckToml).toBe(false);
      expect(result.metadata).toBeDefined();
    });

    it("returns not scannable when only standards.toml exists", () => {
      writeFileSync(join(testDir, "standards.toml"), "[code]");
      const result = isScannableRepo(testDir);
      expect(result.scannable).toBe(false);
      expect(result.hasMetadata).toBe(false);
      expect(result.hasCheckToml).toBe(true);
      expect(result.checkTomlPaths).toEqual(["standards.toml"]);
    });

    it("returns scannable when both files exist", () => {
      writeFileSync(
        join(testDir, "repo-metadata.yaml"),
        "tier: production\nstatus: active"
      );
      writeFileSync(join(testDir, "standards.toml"), "[code]");
      const result = isScannableRepo(testDir);
      expect(result.scannable).toBe(true);
      expect(result.hasMetadata).toBe(true);
      expect(result.hasCheckToml).toBe(true);
      expect(result.checkTomlPaths).toEqual(["standards.toml"]);
      expect(result.metadata?.tier).toBe("production");
      expect(result.metadata?.status).toBe("active");
    });

    it("returns scannable for monorepo with standards.toml in subdirectory", () => {
      writeFileSync(join(testDir, "repo-metadata.yaml"), "tier: internal");
      mkdirSync(join(testDir, "packages", "api"), { recursive: true });
      writeFileSync(join(testDir, "packages", "api", "standards.toml"), "[code]");

      const result = isScannableRepo(testDir);
      expect(result.scannable).toBe(true);
      expect(result.checkTomlPaths).toContain(
        join("packages", "api", "standards.toml")
      );
    });

    it("handles errors gracefully", () => {
      const result = isScannableRepo("/nonexistent/path/that/does/not/exist");
      expect(result.scannable).toBe(false);
      // Should not throw, just return not scannable
    });
  });
});
