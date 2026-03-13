import { EventEmitter } from 'node:events';
import type { Bindings, Config, ServiceConfig, Spec } from '..';
import { JsonKey } from '../types/shared';
import { logger } from '..';

export default class extends EventEmitter {
  logger = logger;

  #plugins: string[];
  #spec: Spec;
  #bindings: Bindings;
  #config: ServiceConfig;

  constructor(config: Config) {
    super();

    this.#spec     = config.spec ?? {};
    this.#bindings = config.bindings ?? {};
    this.#plugins  = (config.plugins || []).map(p => p.name);
    this.#config   = JSON.parse(JSON.stringify(this.#spec.config || {}));
  }

  // ---- Getters ---------------------------------------------------------------

  spec(): Spec {
    return { ...this.#spec };
  }

  bindings(): Bindings {
    return { ...this.#bindings };
  }

  plugins(): string[] {
    return [ ...this.#plugins ];
  }

  config(key?: JsonKey): ServiceConfig | undefined | unknown {
    return key
      ? (this.#config[key] ?? undefined)
      : { ...this.#config };
  }

  // ---- Events ----------------------------------------------------------------

  hasListeners(event: string) {
    return this.listenerCount(event) > 0;
  }

  /** Pass this service instance as first argument to registered listeners */
  emit(e: string, ...args: unknown[]) {
    if (e !== 'healthCheck') {
      this.logger.debug({ event: e, ...(args.length ? { args } : {}) }, `[service-kit] → ${e}`);
    }

    return super.emit(e, this, ...args);
  }
}
