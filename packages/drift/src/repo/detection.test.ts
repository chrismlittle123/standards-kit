import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getRepoMetadata,
  extractMetadataFromToml,
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

  describe("extractMetadataFromToml", () => {
    it("returns null when standards.toml does not exist", () => {
      expect(extractMetadataFromToml(testDir)).toBeNull();
    });

    it("returns null when standards.toml has no [metadata] section", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[code.linting.eslint]\nenabled = true'
      );
      expect(extractMetadataFromToml(testDir)).toBeNull();
    });

    it("returns null when [metadata] has no tier", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[metadata]\nproject = "backend"'
      );
      expect(extractMetadataFromToml(testDir)).toBeNull();
    });

    it("extracts metadata from standards.toml [metadata] section", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[metadata]\ntier = "production"\nproject = "backend"\norganisation = "acme"\nstatus = "active"'
      );
      const result = extractMetadataFromToml(testDir);
      expect(result).not.toBeNull();
      expect(result?.metadata.tier).toBe("production");
      expect(result?.metadata.project).toBe("backend");
      expect(result?.metadata.organisation).toBe("acme");
      expect(result?.metadata.status).toBe("active");
      expect(result?.warnings).toHaveLength(0);
    });

    it("applies defaults for missing optional fields", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[metadata]\ntier = "internal"'
      );
      const result = extractMetadataFromToml(testDir);
      expect(result).not.toBeNull();
      expect(result?.metadata.tier).toBe("internal");
      expect(result?.metadata.project).toBeUndefined();
      expect(result?.metadata.organisation).toBeUndefined();
      expect(result?.metadata.status).toBe("active"); // default
    });

    it("warns about invalid tier", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[metadata]\ntier = "invalid-tier"'
      );
      const result = extractMetadataFromToml(testDir);
      expect(result).not.toBeNull();
      expect(result?.metadata.tier).toBe("internal"); // default
      expect(result?.warnings).toHaveLength(1);
      expect(result?.warnings[0]).toContain("Invalid tier");
    });

    it("warns about invalid status", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[metadata]\ntier = "production"\nstatus = "invalid-status"'
      );
      const result = extractMetadataFromToml(testDir);
      expect(result).not.toBeNull();
      expect(result?.metadata.status).toBe("active"); // default
      expect(result?.warnings).toHaveLength(1);
      expect(result?.warnings[0]).toContain("Invalid status");
    });

    it("returns null for invalid TOML", () => {
      writeFileSync(join(testDir, "standards.toml"), "invalid toml {{");
      expect(extractMetadataFromToml(testDir)).toBeNull();
    });
  });

  describe("getRepoMetadata", () => {
    it("returns { metadata: null, warnings: [] } when no standards.toml exists", () => {
      const result = getRepoMetadata(testDir);
      expect(result.metadata).toBeNull();
      expect(result.warnings).toEqual([]);
    });

    it("returns { metadata: null, warnings: [] } when standards.toml has no [metadata]", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[code.linting.eslint]\nenabled = true'
      );
      const result = getRepoMetadata(testDir);
      expect(result.metadata).toBeNull();
      expect(result.warnings).toEqual([]);
    });

    it("loads and parses metadata from standards.toml [metadata]", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[metadata]\ntier = "production"\nstatus = "pre-release"'
      );
      const result = getRepoMetadata(testDir);
      expect(result.metadata).not.toBeNull();
      expect(result.metadata?.tier).toBe("production");
      expect(result.metadata?.status).toBe("pre-release");
    });

    it("returns warnings for invalid tier", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[metadata]\ntier = "invalid"'
      );
      const result = getRepoMetadata(testDir);
      expect(result.metadata).not.toBeNull();
      expect(result.metadata?.tier).toBe("internal"); // default
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Invalid tier");
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
    it("returns false when no standards.toml exists", () => {
      expect(hasMetadata(testDir)).toBe(false);
    });

    it("returns true when standards.toml has [metadata] section", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[metadata]\ntier = "production"'
      );
      expect(hasMetadata(testDir)).toBe(true);
    });

    it("returns false when standards.toml exists but has no [metadata]", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[code.linting.eslint]\nenabled = true'
      );
      expect(hasMetadata(testDir)).toBe(false);
    });

    it("returns false when [metadata] exists but has no tier", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[metadata]\nproject = "backend"'
      );
      expect(hasMetadata(testDir)).toBe(false);
    });
  });

  describe("isScannableRepo", () => {
    it("returns not scannable when no files exist", () => {
      const result = isScannableRepo(testDir);
      expect(result.scannable).toBe(false);
      expect(result.hasMetadata).toBe(false);
      expect(result.hasCheckToml).toBe(false);
      expect(result.checkTomlPaths).toEqual([]);
      expect(result.metadata).toBeUndefined();
    });

    it("returns not scannable when only standards.toml exists without [metadata]", () => {
      writeFileSync(join(testDir, "standards.toml"), "[code]");
      const result = isScannableRepo(testDir);
      expect(result.scannable).toBe(false);
      expect(result.hasMetadata).toBe(false);
      expect(result.hasCheckToml).toBe(true);
      expect(result.checkTomlPaths).toEqual(["standards.toml"]);
    });

    it("returns scannable when standards.toml has [metadata] section", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[metadata]\ntier = "production"\n[code]'
      );
      const result = isScannableRepo(testDir);
      expect(result.scannable).toBe(true);
      expect(result.hasMetadata).toBe(true);
      expect(result.hasCheckToml).toBe(true);
      expect(result.metadata?.tier).toBe("production");
    });

    it("returns scannable for monorepo with standards.toml [metadata] at root", () => {
      writeFileSync(
        join(testDir, "standards.toml"),
        '[metadata]\ntier = "internal"'
      );
      mkdirSync(join(testDir, "packages", "api"), { recursive: true });
      writeFileSync(join(testDir, "packages", "api", "standards.toml"), "[code]");

      const result = isScannableRepo(testDir);
      expect(result.scannable).toBe(true);
      expect(result.checkTomlPaths).toContain("standards.toml");
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
