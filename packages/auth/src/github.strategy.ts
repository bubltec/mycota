import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-github2';
import { MYCOTA_AUTH_CONFIG, type MycotaAuthConfig } from './auth.config.js';
import type { OAuthProfile } from './auth.types.js';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(@Inject(MYCOTA_AUTH_CONFIG) config: MycotaAuthConfig) {
    // Falls back to a placeholder so the app can still boot without GitHub
    // OAuth configured; the strategy just won't work until real credentials
    // are set. MYCOTA_AUTH_CONFIG is resolved async (see auth.module.ts),
    // so this can't conditionally register the provider itself — only
    // fall back gracefully once constructed.
    super({
      clientID: config.github?.clientId || 'not-configured',
      clientSecret: config.github?.clientSecret || 'not-configured',
      callbackURL: config.github?.callbackUrl ?? 'http://localhost:3001/api/auth/github/callback',
      scope: ['read:user', 'user:email'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile): OAuthProfile {
    const json = (profile as unknown as { _json?: { created_at?: string } })._json;
    return {
      provider: 'github',
      providerAccountId: profile.id,
      displayName: profile.displayName || profile.username || profile.id,
      avatarUrl: profile.photos?.[0]?.value,
      email: profile.emails?.[0]?.value,
      // GitHub's /user response includes the account's public created_at date,
      // which is what the contributor age check is built on.
      providerAccountCreatedAt: json?.created_at,
    };
  }
}
