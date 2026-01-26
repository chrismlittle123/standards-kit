/**
 * Configuration for API retry behavior
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

/**
 * Sleep for the specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

/**
 * Calculate delay for exponential backoff with jitter
 */
function calculateBackoffDelay(attempt: number): number {
  const exponentialDelay = RETRY_CONFIG.initialDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, RETRY_CONFIG.maxDelayMs);
}

/**
 * Parse rate limit reset time from GitHub response headers
 */
function getRateLimitResetDelay(
  response: Awaited<ReturnType<typeof fetch>>
): number | null {
  const resetHeader = response.headers.get("x-ratelimit-reset");
  if (resetHeader) {
    const resetTime = parseInt(resetHeader, 10) * 1000;
    const now = Date.now();
    if (resetTime > now) {
      return Math.min(resetTime - now + 1000, RETRY_CONFIG.maxDelayMs);
    }
  }
  return null;
}

/**
 * Sanitize sensitive data (tokens) from error messages
 */
export function sanitizeError(message: string, token?: string): string {
  let sanitized = message;

  sanitized = sanitized.replace(
    /x-access-token:[^@\s]+@/g,
    "x-access-token:***@"
  );
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, "Bearer ***");
  sanitized = sanitized.replace(
    /Authorization:\s*[^\s]+/gi,
    "Authorization: ***"
  );

  if (token && token.length > 8) {
    sanitized = sanitized.replace(
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      "***"
    );
  }

  sanitized = sanitized.replace(/github_pat_[a-zA-Z0-9_]+/g, "github_pat_***");
  sanitized = sanitized.replace(/ghp_[a-zA-Z0-9]+/g, "ghp_***");
  sanitized = sanitized.replace(/gho_[a-zA-Z0-9]+/g, "gho_***");

  return sanitized;
}

/**
 * Fetch with automatic retry on rate limit and transient errors.
 */
export async function fetchWithRetry(
  url: string,
  options: Parameters<typeof fetch>[1],
  token?: string
): Promise<Awaited<ReturnType<typeof fetch>>> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      const shouldRetry =
        RETRY_CONFIG.retryableStatusCodes.includes(response.status) &&
        attempt < RETRY_CONFIG.maxRetries;

      if (shouldRetry) {
        const delayMs =
          response.status === 429
            ? (getRateLimitResetDelay(response) ??
              calculateBackoffDelay(attempt))
            : calculateBackoffDelay(attempt);
        await sleep(delayMs);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < RETRY_CONFIG.maxRetries) {
        await sleep(calculateBackoffDelay(attempt));
        continue;
      }
    }
  }

  throw new Error(
    `GitHub API request failed after ${RETRY_CONFIG.maxRetries} retries: ${sanitizeError(lastError?.message ?? "Unknown error", token)}`
  );
}
