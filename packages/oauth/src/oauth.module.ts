import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DYNAMO_DOC_CLIENT } from '@bubltec/mycota-dynamo';
import { type DynamicModule, type InjectionToken, Module, type OptionalFactoryDependency } from '@nestjs/common';
import { MYCOTA_OAUTH_OPTIONS, type MycotaOAuthOptions, OAUTH_STORE } from './oauth.config.js';
import { OAuthBearerGuard, OAuthBearerService } from './oauth-bearer.js';
import { OAuthController } from './oauth.controller.js';
import { OAuthService } from './oauth.service.js';
import { DynamoOAuthStore, type OAuthStore } from './oauth.store.js';

export interface MycotaOAuthModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (...args: any[]) => MycotaOAuthOptions | Promise<MycotaOAuthOptions>;
}

/**
 * Needs `MycotaAuthModule` (the signed-in session is the identity) and, unless
 * the options bring their own `store`, `DynamoModule`.
 */
@Module({})
export class MycotaOAuthModule {
  static forRootAsync(options: MycotaOAuthModuleAsyncOptions): DynamicModule {
    return {
      module: MycotaOAuthModule,
      imports: options.imports ?? [],
      controllers: [OAuthController],
      providers: [
        { provide: MYCOTA_OAUTH_OPTIONS, inject: options.inject ?? [], useFactory: options.useFactory },
        {
          provide: OAUTH_STORE,
          inject: [MYCOTA_OAUTH_OPTIONS, { token: DYNAMO_DOC_CLIENT, optional: true }],
          useFactory: (o: MycotaOAuthOptions, db?: DynamoDBDocumentClient): OAuthStore => {
            if (o.store) return o.store;
            if (!o.tableName || !db) throw new Error('MycotaOAuthModule needs a `store`, or a `tableName` and DynamoModule');
            return new DynamoOAuthStore(db, o.tableName);
          },
        },
        OAuthService,
        OAuthBearerService,
        OAuthBearerGuard,
      ],
      exports: [OAuthService, OAuthBearerService, OAuthBearerGuard, MYCOTA_OAUTH_OPTIONS],
    };
  }
}
