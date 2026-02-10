vi.mock("../../../../../src/infra/checkers/gcp/cloudrun.js", () => ({
  CloudRunChecker: { check: vi.fn() },
}));
vi.mock("../../../../../src/infra/checkers/gcp/secretmanager.js", () => ({
  SecretManagerChecker: { check: vi.fn() },
}));
vi.mock("../../../../../src/infra/checkers/gcp/artifactregistry.js", () => ({
  ArtifactRegistryChecker: { check: vi.fn() },
}));
vi.mock("../../../../../src/infra/checkers/gcp/iam.js", () => ({
  ServiceAccountChecker: { check: vi.fn() },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  SUPPORTED_GCP_SERVICES,
  isSupportedGcpService,
  getGcpChecker,
} from "../../../../../src/infra/checkers/gcp/index.js";

beforeEach(() => vi.clearAllMocks());

describe("SUPPORTED_GCP_SERVICES", () => {
  it("includes all expected services", () => {
    expect(SUPPORTED_GCP_SERVICES).toContain("run");
    expect(SUPPORTED_GCP_SERVICES).toContain("secretmanager");
    expect(SUPPORTED_GCP_SERVICES).toContain("artifactregistry");
    expect(SUPPORTED_GCP_SERVICES).toContain("iam");
  });
});

describe("isSupportedGcpService", () => {
  it("returns true for supported services", () => {
    expect(isSupportedGcpService("run")).toBe(true);
    expect(isSupportedGcpService("secretmanager")).toBe(true);
    expect(isSupportedGcpService("artifactregistry")).toBe(true);
    expect(isSupportedGcpService("iam")).toBe(true);
  });

  it("returns false for unsupported services", () => {
    expect(isSupportedGcpService("unknown")).toBe(false);
    expect(isSupportedGcpService("")).toBe(false);
    expect(isSupportedGcpService("compute")).toBe(false);
  });
});

describe("getGcpChecker", () => {
  it("returns undefined for unsupported service", async () => {
    const checker = await getGcpChecker("unknown");

    expect(checker).toBeUndefined();
  });

  it("returns a checker for run", async () => {
    const checker = await getGcpChecker("run");

    expect(checker).toBeDefined();
    expect(checker).toHaveProperty("check");
  });

  it("returns a checker for secretmanager", async () => {
    const checker = await getGcpChecker("secretmanager");

    expect(checker).toBeDefined();
    expect(checker).toHaveProperty("check");
  });

  it("returns a checker for artifactregistry", async () => {
    const checker = await getGcpChecker("artifactregistry");

    expect(checker).toBeDefined();
    expect(checker).toHaveProperty("check");
  });

  it("returns a checker for iam", async () => {
    const checker = await getGcpChecker("iam");

    expect(checker).toBeDefined();
    expect(checker).toHaveProperty("check");
  });

  it("caches the checker on subsequent calls", async () => {
    const first = await getGcpChecker("run");
    const second = await getGcpChecker("run");

    expect(first).toBe(second);
  });
});
