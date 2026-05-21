/**
 * The engine behind `service.servers` / `service.clients`. Holds live instances
 * and named templates, and implements the create / clone / get lifecycle.
 *
 * `create` and `clone` are one operation over different bases: `create` builds
 * from kind defaults, `clone` from a declared template — both end at `build()`.
 */

import type { Service } from '..';
import type { NetSpec, NetHandle, NetHandler } from './types';

export interface CollectionDeps<S extends NetSpec, H extends NetHandle> {
  /** 'server' | 'client' — used only in error messages. */
  label:   string;
  /** Resolve a kind handler, or `undefined` if the kind is unknown. */
  lookup:  (kind: string) => NetHandler<S, H> | undefined;
  /** Resolve the kind for a spec whose `type` is omitted. */
  kindOf:  (spec: S) => string;
  service: Service;
}

export interface Collection<S extends NetSpec, H extends NetHandle> {
  get(name?: string): H;
  create(spec?: S | string): H;
  clone(name: string, overrides?: Partial<S>): H;
  all(): H[];
  has(name: string): boolean;
  /** Stop every live instance in reverse creation order — for shutdown. */
  stopAll(): Promise<void>;
}

export function createCollection<S extends NetSpec, H extends NetHandle>(
  deps:     CollectionDeps<S, H>,
  declared: S[],
): Collection<S, H> {
  const instances = new Map<string, H>();
  const templates = new Map<string, S>();
  const order:      string[] = [];

  const uniqueName = (base: string): string => {
    if (! instances.has(base) && ! templates.has(base)) return base;

    let n = 2;

    while (instances.has(`${base}#${n}`) || templates.has(`${base}#${n}`)) n += 1;

    return `${base}#${n}`;
  };

  /** Resolve `type`/`name`, validate, create, and register the handle. */
  const build = (raw: S, autoName: boolean): H => {
    const type = raw.type ?? deps.kindOf(raw);
    const name = raw.name ?? (autoName ? uniqueName(type) : type);

    if (instances.has(name) || templates.has(name)) {
      throw new Error(`[Net] duplicate ${deps.label} name "${name}"`);
    }

    const handler = deps.lookup(type);

    if (! handler) {
      throw new Error(`[Net] unknown ${deps.label} kind "${type}" (entry "${name}")`);
    }

    const spec = { ...raw, type, name } as S;

    handler.validate(spec);

    const remove = (): void => {
      instances.delete(name);

      const at = order.indexOf(name);

      if (at >= 0) order.splice(at, 1);
    };

    const handle = handler.create(spec, deps.service, remove);

    instances.set(name, handle);
    order.push(name);

    return handle;
  };

  // ── Boot: instantiate declared entries; register templates ───────────────────

  for (const raw of declared) {
    if (raw.template) {
      const type = raw.type ?? deps.kindOf(raw);
      const name = raw.name ?? type;

      if (instances.has(name) || templates.has(name)) {
        throw new Error(`[Net] duplicate ${deps.label} name "${name}"`);
      }

      if (! deps.lookup(type)) {
        throw new Error(`[Net] unknown ${deps.label} kind "${type}" (template "${name}")`);
      }

      templates.set(name, { ...raw, type, name } as S);
    } else {
      build(raw, false);
    }
  }

  return {
    get(name?: string): H {
      if (name === undefined) {
        if (instances.size === 1) return instances.values().next().value!;

        if (instances.size === 0) {
          throw new Error(`[Net] no ${deps.label} declared`);
        }

        throw new Error(`[Net] ${deps.label} get() is ambiguous — name one of: ${[...instances.keys()].join(', ')}`);
      }

      const handle = instances.get(name);

      if (handle) return handle;

      if (templates.has(name)) {
        throw new Error(`[Net] "${name}" is a template — use clone("${name}", …)`);
      }

      throw new Error(`[Net] no ${deps.label} named "${name}"`);
    },

    create(spec?: S | string): H {
      const raw = (typeof spec === 'string' ? { type: spec } : spec ?? {}) as S;

      return build(raw, true);
    },

    clone(name: string, overrides?: Partial<S>): H {
      const template = templates.get(name);

      if (! template) {
        const hint = instances.has(name) ? ' (it is a live instance, not a template)' : '';

        throw new Error(`[Net] no ${deps.label} template named "${name}"${hint}`);
      }

      const base = { ...template } as S;

      delete base.template;
      delete base.name;

      const merged = { ...base, ...overrides } as S;

      if (merged.name === undefined) merged.name = uniqueName(name);

      return build(merged, false);
    },

    all(): H[] {
      return order.map(n => instances.get(n)!);
    },

    has(name: string): boolean {
      return instances.has(name);
    },

    async stopAll(): Promise<void> {
      for (const name of [...order].reverse()) {
        await instances.get(name)?.stop?.();
      }
    },
  };
}
