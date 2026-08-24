import { describe, expect, it } from 'vitest';
import { FakeSocialPublisher } from './fake.adapter.js';
import { SocialPublisherRegistry, UnsupportedPlatformError } from './registry.js';

describe('SocialPublisherRegistry', () => {
  it('fans a campaign out per platform and keeps TikTok as a draft', async () => {
    const ig = new FakeSocialPublisher('instagram');
    const tt = new FakeSocialPublisher('tiktok');
    const registry = new SocialPublisherRegistry().register(ig).register(tt);

    const results = await registry.publishAll([
      {
        platform: 'instagram',
        accountId: 'ig_1',
        caption: 'Tickets on sale',
        media: [{ url: 'https://cdn.local/poster.jpg', mimeType: 'image/jpeg' }],
        kind: 'feed',
      },
      {
        platform: 'tiktok',
        accountId: 'tt_1',
        caption: 'Tickets on sale',
        media: [{ url: 'https://cdn.local/clip.mp4', mimeType: 'video/mp4', aspectRatio: '9:16' }],
        kind: 'draft_only',
      },
    ]);

    expect(results.map((r) => r.status)).toEqual(['published', 'draft']);
    expect(ig.published).toHaveLength(1);
    expect(tt.published).toHaveLength(1);
  });

  it('fails closed when a platform has no adapter', async () => {
    const registry = new SocialPublisherRegistry();
    await expect(
      registry.publish({
        platform: 'x',
        accountId: 'x_1',
        caption: 'hi',
        media: [],
        kind: 'feed',
      }),
    ).rejects.toBeInstanceOf(UnsupportedPlatformError);
  });
});
