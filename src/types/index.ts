import { EventEmitter } from 'node:stream';
import type { JsonKey, JsonValue } from './shared.js';
import pino from 'pino';

export interface ServiceKit {
  create(config?: Config): ServiceKit;
  use(plugin: Plugin | Plugin[]): this;
  declare(spec: Spec): this;
  bind(bindings: Bindings): this;
  run(serviceFn: ServiceFn): void;
  get defaults(): Config;
  set defaults(config: Config);
}

export interface Service extends EventEmitter {
  config(key?: JsonKey): ServiceConfig | undefined | unknown;

  spec(): Spec;
  bindings(): Bindings;
  plugins(): string[];

  logger: pino.Logger;

  emit(e: string, ...args: unknown[]): boolean;
  hasListeners(event: string): boolean;
}

export interface PartialConfig {
  plugins?:  Plugin[];
  spec?:     Spec;
  bindings?: Bindings;
}

export type Config = Required<PartialConfig>;

export interface Plugin {
  name:     string;
  init?:    (service: Service) => void | Promise<void>;
  extends?: (config: Config) => Record<JsonKey, unknown>;
}

export interface Spec {
  name?:   string;
  config?: Record<JsonKey, JsonValue>;
  [key: JsonKey]: JsonValue;
}

export type ServiceListener = (service: Service, ...rest: any[]) => void | Promise<void>;

export interface Bindings {
  [key: `on${string}`]: ServiceListener | undefined;
}

export type ServiceFn = (service: Service) => void | Promise<void>;

export type ServiceConfig = Record<JsonKey, unknown>;
