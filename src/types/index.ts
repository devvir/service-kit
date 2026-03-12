import type { JsonKey, JsonValue } from './shared.js';

export interface ServiceKit {
  create(config?: Config): ServiceKit;
  use(plugin: Plugin | Plugin[]): this;
  declare(spec: Spec): this;
  bind(bindings: Bindings): this;
  run(serviceFn: ServiceFn): void;
  get defaults(): Config;
  set defaults(config: Config);
}

export interface Service {}

export interface PartialConfig {
  plugins?:  Plugin[];
  spec?:     Spec;
  bindings?: Bindings;
}

export type Config = Required<PartialConfig>;

export interface Plugin {
  name:     string;
  init?:    (config: Config) => void | Promise<void>;
  extends?: (config: Config) => Record<JsonKey, unknown>;
}

export interface Spec {
  name?:   string;
  config?: Record<JsonKey, JsonValue>;
  [key: JsonKey]: JsonValue;
}

export type Bindings = Record<`on${string}`, (service: Service, ...rest: any) => void>;

export type ServiceFn = (service: Service) => void | Promise<void>;
