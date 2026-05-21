import SK from './core/serviceKit.js';

export default SK;

export { default as logger } from './utils/logger';

export * from './types/index.js';
export * as plugins from './plugins';
export * from './providers';

export * from './net/types';
export type { WsClientHandle, WsClientSpec, WsData, WsStatus } from './net/clients/ws';
export type { FetchClientHandle, FetchClientSpec, FetchInit, SignFn } from './net/clients/fetch';
export type { ExpressServerHandle, ExpressServerSpec, RouteContribution } from './net/servers/express';
export type {
  WsServerHandle, WsServerSpec, WsServerClient,
  WsCommandHandler, WsConnectHandler, WsDisconnectHandler, WsRawHandler,
} from './net/servers/ws';
export type { RateLimit } from './net/servers/rate-limit';
export type { AuthSpec } from './net/auth';
export { registerServer, registerClient } from './net/registry';

export * as RabbitMQ from '@devvir/rabbitmq';

export * as registry from './core/registry';
export { SK_CONFIG, SK_STATE, SK_PROVIDERS } from './core/registry';
