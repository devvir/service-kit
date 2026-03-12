import type { ServiceFn, Spec, Bindings, Config, Plugin, Service as IService } from '..';
import type { Context } from '../types/core';
import { JsonKey } from '../types/shared';
import Service from './service';

export default async function runner(serviceFn: ServiceFn, context: Context): Promise<void> {
  const config: Config = {
    plugins:  [...new Set([ ...context.defaults.plugins, ...context.plugins ])],
    spec:     mergeSources<Spec>(context.defaults.spec, context.spec),
    bindings: mergeSources<Bindings>(context.defaults.bindings, context.bindings),
  }

  const service: IService = Object.assign(
    new Service(config),
    ...pluginExtensions(config),
  );

  initializePlugins(config.plugins, service);
  service.emit('created');

  registerListeners(service, config);
  service.emit('started');

  try {
    await serviceFn(service);
    service.emit('complete');
  } catch (err) {
    service.logger.error({ err }, '[service-kit] fatal error — shutting down');

    if ('shutdown' in service && typeof (service as any).shutdown === 'function') {
      await (service as any).shutdown('ERROR');
    }

    throw err;
  }
}

function mergeSources<T extends Spec | Bindings>(base: T, sources: T[]): T {
  let merged = { ...base };

  for (const source of sources)
    merged = { ...merged, ...source };

  return merged;
};

function pluginExtensions(config: Config): Record<JsonKey, unknown>[] {
  const extensions = [];

  for (const plugin of config.plugins) {
    if (plugin.extends)
      extensions.push(plugin.extends(config));
  }

  return extensions;
}

function initializePlugins(plugins: Plugin[], service: IService): void {
  for (const plugin of plugins) {
    plugin.init?.(service);
  }
}

function registerListeners(service: IService, config: Config) {
  for (const [key, handler] of Object.entries(config.bindings)) {
    const event = key[2].toLowerCase() + key.slice(3); // onEventName -> eventName

    service.on(event, handler);
  }
}
