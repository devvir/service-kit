import { MongoClient } from 'mongodb';
import type { Connection, ProviderSpec } from '../types';
import { registerProvider } from '../registry';

registerProvider('mongodb', 'database', {
  validate(spec: ProviderSpec): void {
    if (! /^mongodb(\+srv)?:\/\//.test(spec.url)) {
      throw new Error(`[mongodb] Invalid URL: expected mongodb:// or mongodb+srv://, got "${spec.url}"`);
    }
  },

  async connect(spec: ProviderSpec): Promise<Connection> {
    const client = new MongoClient(spec.url);
    await client.connect();
    return client as Connection;
  },

  async disconnect(connection: Connection): Promise<void> {
    await (connection as MongoClient).close();
  },

  async reconnect(spec: ProviderSpec, connection: Connection): Promise<Connection> {
    await (connection as MongoClient).close().catch(() => {});
    const client = new MongoClient(spec.url);
    await client.connect();
    return client as Connection;
  },
});
