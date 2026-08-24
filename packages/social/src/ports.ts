export type SocialPlatform = 'instagram' | 'facebook' | 'tiktok' | 'x';

/**
 * What a given account is actually allowed to do through official APIs.
 * Callers should branch on this instead of assuming "post everywhere".
 */
export type SocialCapability =
  | 'feed'
  | 'reel'
  | 'story'
  | 'carousel'
  | 'direct_post'
  | 'draft_only';

export type ConnectionHealth = 'ok' | 'needs_reauth' | 'degraded';

export interface SocialAccount {
  platform: SocialPlatform;
  accountId: string;
  displayName: string;
  capabilities: SocialCapability[];
  health: ConnectionHealth;
}

export interface MediaAsset {
  url: string;
  mimeType: string;
  /** e.g. '9:16', '1:1', '16:9' — adapters reject unsupported ratios. */
  aspectRatio?: string;
}

export interface PlatformPost {
  platform: SocialPlatform;
  accountId: string;
  caption: string;
  media: MediaAsset[];
  kind: SocialCapability;
  /** ISO-8601. Adapters that cannot schedule natively return `status: 'scheduled'` for the app to retry later. */
  scheduledAt?: string;
}

export interface PublishFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PublishResult {
  platform: SocialPlatform;
  status: 'published' | 'draft' | 'failed' | 'queued';
  remoteId?: string;
  error?: PublishFailure;
}

export interface SocialPublisher {
  readonly platform: SocialPlatform;
  capabilities(): SocialCapability[];
  publish(post: PlatformPost): Promise<PublishResult>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OAuthAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface SocialAuth {
  authorizationUrl(state: string, scopes?: string[]): string;
  exchangeCode(code: string): Promise<{ account: SocialAccount; tokens: TokenSet }>;
}
