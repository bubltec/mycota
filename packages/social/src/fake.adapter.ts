import { PLATFORM_CAPABILITIES } from './capabilities.js';
import type {
  PlatformPost,
  PublishResult,
  SocialCapability,
  SocialPlatform,
  SocialPublisher,
} from './ports.js';

export class FakeSocialPublisher implements SocialPublisher {
  readonly published: PlatformPost[] = [];

  constructor(readonly platform: SocialPlatform) {}

  capabilities(): SocialCapability[] {
    return PLATFORM_CAPABILITIES[this.platform];
  }

  async publish(post: PlatformPost): Promise<PublishResult> {
    this.published.push(post);
    const draft = post.kind === 'draft_only' || this.platform === 'tiktok';
    return {
      platform: this.platform,
      status: draft ? 'draft' : 'published',
      remoteId: `${this.platform}_${this.published.length}`,
    };
  }
}
