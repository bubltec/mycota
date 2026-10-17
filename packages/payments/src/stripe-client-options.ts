/** Resilience knobs for the Stripe SDK client. Every field is optional. */
export interface StripeClientSettings {
  /** Per-request timeout in ms. Default 20000 (the SDK default is 80000). */
  timeoutMs?: number;
  /**
   * Automatic retries on network errors, 409/429 and 5xx. The SDK sends an idempotency key
   * with retried requests, so a retried charge or refund is not applied twice. Default 2.
   */
  maxNetworkRetries?: number;
}

/**
 * Options to pass as the second argument of `new Stripe(secretKey, options)`. This package does
 * not depend on the `stripe` SDK, so the app constructs the client; this keeps its timeout and
 * retry policy next to the adapters that rely on it.
 */
export function stripeClientOptions(settings: StripeClientSettings = {}): {
  timeout: number;
  maxNetworkRetries: number;
} {
  return {
    timeout: settings.timeoutMs ?? 20_000,
    maxNetworkRetries: settings.maxNetworkRetries ?? 2,
  };
}
