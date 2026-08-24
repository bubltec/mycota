import type { TokenRefresher, TokenSet } from './ports.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OAuthAppConfig {
  clientId: string;
  clientSecret: string;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) throw new Error(`oauth ${response.status}: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

function requireRefreshToken(tokens: TokenSet): string {
  if (!tokens.refreshToken) throw new Error('refresh token missing');
  return tokens.refreshToken;
}

function expiryFromExpiresIn(expiresIn: unknown): string | undefined {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function metaTokenRefresher(
  config: OAuthAppConfig,
  options: { fetch?: FetchLike; graphBaseUrl?: string } = {},
): TokenRefresher {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.graphBaseUrl ?? 'https://graph.facebook.com/v22.0';
  return {
    async refresh(tokens: TokenSet): Promise<TokenSet> {
      const params = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        fb_exchange_token: tokens.accessToken,
      });
      const body = await readJson(await fetchFn(`${base}/oauth/access_token?${params}`));
      return {
        accessToken: String(body.access_token ?? ''),
        refreshToken: tokens.refreshToken,
        expiresAt: expiryFromExpiresIn(body.expires_in),
      };
    },
  };
}

export function tiktokTokenRefresher(
  config: OAuthAppConfig,
  options: { fetch?: FetchLike; tokenUrl?: string } = {},
): TokenRefresher {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const tokenUrl = options.tokenUrl ?? 'https://open.tiktokapis.com/v2/oauth/token/';
  return {
    async refresh(tokens: TokenSet): Promise<TokenSet> {
      const refreshToken = requireRefreshToken(tokens);
      const body = await readJson(
        await fetchFn(tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_key: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
        }),
      );
      const data = (body.data as Record<string, unknown> | undefined) ?? body;
      return {
        accessToken: String(data.access_token ?? ''),
        refreshToken: String(data.refresh_token ?? refreshToken),
        expiresAt: expiryFromExpiresIn(data.expires_in),
      };
    },
  };
}

export function xTokenRefresher(
  config: OAuthAppConfig,
  options: { fetch?: FetchLike; tokenUrl?: string } = {},
): TokenRefresher {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const tokenUrl = options.tokenUrl ?? 'https://api.x.com/2/oauth2/token';
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  return {
    async refresh(tokens: TokenSet): Promise<TokenSet> {
      const refreshToken = requireRefreshToken(tokens);
      const body = await readJson(
        await fetchFn(tokenUrl, {
          method: 'POST',
          headers: {
            authorization: `Basic ${basic}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
        }),
      );
      return {
        accessToken: String(body.access_token ?? ''),
        refreshToken: String(body.refresh_token ?? refreshToken),
        expiresAt: expiryFromExpiresIn(body.expires_in),
      };
    },
  };
}
