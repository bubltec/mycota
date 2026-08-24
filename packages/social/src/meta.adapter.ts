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

export interface MetaPublisherOptions {
  fetch?: FetchLike;
  graphBaseUrl?: string;
  tokens: TokenSet;
  /** Instagram professional account id, or Facebook page id. */
  igUserId?: string;
  pageId?: string;
}

/**
 * Instagram + Facebook publishing via the Graph API. Stories are omitted on
 * purpose: the Instagram content-publishing API still does not support them
 * the way feed/reels/carousels are supported, which is a common failure mode
 * in Buffer/Later/Zoho-class tools that advertise "Instagram" as a checkbox.
 */
export class MetaSocialPublisher implements SocialPublisher {
  readonly platform: 'instagram' | 'facebook';
  private readonly fetch: FetchLike;
  private readonly graphBaseUrl: string;

  constructor(
    platform: 'instagram' | 'facebook',
    private readonly options: MetaPublisherOptions,
  ) {
    this.platform = platform;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.graphBaseUrl = options.graphBaseUrl ?? 'https://graph.facebook.com/v22.0';
  }

  capabilities(): SocialCapability[] {
    return PLATFORM_CAPABILITIES[this.platform];
  }

  async publish(post: PlatformPost): Promise<PublishResult> {
    const targetId = this.platform === 'instagram' ? this.options.igUserId : this.options.pageId;
    if (!targetId) {
      return {
        platform: this.platform,
        status: 'failed',
        error: {
          code: 'not_configured',
          message: `${this.platform} account id missing`,
          retryable: false,
        },
      };
    }

    try {
      const container = await this.graphPost(`/${targetId}/media`, {
        caption: post.caption,
        image_url: post.media[0]?.url,
        media_type: post.kind === 'reel' ? 'REELS' : 'IMAGE',
        access_token: this.options.tokens.accessToken,
      });
      const published = await this.graphPost(`/${targetId}/media_publish`, {
        creation_id: container.id,
        access_token: this.options.tokens.accessToken,
      });
      return { platform: this.platform, status: 'published', remoteId: String(published.id) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'graph request failed';
      const reauth = /session|oauth|token/i.test(message);
      return {
        platform: this.platform,
        status: 'failed',
        error: {
          code: reauth ? 'needs_reauth' : 'publish_failed',
          message,
          retryable: !reauth,
        },
      };
    }
  }

  private async graphPost(path: string, body: Record<string, unknown>): Promise<{ id: string }> {
    const response = await this.fetch(`${this.graphBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`graph ${path} ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as { id: string };
  }
}

export function metaAuthorizationUrl(config: OAuthAppConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_content_publish,pages_show_list',
  });
  return `https://www.facebook.com/v22.0/dialog/oauth?${params.toString()}`;
}
