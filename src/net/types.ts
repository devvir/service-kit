/**
 * Types for the `Net` plugin — `servers` and `clients`.
 *
 * The concrete handle shapes (`ExpressServerHandle`, `WsClientHandle`, …) live
 * with their kinds; this file defines only what the plugin skeleton itself
 * needs: the spec shape, the handler contract, and the two public APIs.
 */

import type { Service } from '..';

/**
 * A declared or runtime spec entry. `type` selects the kind; `name` defaults to
 * `type`. `template: true` registers the entry as a named template that is not
 * instantiated. Remaining fields are kind-specific config.
 */
export interface NetSpec {
  name?:     string;
  type?:     string;
  template?: boolean;
  [key: string]: unknown;
}

export type ServerSpec = NetSpec;
export type ClientSpec = NetSpec;

/** The surface the plugin relies on; kinds extend this with their own API. */
export interface NetHandle {
  /**
   * Graceful teardown — invoked (and awaited) for every live instance on
   * service shutdown. Kinds may return `this` for chaining or a promise; the
   * plugin only awaits it.
   */
  stop?(): unknown;
}

export interface ServerHandle extends NetHandle {}
export interface ClientHandle extends NetHandle {}

/**
 * A kind handler. `validate` fails fast on a bad spec; `create` builds a handle
 * from a resolved spec (with `name` and `type` filled in). `remove` drops the
 * instance from its collection — a handle's `dispose()` calls it.
 */
export interface NetHandler<S extends NetSpec = NetSpec, H extends NetHandle = NetHandle> {
  validate(spec: S): void;
  create(spec: S, service: Service, remove: () => void): H;
}

export type ServerHandler = NetHandler<ServerSpec, ServerHandle>;
export type ClientHandler = NetHandler<ClientSpec, ClientHandle>;

export interface ServersAPI {
  get(name?: string): ServerHandle;
  create(spec?: ServerSpec | string, routes?: unknown): ServerHandle;
  clone(name: string, overrides?: Partial<ServerSpec>): ServerHandle;
  all(): ServerHandle[];
  has(name: string): boolean;
}

export interface ClientsAPI {
  get(name?: string): ClientHandle;
  create(spec?: ClientSpec | string): ClientHandle;
  clone(name: string, overrides?: Partial<ClientSpec>): ClientHandle;
  all(): ClientHandle[];
  has(name: string): boolean;
}
