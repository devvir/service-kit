import { Broker, MongoClient, RabbitMQClient, RedisClient } from ".";

export type ProviderType    = 'database' | 'queue' | 'cache';
export type RetryStrategy   = 'linear' | 'exponential';

export interface RetryConfig {
  strategy:  RetryStrategy;
  delay:     number;
  maxDelay?: number;
  attempts?: number;
}

export interface ProviderSpec {
  provider?: string;
  url:       string;
  retry?:    Partial<RetryConfig>;
  [key: string]: unknown;
}

export interface ProviderHandler {
  validate(spec: ProviderSpec): void;
  connect(spec: ProviderSpec): Promise<Connection>;
  disconnect(connection: Connection): Promise<void>;
  reconnect(spec: ProviderSpec, connection: Connection): Promise<Connection>;
  onDisconnect?(connection: Connection, notify: () => void): void;
}

export type Connection = RabbitMQClient | Broker | MongoClient | RedisClient | undefined;

export type ActiveEntry = {
  name:       string;
  connection: Connection;
  handler:    ProviderHandler;
  type:       ProviderType;
};

export type ProvidersAPI = {
  get(name: string): RabbitMQClient | Broker | MongoClient | RedisClient | undefined;
  connect(name: string):    Promise<Connection | undefined>;
  connect(names: string[]): Promise<(Connection | undefined)[]>;
};
