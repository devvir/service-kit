import amqp from 'amqplib';
import { Broker } from '@devvir/rabbitmq';
import type { TopologySpec } from '@devvir/rabbitmq';
import type { Connection, ProviderSpec } from '../types';
import { registerProvider } from '../registry';

type RawConnection = Awaited<ReturnType<typeof amqp.connect>>;

registerProvider('rabbitmq', 'queue', {
  validate(spec: ProviderSpec): void {
    if (! /^amqps?:\/\//.test(spec.url)) {
      throw new Error(`[rabbitmq] Invalid URL: expected amqp:// or amqps://, got "${spec.url}"`);
    }
  },

  async connect(spec: ProviderSpec): Promise<Connection> {
    if (! (spec.useBroker === true)) {
      return amqp.connect(spec.url);
    }

    const broker = new Broker(spec.url, { retries: 0, managed: true });
    broker.connect();
    await broker.ensureConnected();

    if (spec.topology !== undefined) {
      await broker.declares(spec.topology as TopologySpec);
    }

    return broker;
  },

  async disconnect(connection: Connection): Promise<void> {
    if (connection instanceof Broker) {
      await (connection as Broker).close();
    } else {
      await (connection as RawConnection).close();
    }
  },

  async reconnect(spec: ProviderSpec, connection: Connection): Promise<Connection> {
    if (connection instanceof Broker) {
      await (connection as Broker).reconnect();
      return connection;
    }

    await (connection as RawConnection).close().catch(() => {});
    return amqp.connect(spec.url);
  },
});
