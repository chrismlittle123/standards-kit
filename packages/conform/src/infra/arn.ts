/**
 * ARN parsing utilities
 *
 * ARN format: arn:partition:service:region:account-id:resource
 * or: arn:partition:service:region:account-id:resource-type/resource-id
 * or: arn:partition:service:region:account-id:resource-type:resource-id
 */

import type { ParsedArn } from "./types.js";

interface ResourceParts {
  resourceType: string;
  resourceId: string;
}

/**
 * Validate that a string is a valid ARN format
 */
export function isValidArn(arn: string): boolean {
  if (!arn.startsWith("arn:")) {
    return false;
  }
  const parts = arn.split(":");
  // ARN must have at least 6 parts: arn:partition:service:region:account:resource
  return parts.length >= 6;
}

/**
 * Parse an ARN string into its components
 */
export function parseArn(arn: string): ParsedArn | null {
  if (!isValidArn(arn)) {
    return null;
  }

  const parts = arn.split(":");
  const [, partition, service, region, accountId, ...resourceParts] = parts;

  // Resource can contain colons, so we need to rejoin
  const resource = resourceParts.join(":");

  // Parse resource type and ID based on service-specific patterns
  const { resourceType, resourceId } = parseResource(service, resource);

  return {
    cloud: "aws" as const,
    partition,
    service,
    region,
    accountId,
    resourceType,
    resourceId,
    raw: arn,
  };
}

// Service-specific parsers
const serviceParsers: Record<string, (resource: string) => ResourceParts> = {
  s3: parseS3Resource,
  lambda: parseLambdaResource,
  dynamodb: parseDynamoDBResource,
  sqs: (resource) => ({ resourceType: "queue", resourceId: resource }),
  sns: (resource) => ({ resourceType: "topic", resourceId: resource }),
  iam: parseIAMResource,
  secretsmanager: parseSecretsManagerResource,
  logs: parseLogsResource,
};

function parseS3Resource(resource: string): ResourceParts {
  if (resource.includes("/")) {
    const [bucket, ...keyParts] = resource.split("/");
    return { resourceType: "object", resourceId: `${bucket}/${keyParts.join("/")}` };
  }
  return { resourceType: "bucket", resourceId: resource };
}

function parseLambdaResource(resource: string): ResourceParts {
  if (resource.startsWith("function:")) {
    const funcName = resource.slice("function:".length);
    const colonIndex = funcName.indexOf(":");
    const resourceId = colonIndex !== -1 ? funcName.slice(0, colonIndex) : funcName;
    return { resourceType: "function", resourceId };
  }
  if (resource.startsWith("layer:")) {
    const rest = resource.slice("layer:".length);
    const colonIndex = rest.indexOf(":");
    const resourceId = colonIndex !== -1 ? rest.slice(0, colonIndex) : rest;
    return { resourceType: "layer", resourceId };
  }
  return { resourceType: "function", resourceId: resource };
}

function parseDynamoDBResource(resource: string): ResourceParts {
  if (resource.startsWith("table/")) {
    const rest = resource.slice("table/".length);
    const indexPos = rest.indexOf("/index/");
    const resourceType = indexPos !== -1 ? "index" : "table";
    return { resourceType, resourceId: rest };
  }
  return { resourceType: "table", resourceId: resource };
}

function parseIAMResource(resource: string): ResourceParts {
  const prefixes = ["role/", "user/", "policy/"];
  for (const prefix of prefixes) {
    if (resource.startsWith(prefix)) {
      return {
        resourceType: prefix.slice(0, -1),
        resourceId: resource.slice(prefix.length),
      };
    }
  }
  const colonIndex = resource.indexOf(":");
  if (colonIndex !== -1) {
    return {
      resourceType: resource.slice(0, colonIndex),
      resourceId: resource.slice(colonIndex + 1),
    };
  }
  return { resourceType: "", resourceId: resource };
}

function parseSecretsManagerResource(resource: string): ResourceParts {
  if (resource.startsWith("secret:")) {
    return { resourceType: "secret", resourceId: resource.slice("secret:".length) };
  }
  return { resourceType: "secret", resourceId: resource };
}

function parseLogsResource(resource: string): ResourceParts {
  if (resource.startsWith("log-group:")) {
    let logGroupName = resource.slice("log-group:".length);
    if (logGroupName.endsWith(":*")) {
      logGroupName = logGroupName.slice(0, -2);
    }
    return { resourceType: "log-group", resourceId: logGroupName };
  }
  return { resourceType: "log-group", resourceId: resource };
}

function parseGenericResource(resource: string): ResourceParts {
  if (resource.includes("/")) {
    const slashIndex = resource.indexOf("/");
    return {
      resourceType: resource.slice(0, slashIndex),
      resourceId: resource.slice(slashIndex + 1),
    };
  }
  if (resource.includes(":")) {
    const colonIndex = resource.indexOf(":");
    return {
      resourceType: resource.slice(0, colonIndex),
      resourceId: resource.slice(colonIndex + 1),
    };
  }
  return { resourceType: "", resourceId: resource };
}

/**
 * Parse the resource portion of an ARN into type and ID
 */
function parseResource(service: string, resource: string): ResourceParts {
  const parser = serviceParsers[service] as ((r: string) => ResourceParts) | undefined;
  return parser ? parser(resource) : parseGenericResource(resource);
}
