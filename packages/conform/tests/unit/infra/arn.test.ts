import { describe, it, expect } from "vitest";

import { isValidArn, parseArn } from "../../../src/infra/arn.js";

describe("isValidArn", () => {
  it("returns true for a standard ARN", () => {
    expect(isValidArn("arn:aws:s3:::my-bucket")).toBe(true);
  });

  it("returns true for ARN with 7 parts", () => {
    expect(isValidArn("arn:aws:lambda:us-east-1:123456:function:my-func")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isValidArn("")).toBe(false);
  });

  it("returns false for non-arn prefix", () => {
    expect(isValidArn("projects/my-project/locations/us")).toBe(false);
  });

  it("returns false for arn with too few parts", () => {
    expect(isValidArn("arn:aws:s3:us:")).toBe(false);
  });

  it("returns true for exactly 6 parts", () => {
    expect(isValidArn("arn:aws:s3:::bucket")).toBe(true);
  });
});

describe("parseArn", () => {
  it("returns null for invalid ARN", () => {
    expect(parseArn("not-an-arn")).toBeNull();
  });

  it("parses S3 bucket ARN", () => {
    const result = parseArn("arn:aws:s3:::my-bucket");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "s3",
      region: "",
      accountId: "",
      resourceType: "bucket",
      resourceId: "my-bucket",
      raw: "arn:aws:s3:::my-bucket",
    });
  });

  it("parses S3 object ARN with path", () => {
    const result = parseArn("arn:aws:s3:::my-bucket/path/to/key");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "s3",
      region: "",
      accountId: "",
      resourceType: "object",
      resourceId: "my-bucket/path/to/key",
      raw: "arn:aws:s3:::my-bucket/path/to/key",
    });
  });

  it("parses Lambda function ARN", () => {
    const result = parseArn("arn:aws:lambda:us-east-1:123456789012:function:my-func");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "lambda",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "function",
      resourceId: "my-func",
      raw: "arn:aws:lambda:us-east-1:123456789012:function:my-func",
    });
  });

  it("parses Lambda function ARN with version qualifier", () => {
    const result = parseArn("arn:aws:lambda:us-east-1:123456789012:function:my-func:v1");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "lambda",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "function",
      resourceId: "my-func",
      raw: "arn:aws:lambda:us-east-1:123456789012:function:my-func:v1",
    });
  });

  it("parses Lambda layer ARN", () => {
    const result = parseArn("arn:aws:lambda:us-east-1:123456789012:layer:my-layer");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "lambda",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "layer",
      resourceId: "my-layer",
      raw: "arn:aws:lambda:us-east-1:123456789012:layer:my-layer",
    });
  });

  it("parses Lambda layer ARN with version", () => {
    const result = parseArn("arn:aws:lambda:us-east-1:123456789012:layer:my-layer:3");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "lambda",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "layer",
      resourceId: "my-layer",
      raw: "arn:aws:lambda:us-east-1:123456789012:layer:my-layer:3",
    });
  });

  it("parses Lambda resource without function: prefix", () => {
    const result = parseArn("arn:aws:lambda:us-east-1:123456789012:my-func");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "lambda",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "function",
      resourceId: "my-func",
      raw: "arn:aws:lambda:us-east-1:123456789012:my-func",
    });
  });

  it("parses DynamoDB table ARN", () => {
    const result = parseArn("arn:aws:dynamodb:us-east-1:123456789012:table/my-table");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "dynamodb",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "table",
      resourceId: "my-table",
      raw: "arn:aws:dynamodb:us-east-1:123456789012:table/my-table",
    });
  });

  it("parses DynamoDB index ARN", () => {
    const result = parseArn("arn:aws:dynamodb:us-east-1:123456789012:table/my-table/index/my-index");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "dynamodb",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "index",
      resourceId: "my-table/index/my-index",
      raw: "arn:aws:dynamodb:us-east-1:123456789012:table/my-table/index/my-index",
    });
  });

  it("parses DynamoDB resource without table/ prefix", () => {
    const result = parseArn("arn:aws:dynamodb:us-east-1:123456789012:my-resource");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "dynamodb",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "table",
      resourceId: "my-resource",
      raw: "arn:aws:dynamodb:us-east-1:123456789012:my-resource",
    });
  });

  it("parses SQS queue ARN", () => {
    const result = parseArn("arn:aws:sqs:us-east-1:123456789012:my-queue");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "sqs",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "queue",
      resourceId: "my-queue",
      raw: "arn:aws:sqs:us-east-1:123456789012:my-queue",
    });
  });

  it("parses SNS topic ARN", () => {
    const result = parseArn("arn:aws:sns:us-east-1:123456789012:my-topic");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "sns",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "topic",
      resourceId: "my-topic",
      raw: "arn:aws:sns:us-east-1:123456789012:my-topic",
    });
  });

  it("parses IAM role ARN", () => {
    const result = parseArn("arn:aws:iam::123456789012:role/my-role");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "iam",
      region: "",
      accountId: "123456789012",
      resourceType: "role",
      resourceId: "my-role",
      raw: "arn:aws:iam::123456789012:role/my-role",
    });
  });

  it("parses IAM user ARN", () => {
    const result = parseArn("arn:aws:iam::123456789012:user/my-user");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "iam",
      region: "",
      accountId: "123456789012",
      resourceType: "user",
      resourceId: "my-user",
      raw: "arn:aws:iam::123456789012:user/my-user",
    });
  });

  it("parses IAM policy ARN", () => {
    const result = parseArn("arn:aws:iam::123456789012:policy/my-policy");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "iam",
      region: "",
      accountId: "123456789012",
      resourceType: "policy",
      resourceId: "my-policy",
      raw: "arn:aws:iam::123456789012:policy/my-policy",
    });
  });

  it("parses IAM resource with colon separator", () => {
    const result = parseArn("arn:aws:iam::123456789012:instance-profile:my-profile");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "iam",
      region: "",
      accountId: "123456789012",
      resourceType: "instance-profile",
      resourceId: "my-profile",
      raw: "arn:aws:iam::123456789012:instance-profile:my-profile",
    });
  });

  it("parses IAM resource without known prefix", () => {
    const result = parseArn("arn:aws:iam::123456789012:something");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "iam",
      region: "",
      accountId: "123456789012",
      resourceType: "",
      resourceId: "something",
      raw: "arn:aws:iam::123456789012:something",
    });
  });

  it("parses Secrets Manager ARN with secret: prefix", () => {
    const result = parseArn("arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "secretsmanager",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "secret",
      resourceId: "my-secret",
      raw: "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret",
    });
  });

  it("parses Secrets Manager ARN without secret: prefix", () => {
    const result = parseArn("arn:aws:secretsmanager:us-east-1:123456789012:my-secret");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "secretsmanager",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "secret",
      resourceId: "my-secret",
      raw: "arn:aws:secretsmanager:us-east-1:123456789012:my-secret",
    });
  });

  it("parses CloudWatch Logs log-group ARN", () => {
    const result = parseArn("arn:aws:logs:us-east-1:123456789012:log-group:/my/log:*");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "logs",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "log-group",
      resourceId: "/my/log",
      raw: "arn:aws:logs:us-east-1:123456789012:log-group:/my/log:*",
    });
  });

  it("parses CloudWatch Logs log-group ARN without wildcard", () => {
    const result = parseArn("arn:aws:logs:us-east-1:123456789012:log-group:/my/log");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "logs",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "log-group",
      resourceId: "/my/log",
      raw: "arn:aws:logs:us-east-1:123456789012:log-group:/my/log",
    });
  });

  it("parses Logs resource without log-group: prefix", () => {
    const result = parseArn("arn:aws:logs:us-east-1:123456789012:something");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "logs",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "log-group",
      resourceId: "something",
      raw: "arn:aws:logs:us-east-1:123456789012:something",
    });
  });

  it("parses generic service ARN with slash separator", () => {
    const result = parseArn("arn:aws:ec2:us-east-1:123456789012:instance/i-12345");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "ec2",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "instance",
      resourceId: "i-12345",
      raw: "arn:aws:ec2:us-east-1:123456789012:instance/i-12345",
    });
  });

  it("parses generic service ARN with colon separator", () => {
    const result = parseArn("arn:aws:rds:us-east-1:123456789012:db:my-db");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "rds",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "db",
      resourceId: "my-db",
      raw: "arn:aws:rds:us-east-1:123456789012:db:my-db",
    });
  });

  it("parses generic service ARN without separator", () => {
    const result = parseArn("arn:aws:elasticache:us-east-1:123456789012:my-resource");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws",
      service: "elasticache",
      region: "us-east-1",
      accountId: "123456789012",
      resourceType: "",
      resourceId: "my-resource",
      raw: "arn:aws:elasticache:us-east-1:123456789012:my-resource",
    });
  });

  it("parses ARN with aws-cn partition", () => {
    const result = parseArn("arn:aws-cn:s3:::bucket");
    expect(result).toEqual({
      cloud: "aws",
      partition: "aws-cn",
      service: "s3",
      region: "",
      accountId: "",
      resourceType: "bucket",
      resourceId: "bucket",
      raw: "arn:aws-cn:s3:::bucket",
    });
  });
});
