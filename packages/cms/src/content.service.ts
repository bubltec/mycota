import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContentIndex } from './content-index.js';
import { type EntityRef, refOf } from './entity-def.js';
import type { EntityCtx, EntitySpec } from './entity-spec.js';
import { newId } from './ids.js';
import type { EntityRegistry } from './registry.js';
import { type Status, statusOf } from './status.js';
import type { ContentStore, RemoveTarget } from './store.js';

type Item = { id: string; status?: Status; [key: string]: any };

export interface PublishOptions {
  /** Draft children and whatever the spec cascades to. Default true. */
  includeChildren?: boolean;
  /** Also publish what the item points at (the spec decides what). Default false. */
  includeLinked?: boolean;
}

/** A write's outcome: the stored item, and what callers should show for it (see `present`). */
export interface Written {
  item: Item;
  result: unknown;
}

export interface ContentServiceOptions {
  /** Read-cache lifetime in ms. Other warm instances see an edit within this window. Default 15000. */
  cacheTtlMs?: number;
}

/**
 * All reads go through one cached ContentIndex; every write invalidates it.
 *
 * Writes are generic: `create`, `update`, `remove`, `removeDraft`, `setStatus`
 * and `publish` work on any registered entity, using its spec for validation and
 * integrity, so every client (the web CMS, the MCP connector) gets them.
 *
 * Publishing: new roots start as drafts. A new child takes its parent's status
 * unless one is given (the CMS adds to a live parent live; a connector passes
 * `draft`). Updates keep the current status unless one is given.
 *
 * Framework-free apart from the HTTP exceptions it throws.
 */
export class ContentService {
  private cache?: { index: ContentIndex; at: number };

  constructor(
    private readonly store: ContentStore,
    readonly registry: EntityRegistry,
    private readonly options: ContentServiceOptions = {},
  ) {}

  async index(fresh = false): Promise<ContentIndex> {
    if (!fresh && this.cache && Date.now() - this.cache.at < (this.options.cacheTtlMs ?? 15_000)) return this.cache.index;
    const index = new ContentIndex(await this.store.loadAll(), this.registry);
    this.cache = { index, at: Date.now() };
    return index;
  }

  private invalidate() {
    this.cache = undefined;
  }

  /** Reads one item as `present` shows it, drafts included. */
  async get(name: string, id: string, by = ''): Promise<unknown> {
    const spec = this.registry.spec(name);
    const index = await this.index(true);
    const item = this.locate(spec, index, { id });
    return spec.present ? spec.present(item, this.ctx(index, by, { existing: item })) : item;
  }

  /** The stored item itself (not its presentation), or 404. */
  async find(name: string, id: string): Promise<Item> {
    return this.locate(this.registry.spec(name), await this.index(true), { id });
  }

  /** `parentId` is required for children. */
  async create(name: string, input: Record<string, any>, by: string, parentId?: string): Promise<Written> {
    const spec = this.registry.spec(name);
    if (spec.fixedIds) throw new BadRequestException(`A ${name} can't be created; update it instead`);
    const index = await this.index(true);
    const ctx = this.ctx(index, by, { parent: this.parentOf(spec, index, parentId) });
    const id = spec.makeId?.(input, ctx) ?? newId(spec.def.idPrefix);
    return this.save(spec, this.compose(spec, id, input, ctx), by);
  }

  async update(name: string, ref: EntityRef, input: Record<string, any>, by: string): Promise<Written> {
    const spec = this.registry.spec(name);
    const index = await this.index(true);
    const existing = this.locate(spec, index, ref);
    const parent = spec.def.parentField ? this.parentOf(spec, index, existing[spec.def.parentField]) : undefined;
    const ctx = this.ctx(index, by, { existing, parent });
    return this.save(spec, this.compose(spec, existing.id, input, ctx), by);
  }

  /**
   * Deletes an item and everything that hangs off it. Returns the parent's
   * refreshed presentation, if it has one.
   */
  async remove(name: string, ref: EntityRef, by: string): Promise<unknown> {
    const spec = this.registry.spec(name);
    if (spec.fixedIds) throw new BadRequestException(`A ${name} can't be deleted`);
    const index = await this.index(true);
    const existing = this.locate(spec, index, ref);
    const ctx = this.ctx(index, by, { existing, parent: spec.def.parent ? this.parentOf(spec, index, existing[spec.def.parentField!]) : undefined });

    const removals: RemoveTarget[] = [];
    const cascade = (entity: string, item: Item) => {
      const def = this.registry.def(entity);
      removals.push({ entity, ref: refOf(def, item) });
      for (const child of this.registry.childrenOf(entity)) {
        for (const c of index.childrenOf(child.name, item.id)) cascade(child.name, c);
      }
    };
    cascade(name, existing);

    const puts: { entity: string; item: { id: string } }[] = [];
    for (const effect of spec.onDelete?.(existing, ctx) ?? []) {
      if ('remove' in effect) removals.push(effect.remove);
      else puts.push(effect.put);
    }
    await this.store.remove(removals);
    for (const { entity, item } of puts) await this.store.put(entity, item);
    this.invalidate();

    if (!spec.def.parent) return undefined;
    const fresh = await this.index(true);
    const parentSpec = this.registry.spec(spec.def.parent);
    const parent = this.locate(parentSpec, fresh, { id: existing[spec.def.parentField!] });
    return parentSpec.present ? parentSpec.present(parent, this.ctx(fresh, by, { existing: parent })) : parent;
  }

