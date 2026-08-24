import { describe, expect, it } from 'vitest';
import { assertSupported, PLATFORM_CAPABILITIES } from './capabilities.js';

describe('PLATFORM_CAPABILITIES', () => {
  it('does not advertise Instagram Stories or TikTok direct post by default', () => {
    expect(PLATFORM_CAPABILITIES.instagram).not.toContain('story');
    expect(PLATFORM_CAPABILITIES.tiktok).toEqual(['draft_only']);
  });

  it('rejects unsupported kinds before any HTTP call', () => {
    expect(() => assertSupported('x', 'reel')).toThrow(/x cannot reel/);
  });
});
