import { hardenOAuth2 } from './oauth-http.js';
import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-microsoft';
import type { MycotaAuthConfig } from './auth.config.js';
import { MYCOTA_AUTH_CONFIG } from './auth.config.js';
import type { OAuthProfile } from './auth.types.js';

/** passport-microsoft ships no profile type; this is the Graph `/me` shape it maps. */
interface MicrosoftProfile {
  id: string;
  displayName?: string;
  emails?: Array<{ value: string }>;
  _json?: { mail?: string | null; userPrincipalName?: string };
}

/** Only constructed when `config.microsoft` is set. */
@Injectable()
export class MicrosoftStrategy extends PassportStrategy(Strategy, 'microsoft') {
  constructor(@Inject(MYCOTA_AUTH_CONFIG) config: MycotaAuthConfig) {
    const microsoft = config.microsoft;
    if (!microsoft) throw new Error('Microsoft sign-in is not configured');
    super({
      clientID: microsoft.clientId,
      clientSecret: microsoft.clientSecret,
      callbackURL: microsoft.callbackUrl,
      tenant: microsoft.tenant ?? 'common',
      scope: ['user.read'],
    });
    hardenOAuth2(this, config.network?.oauth);
  }

  validate(_accessToken: string, _refreshToken: string, profile: MicrosoftProfile): OAuthProfile {
    const mail = profile.emails?.[0]?.value ?? profile._json?.mail ?? undefined;
    const upn = profile._json?.userPrincipalName;
    return {
      provider: 'microsoft',
      providerAccountId: profile.id,
      displayName: profile.displayName || 'Microsoft user',
      email: mail ?? upn,
    };
  }
}
