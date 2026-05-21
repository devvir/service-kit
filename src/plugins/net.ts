import type { Plugin, Service } from '..';
import type { ServerSpec, ClientSpec, ServersAPI, ClientsAPI } from '../net/types';
import { buildNet } from '../net';

export { registerServer, registerClient } from '../net/registry';
export type {
  ServerSpec, ClientSpec, ServersAPI, ClientsAPI,
  ServerHandle, ClientHandle, ServerHandler, ClientHandler, NetSpec, NetHandle,
} from '../net/types';
export type { WsClientHandle, WsClientSpec, WsData, WsStatus } from '../net/clients/ws';
export type { FetchClientHandle, FetchClientSpec, FetchInit, SignFn } from '../net/clients/fetch';
export type { ExpressServerHandle, ExpressServerSpec, RouteContribution } from '../net/servers/express';
export type {
  WsServerHandle, WsServerSpec, WsServerClient,
  WsCommandHandler, WsConnectHandler, WsDisconnectHandler, WsRawHandler,
} from '../net/servers/ws';
export type { RateLimit } from '../net/servers/rate-limit';
export type { AuthSpec } from '../net/auth';

export default {
  name: 'Net',

  init(service: Service): void {
    const { servers, clients, stopAll } = buildNet(service);

    service.servers = servers;
    service.clients = clients;

    service.once('shutdown', stopAll);
  },
} as Plugin;

//--- Extend Service and Spec interfaces --------------------------------------

declare module '..' {
  interface Service {
    servers: ServersAPI;
    clients: ClientsAPI;
  }

  interface Spec {
    servers?: ServerSpec | ServerSpec[];
    clients?: ClientSpec | ClientSpec[];
  }
}
