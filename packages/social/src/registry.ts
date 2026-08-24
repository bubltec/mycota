import { assertSupported, PLATFORM_CAPABILITIES } from './capabilities.js';
import type { PlatformPost, PublishResult, SocialPlatform, SocialPublisher } from './ports.js';

export class UnsupportedPlatformError extends Error {
  constructor(public readonly platform: SocialPlatform) {
    super(`no publisher registered for ${platform}`);
    this.name = 'UnsupportedPlatformError';
  }
}

/**
 * Fan-out dispatcher. Use cases talk to this, not to Meta/TikTok/X clients.
 * Missing adapters fail closed with a typed error instead of silently no-op.
 */
export class SocialPublisherRegistry {
  private readonly publishers = new Map<SocialPlatform, SocialPublisher>();

  register(publisher: SocialPublisher): this {
    this.publishers.set(publisher.platform, publisher);
    return this;
  }

  get(platform: SocialPlatform): SocialPublisher {
    const publisher = this.publishers.get(platform);
    if (!publisher) throw new UnsupportedPlatformError(platform);
    return publisher;
  }

  async publish(post: PlatformPost): Promise<PublishResult> {
    assertSupported(post.platform, post.kind);
    return this.get(post.platform).publish(post);
  }

  async publishAll(posts: PlatformPost[]): Promise<PublishResult[]> {
    return Promise.all(posts.map((post) => this.publish(post)));
  }

  supportedKinds(platform: SocialPlatform): string[] {
    const registered = this.publishers.get(platform);
    return registered?.capabilities() ?? PLATFORM_CAPABILITIES[platform];
  }
}
