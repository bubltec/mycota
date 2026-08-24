export type {
  ConnectionHealth,
  FetchLike,
  MediaAsset,
  OAuthAppConfig,
  PlatformPost,
  PublishFailure,
  PublishResult,
  SocialAccount,
  SocialAuth,
  SocialCapability,
  SocialPlatform,
  SocialPublisher,
  TokenSet,
} from './ports.js';
export {
  INSTAGRAM_DAILY_PUBLISH_LIMIT,
  PLATFORM_CAPABILITIES,
  assertSupported,
} from './capabilities.js';
export { SocialPublisherRegistry, UnsupportedPlatformError } from './registry.js';
export { FakeSocialPublisher } from './fake.adapter.js';
export { MetaSocialPublisher, metaAuthorizationUrl, type MetaPublisherOptions } from './meta.adapter.js';
export {
  TikTokSocialPublisher,
  tiktokAuthorizationUrl,
  type TikTokPublisherOptions,
} from './tiktok.adapter.js';
export { XSocialPublisher, xAuthorizationUrl, type XPublisherOptions } from './x.adapter.js';
