/**
 * Checker registry with lazy loading
 *
 * Checkers are loaded on-demand to avoid loading all AWS SDK clients upfront.
 */

import type { ResourceChecker } from "./types.js";

/**
 * Supported AWS services for resource checking
 */
export const SUPPORTED_SERVICES = [
  "s3",
  "lambda",
  "dynamodb",
  "sqs",
  "sns",
  "iam",
  "secretsmanager",
  "logs",
  "ecs",
  "rds",
  "ec2",
  "elasticache",
  "elasticloadbalancing",
] as const;

export type SupportedService = (typeof SUPPORTED_SERVICES)[number];

/**
 * Check if a service is supported
 */
export function isSupportedService(service: string): service is SupportedService {
  return SUPPORTED_SERVICES.includes(service as SupportedService);
}

/**
 * Factory functions for checkers (lazy-loaded)
 */
const checkerFactories: Record<SupportedService, () => Promise<ResourceChecker>> = {
  s3: async () => (await import("./s3.js")).S3Checker,
  lambda: async () => (await import("./lambda.js")).LambdaChecker,
  dynamodb: async () => (await import("./dynamodb.js")).DynamoDBChecker,
  sqs: async () => (await import("./sqs.js")).SQSChecker,
  sns: async () => (await import("./sns.js")).SNSChecker,
  iam: async () => (await import("./iam.js")).IAMChecker,
  secretsmanager: async () => (await import("./secretsmanager.js")).SecretsManagerChecker,
  logs: async () => (await import("./cloudwatch.js")).CloudWatchLogsChecker,
  ecs: async () => (await import("./ecs.js")).ECSChecker,
  rds: async () => (await import("./rds.js")).RDSChecker,
  ec2: async () => (await import("./ec2.js")).EC2Checker,
  elasticache: async () => (await import("./elasticache.js")).ElastiCacheChecker,
  elasticloadbalancing: async () => (await import("./elb.js")).ELBChecker,
};

/**
 * Cache of loaded checkers
 */
const checkerCache = new Map<SupportedService, ResourceChecker>();

/**
 * Get a checker for a service, loading it if necessary
 *
 * @param service - The AWS service name
 * @returns The checker instance, or undefined if the service is not supported
 */
export async function getChecker(service: string): Promise<ResourceChecker | undefined> {
  if (!isSupportedService(service)) {
    return undefined;
  }

  // Return cached checker if available
  const cached = checkerCache.get(service);
  if (cached) {
    return cached;
  }

  // Load and cache the checker
  const factory = checkerFactories[service];
  const checker = await factory();
  checkerCache.set(service, checker);

  return checker;
}

/**
 * Clear the checker cache (useful for testing)
 */
export function clearCheckerCache(): void {
  checkerCache.clear();
}
