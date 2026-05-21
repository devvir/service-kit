/**
 * The `ws` server kind — a managed WebSocket server.
 *
 * Owns the boilerplate the one hand-rolled WS server lacked: a client registry,
 * heartbeat with dead-connection sweep, JSON-frame parsing with a `ping`→`pong`
 * shortcut, op→command dispatch, and per-client error isolation. Connection and
 * message *meaning* stays with the caller via the hooks and commands.
 */

import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Service } from '../..';
import type { ServerHandle, ServerHandler, NetSpec } from '../types';
import { registerServer } from '../registry';

export type WsServerStatus = 'down' | 'starting' | 'up' | 'closing';

/** A connected client. `data` is a free-form per-client store the app owns. */
export interface WsServerClient {
  readonly id:     string;
  readonly socket: WebSocket;
  readonly data:   Record<string, unknown>;
}

export type WsCommandHandler    = (client: WsServerClient, message: Record<string, unknown>) => void;
export type WsConnectHandler    = (client: WsServerClient, req: IncomingMessage) => void;
export type WsDisconnectHandler = (client: WsServerClient) => void;
export type WsRawHandler        = (client: WsServerClient, data: RawData, isBinary: boolean) => void;

export interface WsServerSpec extends NetSpec {
  type?:      'ws';
  port?:      number;
  /** Heartbeat + dead-connection sweep + `ping`→`pong`. Default `true`. */
  pingable?:  boolean;
  /** Heartbeat interval in ms. Default 30_000. */
  heartbeat?: number;
}

export interface WsServerHandle extends ServerHandle {
  addCommand(op: string, handler: WsCommandHandler): WsServerHandle;
  addCommands(commands: Record<string, WsCommandHandler>): WsServerHandle;
  onConnect(handler: WsConnectHandler): WsServerHandle;
  onDisconnect(handler: WsDisconnectHandler): WsServerHandle;
  onMessage(handler: WsRawHandler): WsServerHandle;
  broadcast(data: string | Buffer): void;
  clients(): Iterable<WsServerClient>;
  start(): Promise<WsServerHandle>;
  stop(): Promise<WsServerHandle>;
  dispose(): Promise<void>;
  isUp(): boolean;
  isDown(): boolean;
  readonly status: WsServerStatus;
  /** The underlying `WebSocketServer` once started — escape hatch. */
  readonly server: WebSocketServer | null;
  configure(partial: Partial<WsServerSpec>): WsServerHandle;
}

const resolvePort = (spec: WsServerSpec): number =>
  spec.port ?? (Number(process.env.NET_DEFAULT_PORT) || 80);

// ── The server ────────────────────────────────────────────────────────────────

class WsServer implements WsServerHandle {
  #name:    string;
  #service: Service;
  #remove:  () => void;

  #wss:    WebSocketServer | null = null;
  #status: WsServerStatus = 'down';

  #rawSpec:  WsServerSpec;
  #pingable: boolean;
  #heartbeat: number;

  #clients  = new Map<WebSocket, WsServerClient>();
  #alive    = new WeakMap<WebSocket, boolean>();
  #commands = new Map<string, WsCommandHandler>();
  #onConnect    = new Set<WsConnectHandler>();
  #onDisconnect = new Set<WsDisconnectHandler>();
  #onMessage    = new Set<WsRawHandler>();
  #pingInterval: NodeJS.Timeout | null = null;

  constructor(spec: WsServerSpec, service: Service, remove: () => void) {
    this.#name      = spec.name ?? 'ws';
    this.#service   = service;
    this.#remove    = remove;
    this.#rawSpec   = { ...spec };
    this.#pingable  = spec.pingable ?? true;
    this.#heartbeat = spec.heartbeat ?? 30_000;
  }

  get status(): WsServerStatus {
    return this.#status;
  }

  get server(): WebSocketServer | null {
    return this.#wss;
  }

  isUp(): boolean {
    return this.#status === 'up';
  }

  isDown(): boolean {
    return this.#status === 'down';
  }

  addCommand(op: string, handler: WsCommandHandler): WsServerHandle {
    this.#commands.set(op, handler);

    return this;
  }

  addCommands(commands: Record<string, WsCommandHandler>): WsServerHandle {
    for (const [op, handler] of Object.entries(commands)) this.#commands.set(op, handler);

    return this;
  }

  onConnect(handler: WsConnectHandler): WsServerHandle {
    this.#onConnect.add(handler);

    return this;
  }

  onDisconnect(handler: WsDisconnectHandler): WsServerHandle {
    this.#onDisconnect.add(handler);

    return this;
  }

  onMessage(handler: WsRawHandler): WsServerHandle {
    this.#onMessage.add(handler);

    return this;
  }

