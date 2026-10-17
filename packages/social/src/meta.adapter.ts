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
    this.fetch = options.fetch ?? createDefaultFetch();
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

  async insights(remoteId: string): Promise<PostInsights | undefined> {
    if (!remoteId) return undefined;
    const token = this.options.tokens.accessToken;
    try {
      if (this.platform === 'instagram') {
        const metrics = 'views,reach,likes,comments,saved,shares';
        const body = await this.graphGet(`/${remoteId}/insights`, { metric: metrics, access_token: token });
        return insightsFromGraph(body);
      }
      const body = await this.graphGet(`/${remoteId}`, {
        fields: 'insights.metric(post_impressions),shares,likes.summary(true),comments.summary(true)',
        access_token: token,
      });
      return insightsFromFacebookPost(body);
    } catch {
      return undefined;
    }
  }

  private async graphGet(path: string, query: Record<string, string>): Promise<Record<string, unknown>> {
    const params = new URLSearchParams(query);
    const response = await this.fetch(`${this.graphBaseUrl}${path}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`graph ${path} ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as Record<string, unknown>;
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

/** Facebook Login for Business. Instagram Login and Threads use other dialogs. */
export const META_FACEBOOK_LOGIN_SCOPES = [
  'pages_show_list',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
];

export function metaAuthorizationUrl(config: OAuthAppConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    response_type: 'code',
    scope: META_FACEBOOK_LOGIN_SCOPES.join(','),
  });
  return `https://www.facebook.com/v22.0/dialog/oauth?${params.toString()}`;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function insightsFromGraph(body: Record<string, unknown>): PostInsights {
  const rows = Array.isArray(body.data) ? body.data : [];
  const byName = new Map<string, number>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as { name?: string; values?: Array<{ value?: unknown }> };
    const value = numberValue(item.values?.[0]?.value);
    if (item.name && value != null) byName.set(item.name, value);
  }
  return {
    impressions: byName.get('views') ?? byName.get('impressions') ?? byName.get('post_impressions'),
    reach: byName.get('reach'),
    likes: byName.get('likes'),
    comments: byName.get('comments'),
    shares: byName.get('shares') ?? byName.get('saved'),
    fetchedAt: new Date().toISOString(),
  };
}

function insightsFromFacebookPost(body: Record<string, unknown>): PostInsights {
  const insights = insightsFromGraph((body.insights as Record<string, unknown> | undefined) ?? {});
  const likes = body.likes as { summary?: { total_count?: unknown } } | undefined;
  const comments = body.comments as { summary?: { total_count?: unknown } } | undefined;
  const shares = body.shares as { count?: unknown } | undefined;
  return {
    impressions: insights.impressions,
    reach: insights.reach,
    likes: numberValue(likes?.summary?.total_count) ?? insights.likes,
    comments: numberValue(comments?.summary?.total_count) ?? insights.comments,
    shares: numberValue(shares?.count) ?? insights.shares,
    fetchedAt: new Date().toISOString(),
  };
}