  /** Deletes an item only while it is a draft; published items can only be removed by an editor. */
  async removeDraft(name: string, id: string, by: string): Promise<{ deleted: string; type: string }> {
    const spec = this.registry.spec(name);
    if (spec.def.lifecycle !== 'status') throw new BadRequestException(`A ${name} has no drafts to delete`);
    const existing = this.locate(spec, await this.index(true), { id });
    if (statusOf(existing) !== 'draft') {
      throw new BadRequestException(`${name} "${id}" is published; only drafts can be deleted here`);
    }
    await this.remove(name, refOf(spec.def, existing), by);
    return { deleted: id, type: name };
  }

  /** Sets the status of any mix of items. Unknown ids fail the whole call before anything is written. */
  async setStatus(status: Status, items: { type: string; id: string }[], by: string): Promise<{ updated: number }> {
    const index = await this.index(true);
    const targets = items.map((item) => {
      if (!this.registry.has(item.type)) throw new BadRequestException(`Unknown type "${item.type}"`);
      const found = index.byId(item.type, item.id);
      if (!found) throw new NotFoundException(`No ${item.type} "${item.id}"`);
      return { type: item.type, found: found as Item };
    });
    const now = new Date().toISOString();
    let updated = 0;
    for (const { type, found } of targets) {
      if (statusOf(found) === status) continue;
      const next: Item = { ...found, ...stamp(status, found), updatedAt: now, updatedBy: by };
      await this.store.put(type, next);
      updated++;
    }
    this.invalidate();
    return { updated };
  }

  /**
   * Makes an item public: a status entity goes live together with whatever its
   * spec's `publish.cascade` names; a versioned one publishes its working copy.
   */
  async publish(name: string, id: string, by: string, options: PublishOptions = {}): Promise<unknown> {
    const spec = this.registry.spec(name);
    const index = await this.index(true);
    const existing = this.locate(spec, index, { id });
    const ctx = this.ctx(index, by, { existing });
    if (spec.def.lifecycle === 'versioned') {
      if (!spec.publishItem) throw new BadRequestException(`A ${name} can't be published`);
      return (await this.save(spec, spec.publishItem(existing, ctx), by)).result;
    }
    if (!spec.publish) throw new BadRequestException(`A ${name} can't be published directly; use set_status`);
    // Publishing what an item points at only makes sense together with its own drafts.
    const includeLinked = options.includeLinked === true;
    const includeChildren = includeLinked || options.includeChildren !== false;
    const items = [{ type: name, id }, ...(spec.publish.cascade?.(existing, ctx, { includeChildren, includeLinked }) ?? [])];
    await this.setStatus('published', items, by);
    return this.get(name, id, by);
  }

  // Internals ---------------------------------------------------------------

  private ctx(index: ContentIndex, by: string, extra: Partial<EntityCtx> = {}): EntityCtx {
    return { index, by, now: new Date().toISOString(), ...extra };
  }

  /** The stored item, or 404. Fixed-id entities that were never saved read as an empty stub. */
  private locate(spec: EntitySpec, index: ContentIndex, ref: EntityRef): Item {
    const { def } = spec;
    if (def.parent && ref.parentId) this.parentOf(spec, index, ref.parentId);
    const found = index.byId(def.name, ref.id) as Item | undefined;
    if (found) {
      if (def.parentField && ref.parentId && found[def.parentField] !== ref.parentId) {
        throw new NotFoundException(`No ${def.name} "${ref.id}"`);
      }
      return found;
    }
    if (spec.fixedIds?.has(ref.id)) return { id: ref.id };
    throw new NotFoundException(`No ${def.name} "${ref.id}"`);
  }

  private parentOf(spec: EntitySpec, index: ContentIndex, parentId: string | undefined): Item | undefined {
    const { parent } = spec.def;
    if (!parent) return undefined;
    if (!parentId) throw new BadRequestException(`A ${spec.def.name} needs its ${parent}`);
    return this.locate(this.registry.spec(parent), index, { id: parentId });
  }

  /** Builds the item to store: the spec's fields plus id, parent link, timestamps and status. */
  private compose(spec: EntitySpec, id: string, input: Record<string, any>, ctx: EntityCtx): Item {
    const { def } = spec;
    if (def.lifecycle === 'versioned') return spec.build!(input, ctx);
    const { existing, parent, now, by } = ctx;
    // Fields first: they validate, and defaultStatus may rely on that.
    const fields = spec.fields!(input, ctx);
    const status: Status =
      input.status ?? (existing ? statusOf(existing) : (spec.defaultStatus?.(input, ctx) ?? (parent ? statusOf(parent) : 'draft')));
    return {
      ...existing,
      ...fields,
      id,
      ...(def.parentField ? { [def.parentField]: parent!.id } : {}),
      ...stamp(status, existing),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: by,
    };
  }

  private async save(spec: EntitySpec, item: Item, by: string): Promise<Written> {
    await this.store.put(spec.def.name, item);
    this.invalidate();
    const index = await this.index(true);
    return { item, result: spec.present ? spec.present(item, this.ctx(index, by, { existing: item })) : item };
  }
}

/** Status fields for a write; `publishedAt` moves only when something becomes published. */
function stamp(status: Status, previous: { status?: Status; publishedAt?: string } | undefined) {
  const wasPublished = previous ? statusOf(previous) === 'published' : false;
  return {
    status,
    publishedAt: status === 'published' ? (wasPublished ? previous?.publishedAt : new Date().toISOString()) : previous?.publishedAt,
  };
}
