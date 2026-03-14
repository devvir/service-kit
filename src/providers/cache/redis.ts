import { createClient } from 'redis';
import type { Connection, ProviderSpec } from '../types';
import { registerProvider } from '../registry';

type RedisClient = ReturnType<typeof createClient>;

registerProvider('redis', 'cache', {
  validate(spec: ProviderSpec): void {
    if (! /^rediss?:\/\//.test(spec.url)) {
      throw new Error(`[redis] Invalid URL: expected redis:// or rediss://, got "${spec.url}"`);
    }
  },

  async connect(spec: ProviderSpec): Promise<Connection> {
    const client = createClient({ url: spec.url });
    await client.connect();

    return client as Connection;
  },

  async disconnect(connection: Connection): Promise<void> {
    await (connection as RedisClient).disconnect();
  },

  async reconnect(spec: ProviderSpec, connection: Connection): Promise<Connection> {
    await (connection as RedisClient).disconnect().catch(() => {});

    const client = createClient({ url: spec.url });
    await client.connect();

    return client as Connection;
  },
});
