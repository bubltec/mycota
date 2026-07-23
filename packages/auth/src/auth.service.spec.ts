import { describe, expect, it } from 'vitest';
import type { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';

// isAccountOldEnough doesn't touch the injected JwtService at all — a stub
// is enough, no need to construct a real one.
const authService = new AuthService({} as JwtService);

describe('AuthService.isAccountOldEnough', () => {
  it('returns false when the account has no creation date at all', () => {
    expect(authService.isAccountOldEnough(undefined, 30)).toBe(false);
  });

  it('returns false for an account younger than the threshold', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(authService.isAccountOldEnough(tenDaysAgo, 30)).toBe(false);
  });

  it('returns true for an account older than the threshold', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(authService.isAccountOldEnough(sixtyDaysAgo, 30)).toBe(true);
  });

  it('returns true exactly at the boundary', () => {
    const exactlyThirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(authService.isAccountOldEnough(exactlyThirtyDaysAgo, 30)).toBe(true);
  });
});
