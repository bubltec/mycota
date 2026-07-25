import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { MYCOTA_AUTH_CONFIG, type MycotaAuthConfig } from './auth.config.js';
import type { AuthenticatedUser } from './auth.types.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    protected readonly auth: AuthService,
    @Inject(MYCOTA_AUTH_CONFIG) protected readonly config: MycotaAuthConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      FastifyRequest & {
        user?: AuthenticatedUser;
        cookies?: Record<string, string | undefined>;
      }
    >();
    const cookieName = this.config.sessionCookieName ?? 'session';
    const token = request.cookies?.[cookieName];
    if (!token) throw new UnauthorizedException('Sign in required');

    try {
      const payload = this.auth.verifySessionToken(token);
      request.user = {
        id: payload.sub,
        provider: payload.provider,
        providerAccountId: payload.providerAccountId,
        displayName: payload.displayName,
        verifiedContributor: payload.verifiedContributor,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
}