  broadcast(data: string | Buffer): void {
    for (const { socket } of this.#clients.values()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  }

  clients(): Iterable<WsServerClient> {
    return this.#clients.values();
  }

  async start(): Promise<WsServerHandle> {
    if (this.#status === 'up' || this.#status === 'starting') return this;

    this.#status = 'starting';

    const port = resolvePort(this.#rawSpec);
    const wss  = new WebSocketServer({ port });

    wss.on('connection', (socket, req) => this.#handleConnection(socket, req));
    wss.on('error', (err) => this.#service.logger.error({ err }, `[net] ${this.#name} server error`));

    await new Promise<void>((resolve, reject) => {
      const onListenError = (err: Error): void => {
        this.#status = 'down';
        reject(err);
      };

      wss.once('error', onListenError);

      wss.once('listening', () => {
        wss.off('error', onListenError);
        resolve();
      });
    });

    this.#wss = wss;
    this.#startHeartbeat();
    this.#status = 'up';
    this.#service.logger.info(`[net] ${this.#name} listening on :${port}`);

    return this;
  }

  async stop(): Promise<WsServerHandle> {
    if (! this.#wss || this.#status === 'down') {
      this.#status = 'down';

      return this;
    }

    this.#status = 'closing';
    this.#stopHeartbeat();

    for (const { socket } of this.#clients.values()) {
      socket.close(1001, 'server shutting down');
    }

    this.#clients.clear();

    const wss = this.#wss;

    await new Promise<void>((resolve) => wss.close(() => resolve()));

    this.#wss = null;
    this.#status = 'down';

    return this;
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.#remove();
  }

  configure(partial: Partial<WsServerSpec>): WsServerHandle {
    if (this.#status !== 'down') {
      throw new Error(`[net] cannot configure server "${this.#name}" while it is ${this.#status} — stop() first`);
    }

    Object.assign(this.#rawSpec, partial);

    if (partial.pingable  !== undefined) this.#pingable  = partial.pingable;
    if (partial.heartbeat !== undefined) this.#heartbeat = partial.heartbeat;

    return this;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  #handleConnection(socket: WebSocket, req: IncomingMessage): void {
    const client: WsServerClient = { id: randomUUID(), socket, data: {} };

    this.#clients.set(socket, client);
    this.#alive.set(socket, true);

    socket.on('pong', () => this.#alive.set(socket, true));

    for (const hook of this.#onConnect) this.#safely(() => hook(client, req));

    socket.on('message', (data: RawData, isBinary: boolean) => this.#handleMessage(client, data, isBinary));
    socket.on('close',   () => this.#handleClose(client));
    socket.on('error',   (err) => this.#service.logger.warn({ err }, `[net] ${this.#name} client error`));
  }

  #handleMessage(client: WsServerClient, data: RawData, isBinary: boolean): void {
    this.#alive.set(client.socket, true);

    const text = isBinary ? null : data.toString();

    if (text === 'ping') {
      client.socket.send('pong');

      return;
    }

    for (const hook of this.#onMessage) this.#safely(() => hook(client, data, isBinary));

    if (text === null) return;

    let message: Record<string, unknown>;

    try {
      message = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;   // not JSON — the raw onMessage hooks already saw it
    }

    const op = message?.op;

    if (typeof op === 'string') {
      const command = this.#commands.get(op);

      if (command) this.#safely(() => command(client, message));
    }
  }

  #handleClose(client: WsServerClient): void {
    this.#clients.delete(client.socket);

    for (const hook of this.#onDisconnect) this.#safely(() => hook(client));
  }

  #startHeartbeat(): void {
    if (! this.#pingable) return;

    this.#pingInterval = setInterval(() => {
      for (const { socket } of this.#clients.values()) {
        if (! this.#alive.get(socket)) {
          socket.terminate();

          continue;
        }

        this.#alive.set(socket, false);
        socket.ping();
      }
    }, this.#heartbeat);

    this.#pingInterval.unref?.();
  }

  #stopHeartbeat(): void {
    if (this.#pingInterval) {
      clearInterval(this.#pingInterval);
      this.#pingInterval = null;
    }
  }

  /** Run a caller hook with per-client error isolation — one throw never spreads. */
  #safely(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.#service.logger.error({ err }, `[net] ${this.#name} handler error`);
    }
  }
}

// ── Kind registration ─────────────────────────────────────────────────────────

const handler: ServerHandler = {
  validate(spec): void {
    const s = spec as WsServerSpec;

    if (s.port !== undefined && (typeof s.port !== 'number' || s.port < 0)) {
      throw new Error(`[net] ws server "${spec.name}": "port" must be a non-negative number`);
    }

    if (s.heartbeat !== undefined && typeof s.heartbeat !== 'number') {
      throw new Error(`[net] ws server "${spec.name}": "heartbeat" must be a number`);
    }
  },

  create(spec, service, remove): WsServerHandle {
    return new WsServer(spec as WsServerSpec, service, remove);
  },
};

registerServer('ws', handler);
