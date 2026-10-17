import { hardenOAuth2 } from './oauth-http.js';
import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-apple';
import type { MycotaAuthConfig } from './auth.config.js';
import { MYCOTA_AUTH_CONFIG } from './auth.config.js';
import type { OAuthProfile } from './auth.types.js';

/** Reads the claims of an id_token without verifying its signature; see `AppleStrategy.validate`. */
export function decodeJwtClaims(idToken: string): Record<string, unknown> {
  const payload = idToken.split('.')[1];
  if (!payload) throw new Error('Malformed id_token');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/**
 * Sign in with Apple. Only constructed when `config.apple` is set (see
 * `AuthModule`). Apple returns the user's name only on the very first
 * authorization and not in the id_token, so `displayName` falls back to the
 * email local part, or "Apple user" for private-relay addresses.
 */
@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple') {
  constructor(@Inject(MYCOTA_AUTH_CONFIG) config: MycotaAuthConfig) {
    const apple = config.apple;
    if (!apple) throw new Error('Apple sign-in is not configured');
    super({
      clientID: apple.clientId,
      teamID: apple.teamId,
      keyID: apple.keyId,
      privateKeyString: apple.privateKey,
      callbackURL: apple.callbackUrl,
      scope: ['name', 'email'],
      passReqToCallback: false,
    });
    hardenOAuth2(this, config.network?.oauth);
  }

  // The id_token is read straight from the token-endpoint response (back
  // channel, TLS, authenticated with our signed client secret), which OIDC
  // Core §3.1.3.7 allows without a separate signature check.
  validate(_accessToken: string, _refreshToken: string, idToken: string): OAuthProfile {
    const claims = decodeJwtClaims(idToken);
    const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
    if (!sub) throw new Error('Apple id_token has no sub');
    const email = typeof claims.email === 'string' ? claims.email : undefined;
    const relay = email?.endsWith('@privaterelay.appleid.com');
    return {
      provider: 'apple',
      providerAccountId: sub,
      displayName: (!relay && email?.split('@')[0]) || 'Apple user',
      email,
    };
  }
}
