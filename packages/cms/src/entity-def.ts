/** Enough to address one item: children also need their parent's id. */
export interface EntityRef {
  id: string;
  parentId?: string;
}

/**
 * The persistence shape of one content type: which collection of the snapshot
 * holds it, how ids are made, and its single-table keys.
 */
export interface EntityDef {
  name: string;
  /** Which array of the snapshot holds the entity. */
  collection: string;
  /** Prefix for generated ids (see newId). */
  idPrefix: string;
  /** Entity this one hangs off; the item carries the parent's id in `parentField`. */
  parent?: string;
  parentField?: string;
  /**
   * `status`: one row with a draft/published flag. `versioned`: one row holding a
   * working copy and a published copy (site pages), which the spec manages itself.
   */
  lifecycle: 'status' | 'versioned';
  /** Storage address (single-table keys). */
  address(ref: EntityRef): { PK: string; SK: string };
  /** Whether a stored row's sort key belongs to this entity. */
  owns(sk: string): boolean;
}

export interface EntityDefOptions {
  name: string;
  /** Default: the name plus `s`. */
  collection?: string;
  /** Default: the name. */
  idPrefix?: string;
  /** Key token, default the upper-cased name: root rows are `<KEY>#<id>` / `<KEY>`, children `<PARENT KEY>#<parentId>` / `<KEY>#<id>`. */
  key?: string;
  lifecycle?: 'status' | 'versioned';
  /** A child entity: the parent definition, and the field carrying its id (default `<parent name>Id`). */
  parent?: EntityDef & { key?: string };
  parentField?: string;
}

/**
 * Builds a definition with the standard single-table keys. Pass `address` and
 * `owns` to the result's spread to keep a layout that already exists in a table.
 */
export function entityDef(o: EntityDefOptions): EntityDef & { key: string } {
  const key = o.key ?? o.name.toUpperCase();
  const parentKey = o.parent ? ((o.parent as { key?: string }).key ?? o.parent.name.toUpperCase()) : undefined;
  return {
    name: o.name,
    key,
    collection: o.collection ?? `${o.name}s`,
    idPrefix: o.idPrefix ?? o.name,
    lifecycle: o.lifecycle ?? 'status',
    ...(o.parent ? { parent: o.parent.name, parentField: o.parentField ?? `${o.parent.name}Id` } : {}),
    address: o.parent
      ? ({ id, parentId }) => ({ PK: `${parentKey}#${parentId}`, SK: `${key}#${id}` })
      : ({ id }) => ({ PK: `${key}#${id}`, SK: key }),
    owns: o.parent ? (sk) => sk.startsWith(`${key}#`) : (sk) => sk === key,
  };
}

export function refOf(def: EntityDef, item: { id: string }): EntityRef {
  const parentId = def.parentField ? (item as unknown as Record<string, string>)[def.parentField] : undefined;
  return { id: item.id, parentId };
}
