import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DYNAMO_DOC_CLIENT } from '@bubltec/mycota-dynamo';
import { type CanActivate, type DynamicModule, type InjectionToken, Module, type OptionalFactoryDependency, type Type } from '@nestjs/common';
import { ContentService } from './content.service.js';
import { crudController } from './crud.controller.js';
import type { EntitySpec } from './entity-spec.js';
import { EntityRegistry } from './registry.js';
import { type ContentStore, DynamoContentStore } from './store.js';

export const CMS_OPTIONS = Symbol('MYCOTA_CMS_OPTIONS');

/** What is only known once config has loaded. */
export interface MycotaCmsOptions {
  /** Persistence. Give this, or `tableName` to use DynamoDB through the shared `DYNAMO_DOC_CLIENT`. */
  store?: (registry: EntityRegistry) => ContentStore;
  tableName?: string;
  /** Read-cache lifetime in ms. Default 15000. */
  cacheTtlMs?: number;
}

export interface MycotaCmsModuleAsyncOptions {
  /** The content types. Fixed at definition time, since each gets REST controllers. */
  entities: EntitySpec[];
  /** Who may edit; the guard puts the user on `request.user`. */
  guard: Type<CanActivate>;
  /** How an edit is recorded against the user. Default: their display name. */
  attribution?(user: any): string;
  imports?: DynamicModule['imports'];
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (...args: any[]) => MycotaCmsOptions | Promise<MycotaCmsOptions>;
}

/**
 * Editor REST endpoints for every entity, plus the `ContentService` the app's
 * public routes and MCP tools read through. Needs `MycotaAuthModule` for the
 * editor guard and, unless a `store` is given, `DynamoModule`.
 */
@Module({})
export class MycotaCmsModule {
  static forRootAsync(options: MycotaCmsModuleAsyncOptions): DynamicModule {
    const registry = new EntityRegistry(options.entities);
    return {
      module: MycotaCmsModule,
      imports: options.imports ?? [],
      controllers: registry.specs.map((spec) => crudController(spec, registry, { guard: options.guard, attribution: options.attribution })),
      providers: [
        { provide: CMS_OPTIONS, inject: options.inject ?? [], useFactory: options.useFactory },
        { provide: EntityRegistry, useValue: registry },
        {
          provide: ContentService,
          inject: [CMS_OPTIONS, { token: DYNAMO_DOC_CLIENT, optional: true }],
          useFactory: (o: MycotaCmsOptions, db?: DynamoDBDocumentClient) => {
            if (!o.store && (!o.tableName || !db)) throw new Error('MycotaCmsModule needs a `store`, or a `tableName` and DynamoModule');
            const store = o.store ? o.store(registry) : new DynamoContentStore(db!, o.tableName!, registry);
            return new ContentService(store, registry, { cacheTtlMs: o.cacheTtlMs });
          },
        },
      ],
      exports: [ContentService, EntityRegistry],
    };
  }
}
