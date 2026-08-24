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

export interface TikTokPublisherOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  tokens: TokenSet;
  /**
   * Direct Post requires TikTok production partnership approval. Until then
   * the adapter uploads to the creator's draft tray — the honest default.
   */
  allowDirectPost?: boolean;
}

/**
 * TikTok Content Posting API. Production direct-post is gated; sandbox and
 * most third-party tools only get drafts. Hootsuite-class outages in 2026
 * also showed this API is a single point of failure — callers should treat
 * `draft` as success, not a bug.
 */
export class TikTokSocialPublisher implements SocialPublisher {
  readonly platform = 'tiktok' as const;
  private readonly fetch: FetchLike;
  private readonly baseUrl: string;

  constructor(private readonly options: TikTokPublisherOptions) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = options.baseUrl ?? 'https://open.tiktokapis.com/v2';
  }

  capabilities(): SocialCapability[] {
    return this.options.allowDirectPost
      ? ['draft_only', 'direct_post']
      : PLATFORM_CAPABILITIES.tiktok;
  }

  async publish(post: PlatformPost): Promise<PublishResult> {
    const direct = post.kind === 'direct_post' && this.options.allowDirectPost;
    const path = direct ? '/post/publish/video/init/' : '/post/publish/inbox/video/init/';
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.tokens.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          post_info: { title: post.caption },
          source_info: { source: 'PULL_FROM_URL', video_url: post.media[0]?.url },
        }),
      });
      if (!response.ok) {
        throw new Error(`tiktok ${path} ${response.status}: ${await response.text()}`);
      }
      const body = (await response.json()) as { data?: { publish_id?: string } };
      return {
        platform: 'tiktok',
        status: direct ? 'published' : 'draft',
        remoteId: body.data?.publish_id,
      };
    } catch (err) {
      return {
        platform: 'tiktok',
        status: 'failed',
        error: {
          code: 'publish_failed',
          message: err instanceof Error ? err.message : 'tiktok request failed',
          retryable: true,
        },
      };
    }
  }
}

export function tiktokAuthorizationUrl(config: OAuthAppConfig, state: string): string {
  const params = new URLSearchParams({
    client_key: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    response_type: 'code',
    scope: 'video.upload,video.publish',
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}
