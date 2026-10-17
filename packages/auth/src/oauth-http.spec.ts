import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { hardenOAuth2 } from './oauth-http.js';

type Callback = (err: unknown, ...rest: unknown[]) => void;

function fakeStrategy(get: (url: string, token: string | null, cb: Callback) => void) {
  const requests: Array<EventEmitter & { destroy: (e?: Error) => void; options?: Record<string, unknown> }> = [];
  const oauth2 = {
    get,
    _executeRequest(
      lib: { request: (o: Record<string, unknown>) => unknown },
      options: Record<string, unknown>,
    ) {
      lib.request(options);
    },
  };
  const lib = {
    request: (options: Record<string, unknown>) => {
      const req = Object.assign(new EventEmitter(), {
        destroy: (e?: Error) => req.emit('error', e),
        options,
      });
      requests.push(req);
      return req;
    },
  };
  return { strategy: { _oauth2: oauth2 }, oauth2, lib, requests };
}

describe('hardenOAuth2', () => {
  it('sets a timeout on every request and destroys it when the socket times out', () => {
    const { strategy, oauth2, lib, requests } = fakeStrategy(() => {});
    hardenOAuth2(strategy, { timeoutMs: 1234 });

    oauth2._executeRequest(lib, { host: 'example.test' });
    const [req] = requests;
    expect(req?.options?.timeout).toBe(1234);

    let error: unknown;
    req?.on('error', (e) => (error = e));
    req?.emit('timeout');
    expect((error as Error).message).toBe('request timed out');
  });

  it('retries a transient profile GET failure and returns the eventual body', async () => {
    let calls = 0;
    const { strategy, oauth2 } = fakeStrategy((_url, _token, cb) => {
      calls += 1;
      if (calls < 2) cb({ statusCode: 503, data: 'down' });
      else cb(null, 'profile-body', {});
    });
    hardenOAuth2(strategy, { retries: 2 });

    const result = await new Promise<unknown[]>((resolve, reject) => {
      oauth2.get('https://api.test/user', 'tok', (err, ...rest) => (err ? reject(err) : resolve(rest)));
    });
    expect(result[0]).toBe('profile-body');
    expect(calls).toBe(2);
  });

  it('does not retry a 401 from the profile GET', async () => {
    let calls = 0;
    const { strategy, oauth2 } = fakeStrategy((_url, _token, cb) => {
      calls += 1;
      cb({ statusCode: 401, data: 'bad token' });
    });
    hardenOAuth2(strategy);

    const err = await new Promise((resolve) => oauth2.get('u', 't', resolve));
    expect(err).toEqual({ statusCode: 401, data: 'bad token' });
    expect(calls).toBe(1);
  });

  it('ignores a strategy without _oauth2', () => {
    expect(() => hardenOAuth2({})).not.toThrow();
  });
});
