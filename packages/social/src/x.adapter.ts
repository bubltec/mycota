import { createDefaultFetch } from './http.js';
import { PLATFORM_CAPABILITIES } from './capabilities.js';
import type {
  FetchLike,
  OAuthAppConfig,
  PlatformPost,
  PostInsights,
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
    this.fetch = options.fetch ?? createDefaultFetch();
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

  async insights(remoteId: string): Promise<PostInsights | undefined> {
    if (!remoteId) return undefined;
    try {
      const response = await this.fetch(
        `${this.baseUrl}/tweets/${encodeURIComponent(remoteId)}?tweet.fields=public_metrics`,
        { headers: { authorization: `Bearer ${this.options.tokens.accessToken}` } },
      );
      if (!response.ok) return undefined;
      const body = (await response.json()) as {
        data?: { public_metrics?: { impression_count?: number; like_count?: number; reply_count?: number; retweet_count?: number } };
      };
      const metrics = body.data?.public_metrics;
      if (!metrics) return undefined;
      return {
        impressions: metrics.impression_count,
        likes: metrics.like_count,
        comments: metrics.reply_count,
        shares: metrics.retweet_count,
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return undefined;
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
