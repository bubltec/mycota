import ky, { HTTPError } from 'ky';
import type { FetchLike } from './oauth-refresh.js';

// Statuses ky retries by default; only these are surfaced as HTTPError so the rest pass through untouched.
const RETRYABLE_STATUSES = new Set([408, 413, 429, 500, 502, 503, 504]);

/**
 * Default transport: per-attempt timeout, bounded total time, and retries with jittered
 * backoff on network errors, timeouts and 408/429/5xx. Ky only retries idempotent methods,
 * so a POST (e.g. publishing a post) is never repeated. Ky retries statuses by throwing
 * HTTPError (and consumes the body), so once retries are exhausted the error is turned
 * back into a plain Response, which keeps each caller's own status handling unchanged.
 */
export function createDefaultFetch(overrides: { timeout?: number; totalTimeout?: number } = {}): FetchLike {
  const client = ky.create({
    timeout: overrides.timeout ?? 10_000,
    totalTimeout: overrides.totalTimeout ?? 30_000,
    retry: { limit: 2, jitter: true, retryOnTimeout: true, maxRetryAfter: 10_000 },
    throwHttpErrors: (status) => RETRYABLE_STATUSES.has(status),
  });
  return async (url, init) => {
    try {
      return await client(url, init);
    } catch (error) {
      if (!(error instanceof HTTPError)) throw error;
      const { response, data } = error;
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      const body = data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data);
      return new Response(body, { status: response.status, statusText: response.statusText, headers });
    }
  };
}
