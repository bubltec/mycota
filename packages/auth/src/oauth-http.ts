import { RequestTimeoutError, withTransientRetry } from './transient-retry.js';

export interface OAuthHttpSettings {
  /** Per-request timeout. Default 10000. */
  timeoutMs?: number;
  /** Retries for the profile GET only; the single-use code exchange is never retried. Default 2. */
  retries?: number;
}

type Callback = (err: unknown, ...rest: unknown[]) => void;

/** The slice of node-oauth's `OAuth2` (used by passport-oauth2 as `_oauth2`) that we patch. */
interface OAuth2Like {
  _executeRequest: (
    lib: { request: (options: Record<string, unknown>) => RequestLike },
    options: Record<string, unknown>,
    body: unknown,
    callback: Callback,
  ) => void;
  get: (url: string, accessToken: string | null, callback: Callback) => void;
}

interface RequestLike {
  on: (event: 'timeout', listener: () => void) => unknown;
  destroy: (error?: Error) => unknown;
}

/**
 * passport-oauth2 (and so the GitHub, Google, Facebook, Microsoft and Apple strategies) uses
 * node-oauth, which has no request timeout and no retry. This adds both on the strategy's
 * `_oauth2` instance: every request is destroyed after `timeoutMs`, and the profile GET is
 * retried on transient failures. The code-for-token POST is not retried because an authorization
 * code is single use.
 */
export function hardenOAuth2(strategy: object, settings: OAuthHttpSettings = {}): void {
  const oauth2 = (strategy as { _oauth2?: OAuth2Like })._oauth2;
  if (!oauth2) return;
  const timeoutMs = settings.timeoutMs ?? 10_000;
  const retries = settings.retries ?? 2;

  const executeRequest = oauth2._executeRequest.bind(oauth2);
  oauth2._executeRequest = (lib, options, body, callback) => {
    const timedLib = {
      request: (requestOptions: Record<string, unknown>) => {
        const req = lib.request({ ...requestOptions, timeout: timeoutMs });
        req.on('timeout', () => req.destroy(new RequestTimeoutError()));
        return req;
      },
    };
    executeRequest(timedLib, options, body, callback);
  };

  const get = oauth2.get.bind(oauth2);
  oauth2.get = (url, accessToken, callback) => {
    withTransientRetry(
      () =>
        new Promise<unknown[]>((resolve, reject) => {
          get(url, accessToken, (err, ...rest) => (err ? reject(err) : resolve(rest)));
        }),
      { retries },
    ).then(
      (rest) => callback(null, ...rest),
      (err) => callback(err),
    );
  };
}
