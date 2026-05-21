/**
 * Wires `service.servers` / `service.clients` from the spec at plugin init.
 *
 * Reads `spec.servers` / `spec.clients` (a single object or an array), builds a
 * collection for each, and returns the two public APIs plus a `stopAll` for the
 * shutdown hook. With nothing declared this is inert — empty collections.
 */

import type { Service } from '..';
import type {
  ServersAPI, ClientsAPI, ServerSpec, ClientSpec, ServerHandle,
} from './types';
import { lookupServer, lookupClient } from './registry';
import { createCollection } from './collection';

export function buildNet(service: Service): {
  servers: ServersAPI;
  clients: ClientsAPI;
  stopAll: () => Promise<void>;
} {
  const spec = service.spec() as {
    servers?: ServerSpec | ServerSpec[];
    clients?: ClientSpec | ClientSpec[];
  };

  const serverColl = createCollection<ServerSpec, ServerHandle>({
    label:   'server',
    lookup:  lookupServer,
    kindOf:  () => 'express',
    service,
  }, toList(spec.servers));

  const clientColl = createCollection({
    label:   'client',
    lookup:  lookupClient,
    kindOf:  inferClientKind,
    service,
  }, toList(spec.clients));

  const servers: ServersAPI = {
    get:    (name)           => serverColl.get(name),
    clone:  (name, overrides) => serverColl.clone(name, overrides),
    all:    ()               => serverColl.all(),
    has:    (name)           => serverColl.has(name),
    create: (spec, routes)   => {
      const handle = serverColl.create(spec);

      if (routes !== undefined && hasAddRoutes(handle)) handle.addRoutes(routes);

      return handle;
    },
  };

  const clients: ClientsAPI = {
    get:    (name)            => clientColl.get(name),
    create: (spec)            => clientColl.create(spec),
    clone:  (name, overrides) => clientColl.clone(name, overrides),
    all:    ()                => clientColl.all(),
    has:    (name)            => clientColl.has(name),
  };

  const stopAll = async (): Promise<void> => {
    await serverColl.stopAll();
    await clientColl.stopAll();
  };

  return { servers, clients, stopAll };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toList<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];

  return Array.isArray(value) ? value : [value];
}

/** Infer a client kind from its URL scheme; an explicit `type` always wins upstream. */
function inferClientKind(spec: ClientSpec): string {
  const url = spec.url;

  if (typeof url === 'string') {
    if (/^wss?:\/\//i.test(url))   return 'ws';
    if (/^https?:\/\//i.test(url)) return 'fetch';
  }

  throw new Error('[Net] cannot infer client type — set `type` explicitly (url is a factory or has no scheme)');
}

const hasAddRoutes = (handle: ServerHandle): handle is ServerHandle & { addRoutes(routes: unknown): void } =>
  typeof (handle as { addRoutes?: unknown }).addRoutes === 'function';
