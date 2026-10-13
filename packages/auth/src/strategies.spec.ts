import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AppleStrategy, decodeJwtClaims } from './apple.strategy.js';
import type { MycotaAuthConfig } from './auth.config.js';
import { FacebookStrategy } from './facebook.strategy.js';
import { MicrosoftStrategy } from './microsoft.strategy.js';
import { PROVIDER_KEY, ProviderEnabledGuard } from './provider-enabled.guard.js';

const base: MycotaAuthConfig = { jwtSecret: 's', webOrigin: 'http://x', usersTableName: 't', emailFromAddress: 'a@b.c' };
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

describe('strategies refuse to build without their config', () => {
  it.each([[AppleStrategy, 'Apple'], [FacebookStrategy, 'Facebook'], [MicrosoftStrategy, 'Microsoft']] as const)('%s', (S, name) => {
    expect(() => new S(base)).toThrow(`${name} sign-in is not configured`);
  });
});

describe('AppleStrategy.validate', () => {
  const strategy = new AppleStrategy({
    ...base,
    apple: {
      clientId: 'com.example.web',
      teamId: 'TEAM123456',
      keyId: 'KEY1234567',
      // Throwaway P-256 key; only parsed when a client secret is signed, never here.
      privateKey: '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----',
      callbackUrl: 'http://localhost/auth/apple/callback',
    },
  });

  it('maps sub and email from the id_token', () => {
    expect(strategy.validate('a', 'r', jwt({ sub: '001.abc', email: 'jane@example.com' }))).toEqual({
      provider: 'apple',
      providerAccountId: '001.abc',
      displayName: 'jane',
      email: 'jane@example.com',
    });
  });

  it('does not use a private-relay address as a display name', () => {
    expect(strategy.validate('a', 'r', jwt({ sub: 's', email: 'x1y2@privaterelay.appleid.com' })).displayName).toBe('Apple user');
  });

  it('rejects a token without sub or with a malformed body', () => {
    expect(() => strategy.validate('a', 'r', jwt({ email: 'x@y.z' }))).toThrow('no sub');
    expect(() => decodeJwtClaims('nope')).toThrow('Malformed');
  });
});

describe('FacebookStrategy.validate', () => {
  const strategy = new FacebookStrategy({ ...base, facebook: { clientId: 'i', clientSecret: 's', callbackUrl: 'http://x/cb' } });
  it('maps the profile', () => {
    expect(
      strategy.validate('a', 'r', { id: '42', displayName: 'Jane D', photos: [{ value: 'http://p' }], emails: [{ value: 'j@x.com' }] } as never),
    ).toEqual({ provider: 'facebook', providerAccountId: '42', displayName: 'Jane D', avatarUrl: 'http://p', email: 'j@x.com' });
  });
  it('tolerates a profile with no email (user declined the permission)', () => {
    expect(strategy.validate('a', 'r', { id: '42', displayName: '' } as never)).toMatchObject({ email: undefined, displayName: 'Facebook user' });
  });
});

describe('MicrosoftStrategy.validate', () => {
  const strategy = new MicrosoftStrategy({ ...base, microsoft: { clientId: 'i', clientSecret: 's', callbackUrl: 'http://x/cb' } });
  it('prefers mail, falls back to userPrincipalName', () => {
    expect(strategy.validate('a', 'r', { id: 'm1', displayName: 'Jane', emails: [{ value: 'j@x.com' }] })).toMatchObject({ provider: 'microsoft', email: 'j@x.com' });
    expect(strategy.validate('a', 'r', { id: 'm1', _json: { mail: null, userPrincipalName: 'j@corp.com' } })).toMatchObject({ email: 'j@corp.com', displayName: 'Microsoft user' });
  });
});

describe('ProviderEnabledGuard', () => {
  class Routes {
    apple() {}
    open() {}
  }
  Reflect.defineMetadata(PROVIDER_KEY, 'apple', Routes.prototype.apple);
  const ctx = (handler: () => void) => ({ getHandler: () => handler }) as unknown as ExecutionContext;

  it('404s a route whose provider is not configured', () => {
    expect(() => new ProviderEnabledGuard(new Reflector(), base).canActivate(ctx(Routes.prototype.apple))).toThrow(NotFoundException);
  });
  it('allows a configured provider and unmarked routes', () => {
    const cfg = { ...base, apple: { clientId: 'c', teamId: 't', keyId: 'k', privateKey: 'p', callbackUrl: 'u' } };
    expect(new ProviderEnabledGuard(new Reflector(), cfg).canActivate(ctx(Routes.prototype.apple))).toBe(true);
    expect(new ProviderEnabledGuard(new Reflector(), base).canActivate(ctx(Routes.prototype.open))).toBe(true);
  });
});
