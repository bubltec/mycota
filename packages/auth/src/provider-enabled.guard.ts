import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MYCOTA_AUTH_CONFIG, type MycotaAuthConfig } from './auth.config.js';

export const PROVIDER_KEY = 'mycota:auth:provider';

/**
 * 404s a provider's routes when that provider isn't configured, instead of
 * letting passport throw "Unknown authentication strategy" as a 500.
 */
@Injectable()
export class ProviderEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(MYCOTA_AUTH_CONFIG) private readonly config: MycotaAuthConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const provider = this.reflector.get<keyof MycotaAuthConfig | undefined>(PROVIDER_KEY, context.getHandler());
    if (provider && !this.config[provider]) throw new NotFoundException();
    return true;
  }
}
