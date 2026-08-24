import type { SocialCapability, SocialPlatform } from './ports.js';

/**
 * Honest capability map for official APIs as of 2026. This is the contract
 * the product UI should render — not "we post to TikTok" when the adapter
 * can only drop a draft.
 *
 * Sources: Meta Graph / Instagram content publishing docs (100 posts / 24h),
 * TikTok Content Posting API (direct post vs drafts; production partnership
 * gated), X API v2 (paid write access, per-post pricing on some endpoints).
 */
export const PLATFORM_CAPABILITIES: Record<SocialPlatform, SocialCapability[]> = {
  instagram: ['feed', 'reel', 'carousel'],
  facebook: ['feed', 'reel'],
  tiktok: ['draft_only'],
  x: ['feed'],
};

export const INSTAGRAM_DAILY_PUBLISH_LIMIT = 100;

export function assertSupported(platform: SocialPlatform, kind: SocialCapability): void {
  const allowed = PLATFORM_CAPABILITIES[platform];
  if (!allowed.includes(kind)) {
    throw new Error(`${platform} cannot ${kind} via the official API (supported: ${allowed.join(', ')})`);
  }
}
