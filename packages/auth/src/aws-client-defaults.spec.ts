import { describe, expect, it } from 'vitest';
import { awsClientDefaults } from './aws-client-defaults.js';

describe('awsClientDefaults', () => {
  it('applies safe defaults', () => {
    expect(awsClientDefaults()).toEqual({
      maxAttempts: 3,
      requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 },
    });
  });

  it('honours overrides and a per-client fallback timeout', () => {
    expect(awsClientDefaults({ maxAttempts: 5, connectionTimeoutMs: 1_000 }, 30_000)).toEqual({
      maxAttempts: 5,
      requestHandler: { connectionTimeout: 1_000, requestTimeout: 30_000 },
    });
  });
});
