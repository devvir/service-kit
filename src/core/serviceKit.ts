import run from './runner';
import * as plugins from '../plugins';
import type { Spec, Bindings, Plugin, Config, ServiceKit, ServiceFn, PartialConfig } from '..';

let skDefaults: PartialConfig = {
  plugins: [ plugins.state, plugins.health, plugins.shutdown ],
  spec: { name: 'service', config: {} },
};

class SK implements ServiceKit {
  #spec:     Spec[]     = [];
  #bindings: Bindings[] = [];
  #plugins:  Plugin[]   = [];

  /**
   * Factory method to create a new ServiceKit instance with the given config.
   */
  create(config: PartialConfig = {}): SK {
    const sk = new SK();

    if ('spec'     in config) sk.declare(config.spec ?? {});
    if ('bindings' in config) sk.bind(config.bindings ?? {});
    if ('plugins'  in config) sk.use(config.plugins ?? []);

    return sk;
  }

  declare(spec: Spec): this {
    for (const [key, value] of Object.entries(spec)) {
      if (typeof value === 'function')
        throw new Error(`Spec field "${key}" cannot be a function — use bind() for event handlers`);
    }

    this.#spec.push(spec);

    return this;
  }

  bind(bindings: Bindings): this {
    for (const key of Object.keys(bindings)) {
      if (! /^on[A-Z]\w+$/.test(key))
        throw new Error(`Invalid binding key "${key}": bindings must follow the pattern 'onEventName'`);
    }

    this.#bindings.push(bindings);

    return this;
  }

  use(plugin: Plugin | Plugin[]): this {
    const plugins = Array.isArray(plugin) ? plugin : [ plugin ];

    this.#plugins.push(...plugins);

    return this;
  }

  // ---- Defaults (mutates this instance) --------------------------------------

  get defaults(): Config {
    return {
      spec:     { ...skDefaults.spec     },
      bindings: { ...skDefaults.bindings },
      plugins:  [ ...(skDefaults.plugins ?? []) ],
    };
  }

  set defaults(config: PartialConfig) {
    skDefaults = {
      spec:     { ...config.spec     },
      bindings: { ...config.bindings },
      plugins:  [ ...(config.plugins ?? []) ],
    };
  }

  // ---- Run -------------------------------------------------------------------

  run(serviceFn: ServiceFn): void {
    run(serviceFn, {
      defaults: { spec: {}, bindings: {}, plugins: [], ...skDefaults },
      spec:     this.#spec,
      bindings: this.#bindings,
      plugins:  this.#plugins,
    });
  }
}

export default new SK();
