/**
 * GCP checker registry with lazy loading
 */

import type { GcpResourceChecker } from "../types.js";

/**
 * Supported GCP services for resource checking
 */
export const SUPPORTED_GCP_SERVICES = ["run", "secretmanager", "artifactregistry", "iam"] as const;

export type SupportedGcpService = (typeof SUPPORTED_GCP_SERVICES)[number];

/**
 * Check if a GCP service is supported
 */
export function isSupportedGcpService(service: string): service is SupportedGcpService {
  return SUPPORTED_GCP_SERVICES.includes(service as SupportedGcpService);
}

/**
 * Factory functions for GCP checkers (lazy-loaded)
 */
const checkerFactories: Record<SupportedGcpService, () => Promise<GcpResourceChecker>> = {
  run: async () => (await import("./cloudrun.js")).CloudRunChecker,
  secretmanager: async () => (await import("./secretmanager.js")).SecretManagerChecker,
  artifactregistry: async () => (await import("./artifactregistry.js")).ArtifactRegistryChecker,
  iam: async () => (await import("./iam.js")).ServiceAccountChecker,
};

/**
 * Cache of loaded GCP checkers
 */
const checkerCache = new Map<SupportedGcpService, GcpResourceChecker>();

/**
 * Get a GCP checker for a service, loading it if necessary
 */
export async function getGcpChecker(service: string): Promise<GcpResourceChecker | undefined> {
  if (!isSupportedGcpService(service)) {
    return undefined;
  }

  const cached = checkerCache.get(service);
  if (cached) {
    return cached;
  }

  const factory = checkerFactories[service];
  const checker = await factory();
  checkerCache.set(service, checker);

  return checker;
}
