const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
]);

/** A non-200 response, carrying the status so the retry policy can tell 503 from 404. */
export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`unexpected status ${status}`);
  }
}

/** A request that exceeded its time budget before any response arrived. */
export class RequestTimeoutError extends Error {
  constructor() {
    super('request timed out');
  }
}

/** True for failures worth another attempt: timeouts, dropped connections, 408/429/5xx. */
export function isTransientError(err: unknown): boolean {
  if (err instanceof RequestTimeoutError) return true;
  if (err instanceof HttpStatusError) return TRANSIENT_STATUSES.has(err.status);
  // node-oauth reports HTTP failures as { statusCode, data }.
  const statusCode = (err as { statusCode?: unknown } | null)?.statusCode;
  if (typeof statusCode === 'number') return TRANSIENT_STATUSES.has(statusCode);
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && TRANSIENT_CODES.has(code);
}

/** Runs `fn`, retrying transient failures with jittered exponential backoff. */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const { retries = 2, baseDelayMs = 300, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isTransientError(err)) throw err;
      await sleep(Math.random() * baseDelayMs * 2 ** attempt);
    }
  }
}
