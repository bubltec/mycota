import 'reflect-metadata';
import { CurrentUser } from '@bubltec/mycota-auth';
import { Body, Controller, type CanActivate, Delete, Get, HttpCode, Inject, Param, Post, Put, type Type, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { ContentService } from './content.service.js';
import type { EntitySpec } from './entity-spec.js';
import type { EntityRegistry } from './registry.js';

export class PublishDto {
  /** Also publish the item's draft children; default true. */
  @IsOptional()
  @IsBoolean()
  includeChildren?: boolean;

  /** Also publish what the item points at, where its spec supports that. Default false. */
  @IsOptional()
  @IsBoolean()
  includeLinked?: boolean;
}

export interface CrudControllerOptions {
  /** Who may edit. The guard puts the signed-in user on `request.user`. */
  guard: Type<CanActivate>;
  /** How an edit is recorded against the user. Default: their display name. */
  attribution?(user: any): string;
}

type Param_ = { kind: 'param'; name: string } | { kind: 'body'; type: Function } | { kind: 'user' };
type Handler = (this: { content: ContentService }, ...args: any[]) => unknown;

/**
 * Builds the editor REST controller for one entity from its spec, so a new type
 * gets its endpoints without a hand-written controller:
 *
 *   POST   <base>            create        (not for fixed-id types)
 *   PUT    <base>/:id        update
 *   DELETE <base>/:id        delete        (not for fixed-id types)
 *   POST   <base>/:id/publish               (when the spec can be published)
 *   GET    <base>            list           (fixed-id types only)
 *
 * where <base> is the spec's `route`, nested under the parent's for children
 * (topics/:parentId/references). Bodies are validated with the spec's DTO by the
 * app's global ValidationPipe, via the design:paramtypes metadata set below.
 */
export function crudController(spec: EntitySpec, registry: EntityRegistry, options: CrudControllerOptions): Type<unknown> {
  const { def } = spec;
  const by = (user: unknown) => options.attribution?.(user) ?? (user as { displayName: string }).displayName;
  const parentSpec = def.parent ? registry.spec(def.parent) : undefined;
  const base = parentSpec ? `${parentSpec.route}/:parentId/${spec.route}` : spec.route;
  const scope: Param_[] = parentSpec ? [{ kind: 'param', name: 'parentId' }] : [];
  const id: Param_ = { kind: 'param', name: 'id' };
  const body: Param_ = { kind: 'body', type: spec.dto };
  const user: Param_ = { kind: 'user' };

  class Crud {
    constructor(readonly content: ContentService) {}
  }
  Object.defineProperty(Crud, 'name', { value: `${def.name[0]!.toUpperCase()}${def.name.slice(1)}Controller` });
  Controller()(Crud);
  UseGuards(options.guard)(Crud);
  Inject(ContentService)(Crud, undefined, 0);

  const proto = Crud.prototype as unknown as Record<string, unknown>;
  const add = (key: string, verb: (path: string) => MethodDecorator, path: string, params: Param_[], run: Handler, status?: number) => {
    Object.defineProperty(proto, key, { value: run, writable: true, configurable: true });
    const descriptor = Object.getOwnPropertyDescriptor(proto, key)!;
    verb(path)(proto, key, descriptor);
    if (status) HttpCode(status)(proto, key, descriptor);
    params.forEach((p, index) => {
      const decorator = p.kind === 'param' ? Param(p.name) : p.kind === 'body' ? Body() : CurrentUser();
      decorator(proto, key, index);
    });
    Reflect.defineMetadata('design:paramtypes', params.map((p) => (p.kind === 'body' ? p.type : p.kind === 'param' ? String : Object)), proto, key);
  };

  // Handlers take (parentId?, [id,] [body,] user); `scoped` splits the optional parent id off.
  const scoped = <A extends unknown[]>(fn: (parentId: string | undefined, ...rest: A) => unknown): Handler =>
    function (this: { content: ContentService }, ...args: any[]) {
      return parentSpec ? fn.call(this, args[0], ...(args.slice(1) as A)) : fn.call(this, undefined, ...(args as A));
    };

  if (!spec.fixedIds) {
    add(
      'create',
      Post,
      base,
      [...scope, body, user],
      scoped(async function (this: { content: ContentService }, parentId: string | undefined, input: Record<string, unknown>, u: unknown) {
        return (await this.content.create(def.name, input, by(u), parentId)).result;
      }),
    );
    add(
      'remove',
      Delete,
      `${base}/:id`,
      [...scope, id, user],
      scoped(async function (this: { content: ContentService }, parentId: string | undefined, itemId: string, u: unknown) {
        return this.content.remove(def.name, { id: itemId, parentId }, by(u));
      }),
      parentSpec ? undefined : 204,
    );
  } else {
    add('list', Get, base, [], function () {
      return Promise.all(spec.fixedIds!.all().map((fixed) => this.content.get(def.name, fixed)));
    });
  }

  add(
    'update',
    Put,
    `${base}/:id`,
    [...scope, id, body, user],
    scoped(async function (this: { content: ContentService }, parentId: string | undefined, itemId: string, input: Record<string, unknown>, u: unknown) {
      return (await this.content.update(def.name, { id: itemId, parentId }, input, by(u))).result;
    }),
  );

  if (spec.publish || spec.publishItem) {
    add(
      'publish',
      Post,
      `${base}/:id/publish`,
      [...scope, id, { kind: 'body', type: PublishDto }, user],
      scoped(async function (this: { content: ContentService }, _parentId: string | undefined, itemId: string, dto: PublishDto | undefined, u: unknown) {
        return this.content.publish(def.name, itemId, by(u), { includeChildren: dto?.includeChildren, includeLinked: dto?.includeLinked });
      }),
    );
  }

  return Crud;
}
