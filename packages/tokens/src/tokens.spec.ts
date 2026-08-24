import { describe, expect, it, vi } from 'vitest';
import { EncryptedTokenStore } from './encrypted.store.js';
import { MemoryTokenStore } from './memory.store.js';
import { tiktokTokenRefresher } from './oauth-refresh.js';
import { AesGcmSecretBox, PlainSecretBox } from './secret-box.js';
import { ReauthRequiredError, TokenVault } from './vault.js';

describe('TokenVault', () => {
  it('refreshes before expiry and stores the new access token', async () => {
    const store = new MemoryTokenStore();
    const refresher = { refresh: vi.fn(async () => ({ accessToken: 'new', refreshToken: 'r2', expiresAt: '2026-09-02T00:00:00.000Z' })) };
    const vault = new TokenVault({
      store,
      refreshers: { tiktok: refresher },
      clock: () => new Date('2026-09-01T00:00:00.000Z'),
      refreshSkewMs: 60_000,
    });
    await vault.put({
      provider: 'tiktok',
      subjectId: 'acct_1',
      tokens: {
        accessToken: 'old',
        refreshToken: 'r1',
        expiresAt: '2026-09-01T00:00:30.000Z',
      },
    });
    const result = await vault.accessToken('tiktok', 'acct_1');
    expect(result.accessToken).toBe('new');
    expect(refresher.refresh).toHaveBeenCalled();
  });

  it('marks needs_reauth when refresh fails', async () => {
    const store = new MemoryTokenStore();
    const vault = new TokenVault({
      store,
      refreshers: {
        instagram: { refresh: async () => { throw new Error('invalid_grant'); } },
      },
      clock: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    await vault.put({
      provider: 'instagram',
      subjectId: 'ig_1',
      tokens: { accessToken: 'old', refreshToken: 'r', expiresAt: '2026-09-01T00:00:00.000Z' },
    });
    await expect(vault.accessToken('instagram', 'ig_1')).rejects.toBeInstanceOf(ReauthRequiredError);
    expect((await vault.get('instagram', 'ig_1'))?.health).toBe('needs_reauth');
  });
});

describe('EncryptedTokenStore', () => {
  it('round-trips through AES-GCM without leaving the raw access token in the inner store', async () => {
    const inner = new MemoryTokenStore();
    const key = new Uint8Array(32).fill(7);
    const store = new EncryptedTokenStore(inner, new AesGcmSecretBox(key));
    await store.put({
      provider: 'x',
      subjectId: 'acct_x',
      tokens: { accessToken: 'secret-token', refreshToken: 'rt' },
      health: 'ok',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    const raw = await inner.get('x', 'acct_x');
    expect(raw?.tokens.accessToken).not.toBe('secret-token');
    expect((await store.get('x', 'acct_x'))?.tokens.accessToken).toBe('secret-token');
  });

  it('plain box is identity (tests only)', async () => {
    const store = new EncryptedTokenStore(new MemoryTokenStore(), new PlainSecretBox());
    await store.put({
      provider: 'facebook',
      subjectId: 'p1',
      tokens: { accessToken: 'a' },
      health: 'ok',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    expect((await store.get('facebook', 'p1'))?.tokens.accessToken).toBe('a');
  });
});

describe('tiktokTokenRefresher', () => {
  it('posts refresh_token and maps expires_in', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'n', refresh_token: 'nr', expires_in: 3600 }), { status: 200 }),
    );
    const refresher = tiktokTokenRefresher(
      { clientId: 'id', clientSecret: 'sec' },
      { fetch: fetchFn },
    );
    const next = await refresher.refresh({ accessToken: 'old', refreshToken: 'r' });
    expect(next.accessToken).toBe('n');
    expect(next.refreshToken).toBe('nr');
    expect(fetchFn).toHaveBeenCalled();
  });
});
