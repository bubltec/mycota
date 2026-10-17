import { describe, expect, it } from 'vitest';
import {
  HttpStatusError,
  RequestTimeoutError,
  isTransientError,
  withTransientRetry,
} from './transient-retry.js';

const noSleep = async () => {};

describe('isTransientError', () => {
  it('treats timeouts, 5xx/429 and dropped connections as transient', () => {
    expect(isTransientError(new RequestTimeoutError())).toBe(true);
    expect(isTransientError(new HttpStatusError(503))).toBe(true);
    expect(isTransientError(new HttpStatusError(429))).toBe(true);
    expect(isTransientError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true);
  });

  it('does not retry 404, private-address or oversize failures', () => {
    expect(isTransientError(new HttpStatusError(404))).toBe(false);
    expect(isTransientError(new Error('x has no publicly-routable address'))).toBe(false);
    expect(isTransientError(new Error('response too large'))).toBe(false);
  });
});

describe('withTransientRetry', () => {
  it('retries a transient failure and returns the eventual result', async () => {
    let calls = 0;
    const result = await withTransientRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new HttpStatusError(503);
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up after the retry limit and rethrows', async () => {
    let calls = 0;
    await expect(
      withTransientRetry(
        async () => {
          calls += 1;
          throw new RequestTimeoutError();
        },
        { retries: 1, sleep: noSleep },
      ),
    ).rejects.toThrow('request timed out');
    expect(calls).toBe(2);
  });

  it('does not retry a permanent failure', async () => {
    let calls = 0;
    await expect(
      withTransientRetry(
        async () => {
          calls += 1;
          throw new HttpStatusError(404);
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow('unexpected status 404');
    expect(calls).toBe(1);
  });
});
