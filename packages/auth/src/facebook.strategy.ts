import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-facebook';
import type { MycotaAuthConfig } from './auth.config.js';
import { MYCOTA_AUTH_CONFIG } from './auth.config.js';
import type { OAuthProfile } from './auth.types.js';

/** Only constructed when `config.facebook` is set. */
@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(@Inject(MYCOTA_AUTH_CONFIG) config: MycotaAuthConfig) {
    const facebook = config.facebook;
    if (!facebook) throw new Error('Facebook sign-in is not configured');
    super({
      clientID: facebook.clientId,
      clientSecret: facebook.clientSecret,
      callbackURL: facebook.callbackUrl,
      profileFields: ['id', 'displayName', 'photos', 'emails'],
      scope: ['public_profile', 'email'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile): OAuthProfile {
    return {
      provider: 'facebook',
      providerAccountId: profile.id,
      displayName: profile.displayName || 'Facebook user',
      avatarUrl: profile.photos?.[0]?.value,
      email: profile.emails?.[0]?.value,
    };
  }
}
