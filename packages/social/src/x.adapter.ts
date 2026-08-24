import { PLATFORM_CAPABILITIES } from './capabilities.js';
import type {
  FetchLike,
  OAuthAppConfig,
  PlatformPost,
  PublishResult,
  SocialCapability,
  SocialPublisher,
  TokenSet,
} from './ports.js';

export interface XPublisherOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  tokens: TokenSet;
}

/**
 * X API v2 tweets. Write access is paid; some post types are metered. The
 * adapter does not pretend to cover follows/likes (removed from self-serve).
 */
export class XSocialPublisher implements SocialPublisher {
  readonly platform = 'x' as const;
  private readonly fetch: FetchLike;
  private readonly baseUrl: string;

  constructor(private readonly options: XPublisherOptions) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = options.baseUrl ?? 'https://api.x.com/2';
  }

  capabilities(): SocialCapability[] {
    return PLATFORM_CAPABILITIES.x;
  }

  async publish(post: PlatformPost): Promise<PublishResult> {
    try {
      const response = await this.fetch(`${this.baseUrl}/tweets`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.tokens.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: post.caption }),
      });
      if (!response.ok) {
        throw new Error(`x /tweets ${response.status}: ${await response.text()}`);
      }
      const body = (await response.json()) as { data?: { id?: string } };
      return { platform: 'x', status: 'published', remoteId: body.data?.id };
    } catch (err) {
      return {
        platform: 'x',
        status: 'failed',
        error: {
          code: 'publish_failed',
          message: err instanceof Error ? err.message : 'x request failed',
          retryable: true,
        },
      };
    }
  }
}

export function xAuthorizationUrl(config: OAuthAppConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    response_type: 'code',
    scope: 'tweet.read tweet.write users.read offline.access',
    code_challenge_method: 'S256',
  });
  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}
