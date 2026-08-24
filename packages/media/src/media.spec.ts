import { describe, expect, it, vi } from 'vitest';
import { FakeMediaStore } from './fake.adapter.js';
import { S3MediaStore, type ObjectStoreClient } from './index.js';

describe('FakeMediaStore', () => {
  it('round-trips bytes and signs private URLs', async () => {
    const store = new FakeMediaStore();
    const body = new TextEncoder().encode('flyer');
    const stored = await store.put({
      key: 'events/e1/flyer.pdf',
      body,
      contentType: 'application/pdf',
      visibility: 'private',
    });
    expect(stored.url).toBe('memory://events/e1/flyer.pdf?exp=3600');
    expect((await store.get(stored.key))?.contentType).toBe('application/pdf');
    await store.delete(stored.key);
    expect(await store.get(stored.key)).toBeUndefined();
  });
});

describe('S3MediaStore', () => {
  it('uses the public base URL for public objects and signs private ones', async () => {
    const client: ObjectStoreClient = {
      putObject: vi.fn(async () => undefined),
      getObject: vi.fn(async () => undefined),
      deleteObject: vi.fn(async () => undefined),
      getSignedUrl: vi.fn(async (key, exp) => `https://signed.local/${key}?e=${exp}`),
    };
    const store = new S3MediaStore(client, { publicBaseUrl: 'https://cdn.example.com/' });
    const poster = await store.put({
      key: 'posters/a.jpg',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
      visibility: 'public',
    });
    expect(poster.url).toBe('https://cdn.example.com/posters/a.jpg');

    const privateShot = await store.put({
      key: 'merch/sku.png',
      body: new Uint8Array([4]),
      contentType: 'image/png',
      visibility: 'private',
    });
    expect(privateShot.url).toContain('signed.local');
  });
});
