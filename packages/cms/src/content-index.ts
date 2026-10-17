import type { EntityRegistry } from './registry.js';

/** Every item, grouped by collection. */
export type ContentSnapshot = Record<string, { id: string; [key: string]: any }[]>;

type Item = ContentSnapshot[string][number];

/** A read view over a snapshot, with id lookups for specs that check integrity (does this topic exist?). */
export class ContentIndex {
  private readonly ids = new Map<string, Map<string, Item>>();

  constructor(
    readonly snapshot: ContentSnapshot,
    private readonly registry: EntityRegistry,
  ) {}

  /** All items of an entity. */
  all(entity: string): Item[] {
    return this.snapshot[this.registry.def(entity).collection] ?? [];
  }

  byId(entity: string, id: string): Item | undefined {
    let map = this.ids.get(entity);
    if (!map) {
      map = new Map(this.all(entity).map((i) => [i.id, i]));
      this.ids.set(entity, map);
    }
    return map.get(id);
  }

  /** The items of a child entity that belong to one parent. */
  childrenOf(entity: string, parentId: string): Item[] {
    const field = this.registry.def(entity).parentField;
    return field ? this.all(entity).filter((i) => i[field] === parentId) : [];
  }
}
