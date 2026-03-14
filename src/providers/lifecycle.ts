import type { Service } from '..';
import type { ActiveEntry, Connection, ProvidersAPI, ProviderSpec } from './types';
import { lookupProvider } from './registry';
import { mergeRetryConfig, withRetry } from './retry.js';

export function validateConfiguredProviders(service: Service): void {
  const providers = (service.spec() as any).providers as Record<string, ProviderSpec> | undefined;

  if (! providers) return;

  for (const [name, ps] of Object.entries(providers)) {
    const providerName = ps.provider ?? name;
    const entry        = lookupProvider(providerName);

    if (! entry) {
      const hint = ps.provider ? '' : ' — Did you forget to set the provider property?';
      throw new Error(`[Providers] Unknown provider "${providerName}" (key: "${name}")${hint}`);
    }

    entry.handler.validate(ps);
  }
}

export function initConnections(service: Service): { api: ProvidersAPI; disconnectAll: () => Promise<void> } {
  const specProviders = (service.spec() as any).providers as Record<string, ProviderSpec> | undefined ?? {};
  const active: ActiveEntry[] = [];

  const api = {
    get(provider: string) {
      return active.filter(({ name }) => name === provider)[0]?.connection;
    },

    async connect(nameOrNames: string | string[]): Promise<Connection | Connection[]> {
      const names = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];
      const connections: Connection[] = [];

      for (const name of names) {
        const ps = specProviders[name];

        if (! ps) throw new Error(`[Providers] No provider configured with name "${name}"`);

        const providerName = ps.provider ?? name;
        const entry        = lookupProvider(providerName)!;
        const retry        = mergeRetryConfig(ps.retry);
        const connection   = await withRetry<Connection>(
          () => entry.handler.connect(ps),
          retry,
          (attempt, delay, err) => {
            service.logger.warn(`[providers] connect failed — retrying in ${delay}ms`);
            service.logger.debug({ providerName, name, attempt, reason: (err as Error)?.message });
          },
        );

        active.push({ name, connection, handler: entry.handler, type: entry.type });
        connections.push(connection);

        service.emit('providerConnected', entry.type, name);
      }

      return Array.isArray(nameOrNames) ? connections : connections[0];
    },
  } as ProvidersAPI;

  const disconnectAll = async (): Promise<void> => {
    for (const { type, name, handler, connection } of [...active].reverse()) {
      await handler.disconnect(connection);
      service.emit('providerDisconnected', type, name);
    }
  };

  return { api, disconnectAll };
}
