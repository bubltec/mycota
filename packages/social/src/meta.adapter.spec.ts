import { describe, expect, it, vi } from 'vitest';
import { MetaSocialPublisher } from './meta.adapter.js';

describe('MetaSocialPublisher', () => {
  it('creates a container then publishes it', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/media')) {
        return new Response(JSON.stringify({ id: 'container_1' }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'media_9' }), { status: 200 });
    });
    const publisher = new MetaSocialPublisher('instagram', {
      fetch: fetch as unknown as typeof globalThis.fetch,
      tokens: { accessToken: 'tok' },
      igUserId: '1784',
    });

    const result = await publisher.publish({
      platform: 'instagram',
      accountId: '1784',
      caption: 'Doors at 8',
      media: [{ url: 'https://cdn.local/poster.jpg', mimeType: 'image/jpeg' }],
      kind: 'feed',
    });

    expect(result).toEqual({ platform: 'instagram', status: 'published', remoteId: 'media_9' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('marks token errors as needs_reauth', async () => {
    const fetch = vi.fn(async () => new Response('oauth exception: session invalidated', { status: 401 }));
    const publisher = new MetaSocialPublisher('instagram', {
      fetch: fetch as unknown as typeof globalThis.fetch,
      tokens: { accessToken: 'expired' },
      igUserId: '1784',
    });
    const result = await publisher.publish({
      platform: 'instagram',
      accountId: '1784',
      caption: 'Doors at 8',
      media: [{ url: 'https://cdn.local/poster.jpg', mimeType: 'image/jpeg' }],
      kind: 'feed',
    });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('needs_reauth');
    expect(result.error?.retryable).toBe(false);
  });
});
