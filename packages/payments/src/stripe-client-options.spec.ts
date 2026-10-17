import { describe, expect, it } from 'vitest';
import { stripeClientOptions } from './stripe-client-options.js';

describe('stripeClientOptions', () => {
  it('defaults to a 20s timeout and 2 network retries', () => {
    expect(stripeClientOptions()).toEqual({ timeout: 20_000, maxNetworkRetries: 2 });
  });

  it('lets the app override either setting', () => {
    expect(stripeClientOptions({ timeoutMs: 5_000, maxNetworkRetries: 0 })).toEqual({
      timeout: 5_000,
      maxNetworkRetries: 0,
    });
  });
});
