import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-google-oauth20';
import { MYCOTA_AUTH_CONFIG, type MycotaAuthConfig } from './auth.config.js';
import type { OAuthProfile } from './auth.types.js';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(@Inject(MYCOTA_AUTH_CONFIG) config: MycotaAuthConfig) {
    // Falls back to a placeholder so the app can still boot without Google
    // OAuth configured; the strategy just won't work until real credentials
    // are set. MYCOTA_AUTH_CONFIG is resolved async (see auth.module.ts),
    // so this can't conditionally register the provider itself — only
    // fall back gracefully once constructed.
    super({
      clientID: config.google?.clientId || 'not-configured',
      clientSecret: config.google?.clientSecret || 'not-configured',
      callbackURL: config.google?.callbackUrl ?? 'http://localhost:3001/api/auth/google/callback',
      scope: ['profile', 'email'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile): OAuthProfile {
    return {
      provider: 'google',
      providerAccountId: profile.id,
      displayName: profile.displayName,
      avatarUrl: profile.photos?.[0]?.value,
      email: profile.emails?.[0]?.value,
      // Google doesn't expose an account-creation date, so Google sign-in is
      // browsing-only and can never pass the contributor age check.
    };
  }
}
