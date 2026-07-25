import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { AuthService } from './auth.service.js';
import type { MycotaAuthConfig } from './auth.config.js';
import type { SessionJwtPayload } from './auth.types.js';

function fakeContext(cookies: Record<string, string>): ExecutionContext {
  const request = { cookies, user: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const validPayload: SessionJwtPayload = {
  sub: 'user-1',
  provider: 'github',
  providerAccountId: '123',
  displayName: 'Ada Lovelace',
  verifiedContributor: true,
};

function guardWith(verify: (token: string) => SessionJwtPayload): JwtAuthGuard {
  const auth = { verifySessionToken: verify } as unknown as AuthService;
  const config: MycotaAuthConfig = {
    jwtSecret: 'unused',
    webOrigin: 'http://localhost',
    usersTableName: 'users',
    emailFromAddress: 'noreply@example.com',
    sessionCookieName: 'session',
  };
  return new JwtAuthGuard(auth, config);
}

describe('JwtAuthGuard', () => {
  it('rejects when the session cookie is missing entirely', () => {
    const guard = guardWith(() => validPayload);
    expect(() => guard.canActivate(fakeContext({}))).toThrow(UnauthorizedException);
  });

  it('rejects when the token fails verification', () => {
    const guard = guardWith(() => {
      throw new Error('bad signature');
    });
    expect(() => guard.canActivate(fakeContext({ session: 'garbage' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a valid token and attaches the user to the request', () => {
    const guard = guardWith(() => validPayload);
    const context = fakeContext({ session: 'valid-token' });

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    const request = context.switchToHttp().getRequest<{ user?: unknown }>();
    expect(request.user).toEqual({
      id: 'user-1',
      provider: 'github',
      providerAccountId: '123',
      displayName: 'Ada Lovelace',
      verifiedContributor: true,
    });
  });

  it('falls back to a default cookie name when config leaves it unset', () => {
    const auth = {
      verifySessionToken: vi.fn().mockReturnValue(validPayload),
    } as unknown as AuthService;
    const config: MycotaAuthConfig = {
      jwtSecret: 'unused',
      webOrigin: 'http://localhost',
      usersTableName: 'users',
      emailFromAddress: 'noreply@example.com',
      // sessionCookieName intentionally omitted
    };
    const guard = new JwtAuthGuard(auth, config);

    expect(guard.canActivate(fakeContext({ session: 'valid-token' }))).toBe(true);
  });
});
