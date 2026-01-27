/**
 * Shared AWS client factory with caching.
 * Eliminates duplicated client caching pattern across all AWS checker files.
 */

/**
 * Generic client constructor type
 */
type ClientConstructor<T> = new (config: { region: string }) => T;

/**
 * Creates a cached client factory for any AWS SDK client.
 * Clients are cached per region to avoid creating multiple instances.
 *
 * @param ClientClass - The AWS SDK client class constructor
 * @returns A function that returns a cached client for the given region
 *
 * @example
 * ```ts
 * import { S3Client } from "@aws-sdk/client-s3";
 *
 * const getS3Client = createClientFactory(S3Client);
 * const client = getS3Client("us-east-1");
 * ```
 */
export function createClientFactory<T>(
  ClientClass: ClientConstructor<T>
): (region: string) => T {
  const cache = new Map<string, T>();

  return (region: string): T => {
    let client = cache.get(region);
    if (!client) {
      client = new ClientClass({ region });
      cache.set(region, client);
    }
    return client;
  };
}

/**
 * Creates a cached client factory for AWS SDK clients that need custom config.
 * Useful for clients that need additional options beyond just region.
 *
 * @param createClient - Factory function that creates the client with config
 * @returns A function that returns a cached client for the given region
 *
 * @example
 * ```ts
 * import { S3Client } from "@aws-sdk/client-s3";
 *
 * const getS3Client = createClientFactoryWithConfig(
 *   (region) => new S3Client({ region, followRegionRedirects: true })
 * );
 * const client = getS3Client("us-east-1");
 * ```
 */
export function createClientFactoryWithConfig<T>(
  createClient: (region: string) => T
): (region: string) => T {
  const cache = new Map<string, T>();

  return (region: string): T => {
    let client = cache.get(region);
    if (!client) {
      client = createClient(region);
      cache.set(region, client);
    }
    return client;
  };
}
