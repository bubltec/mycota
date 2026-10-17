import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { type User, UsersService } from '@bubltec/mycota-auth';
import { MYCOTA_OAUTH_OPTIONS, type MycotaOAuthOptions } from './oauth.config.js';
import { OAuthService } from './oauth.service.js';
import type { TokenRecord } from './oauth.store.js';

export interface OAuthPrincipal {
  user: User;
  token: TokenRecord;
}

/**
 * Resolves a bearer token to the mycota-auth user it was issued to, for the
 * protected resource (an MCP endpoint, say). The user is re-read and re-checked
 * with `isAllowed` on every request, so removing someone takes effect at once.
 */
@Injectable()
export class OAuthBearerService {
  constructor(
    private readonly oauth: OAuthService,
    private readonly users: UsersService,
    @Inject(MYCOTA_OAUTH_OPTIONS) private readonly options: MycotaOAuthOptions,
  ) {}

  /** The `WWW-Authenticate` value that points a client at the discovery document. */
  challenge(): string {
    const { origin, resourcePath, scope } = this.options;
    return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${resourcePath}", scope="${scope}"`;
  }

  async authenticate(authorization: string | undefined): Promise<OAuthPrincipal | undefined> {
    const token = await this.oauth.authenticate(authorization);
    if (!token) return undefined;
    const sep = token.userKey.indexOf(':');
    if (sep < 1) return undefined;
    const user = await this.users.getByProviderAccount(token.userKey.slice(0, sep), token.userKey.slice(sep + 1));
    if (!user || !(await this.options.isAllowed(user))) return undefined;
    return { user, token };
  }
}

type GuardRequest = { headers: { authorization?: string }; oauth?: OAuthPrincipal };
type GuardReply = { header(name: string, value: string): unknown };

/** Requires a valid bearer token; puts `{ user, token }` on `request.oauth`. */
@Injectable()
export class OAuthBearerGuard implements CanActivate {
  constructor(private readonly bearer: OAuthBearerService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<GuardRequest>();
    const principal = await this.bearer.authenticate(request.headers.authorization);
    if (!principal) {
      http.getResponse<GuardReply>().header('www-authenticate', this.bearer.challenge());
      throw new UnauthorizedException({ error: 'invalid_token', error_description: 'Sign in to use this server.' });
    }
    request.oauth = principal;
    return true;
  }
}
