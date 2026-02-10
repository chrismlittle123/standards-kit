vi.mock("../../../../src/infra/checkers/s3.js", () => ({
  S3Checker: { check: vi.fn() },
}));
vi.mock("../../../../src/infra/checkers/lambda.js", () => ({
  LambdaChecker: { check: vi.fn() },
}));
vi.mock("../../../../src/infra/checkers/dynamodb.js", () => ({
  DynamoDBChecker: { check: vi.fn() },
}));
vi.mock("../../../../src/infra/checkers/sqs.js", () => ({
  SQSChecker: { check: vi.fn() },
}));
vi.mock("../../../../src/infra/checkers/sns.js", () => ({
  SNSChecker: { check: vi.fn() },
}));
vi.mock("../../../../src/infra/checkers/iam.js", () => ({
  IAMChecker: { check: vi.fn() },
}));
vi.mock("../../../../src/infra/checkers/secretsmanager.js", () => ({
  SecretsManagerChecker: { check: vi.fn() },
}));
vi.mock("../../../../src/infra/checkers/cloudwatch.js", () => ({
  CloudWatchLogsChecker: { check: vi.fn() },
}));
vi.mock("../../../../src/infra/checkers/ecs.js", () => ({
  ECSChecker: { check: vi.fn() },
}));
vi.mock("../../../../src/infra/checkers/rds.js", () => ({
  RDSChecker: { check: vi.fn() },
}));
vi.mock("../../../../src/infra/checkers/ec2.js", () => ({
  EC2Checker: { check: vi.fn() },
}));
vi.mock("../../../../src/infra/checkers/elasticache.js", () => ({
  ElastiCacheChecker: { check: vi.fn() },
}));
vi.mock("../../../../src/infra/checkers/elb.js", () => ({
  ELBChecker: { check: vi.fn() },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  SUPPORTED_SERVICES,
  isSupportedService,
  getChecker,
} from "../../../../src/infra/checkers/index.js";

beforeEach(() => vi.clearAllMocks());

describe("SUPPORTED_SERVICES", () => {
  it("includes all expected services", () => {
    expect(SUPPORTED_SERVICES).toContain("s3");
    expect(SUPPORTED_SERVICES).toContain("lambda");
    expect(SUPPORTED_SERVICES).toContain("dynamodb");
    expect(SUPPORTED_SERVICES).toContain("sqs");
    expect(SUPPORTED_SERVICES).toContain("sns");
    expect(SUPPORTED_SERVICES).toContain("iam");
    expect(SUPPORTED_SERVICES).toContain("secretsmanager");
    expect(SUPPORTED_SERVICES).toContain("logs");
    expect(SUPPORTED_SERVICES).toContain("ecs");
    expect(SUPPORTED_SERVICES).toContain("rds");
    expect(SUPPORTED_SERVICES).toContain("ec2");
    expect(SUPPORTED_SERVICES).toContain("elasticache");
    expect(SUPPORTED_SERVICES).toContain("elasticloadbalancing");
  });
});

describe("isSupportedService", () => {
  it("returns true for supported services", () => {
    expect(isSupportedService("s3")).toBe(true);
    expect(isSupportedService("lambda")).toBe(true);
    expect(isSupportedService("ecs")).toBe(true);
  });

  it("returns false for unsupported services", () => {
    expect(isSupportedService("unknown")).toBe(false);
    expect(isSupportedService("")).toBe(false);
    expect(isSupportedService("kinesis")).toBe(false);
  });
});

describe("getChecker", () => {
  it("returns undefined for unsupported service", async () => {
    const checker = await getChecker("unknown");

    expect(checker).toBeUndefined();
  });

  it("returns a checker for s3", async () => {
    const checker = await getChecker("s3");

    expect(checker).toBeDefined();
    expect(checker).toHaveProperty("check");
  });

  it("returns a checker for lambda", async () => {
    const checker = await getChecker("lambda");

    expect(checker).toBeDefined();
    expect(checker).toHaveProperty("check");
  });

  it("returns a checker for dynamodb", async () => {
    const checker = await getChecker("dynamodb");

    expect(checker).toBeDefined();
  });

  it("returns a checker for logs", async () => {
    const checker = await getChecker("logs");

    expect(checker).toBeDefined();
  });

  it("returns a checker for ecs", async () => {
    const checker = await getChecker("ecs");

    expect(checker).toBeDefined();
  });

  it("returns a checker for rds", async () => {
    const checker = await getChecker("rds");

    expect(checker).toBeDefined();
  });

  it("returns a checker for ec2", async () => {
    const checker = await getChecker("ec2");

    expect(checker).toBeDefined();
  });

  it("returns a checker for elasticache", async () => {
    const checker = await getChecker("elasticache");

    expect(checker).toBeDefined();
  });

  it("returns a checker for elasticloadbalancing", async () => {
    const checker = await getChecker("elasticloadbalancing");

    expect(checker).toBeDefined();
  });

  it("returns a checker for sqs", async () => {
    const checker = await getChecker("sqs");

    expect(checker).toBeDefined();
  });

  it("returns a checker for sns", async () => {
    const checker = await getChecker("sns");

    expect(checker).toBeDefined();
  });

  it("returns a checker for iam", async () => {
    const checker = await getChecker("iam");

    expect(checker).toBeDefined();
  });

  it("returns a checker for secretsmanager", async () => {
    const checker = await getChecker("secretsmanager");

    expect(checker).toBeDefined();
  });

  it("caches the checker on subsequent calls", async () => {
    const first = await getChecker("s3");
    const second = await getChecker("s3");

    expect(first).toBe(second);
  });
});
