import type { EntityDef } from './entity-def.js';
import type { EntitySpec } from './entity-spec.js';

/** The content types an app has registered, by name. */
export class EntityRegistry {
  private readonly byName = new Map<string, EntitySpec>();

  constructor(readonly specs: readonly EntitySpec[]) {
    for (const spec of specs) {
      if (this.byName.has(spec.def.name)) throw new Error(`Entity "${spec.def.name}" is registered twice`);
      this.byName.set(spec.def.name, spec);
    }
    for (const { def } of specs) {
      if (def.parent && !this.byName.has(def.parent)) throw new Error(`Entity "${def.name}" has an unregistered parent "${def.parent}"`);
    }
  }

  get defs(): EntityDef[] {
    return this.specs.map((s) => s.def);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** The spec for `name`; throws for an unregistered type. */
  spec(name: string): EntitySpec {
    const spec = this.byName.get(name);
    if (!spec) throw new Error(`Unknown entity "${name}"`);
    return spec;
  }

  def(name: string): EntityDef {
    return this.spec(name).def;
  }

  /** The entities whose parent is `name`. */
  childrenOf(name: string): EntityDef[] {
    return this.defs.filter((d) => d.parent === name);
  }
}
