/**
 * The `ws` client kind — a managed WebSocket connection.
 *
 * Owns connection lifecycle so the caller does not have to: single-flight
 * reconnection with capped exponential backoff, heartbeat with dead-connection
 * detection, clean transition logging, and `sendOnOpen` messages that survive
 * reconnects. The `url` may be a factory, re-invoked on every (re)connect to
 * carry freshly-signed credentials.
 *
 * Protocol semantics stay with the caller — the kit never inspects frames.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import type { Service } from '../..';
import type { ClientHandle, ClientHandler, NetSpec } from '../types';
import { registerClient } from '../registry';
import { Backoff, mergeRetryConfig, type RetryConfig } from '../../support/retry';
import { Reachability, describeError } from '../../support/reachability';
import { authHeaders, type AuthSpec } from '../auth';

export type WsData   = string | Buffer | ArrayBuffer | ArrayBufferView;
export type WsStatus = 'down' | 'connecting' | 'open' | 'reconnecting';

export interface WsClientSpec extends NetSpec {
  type?:      'ws';
  /** Connection URL — a string, or a factory re-invoked on every (re)connect. */
  url:        string | (() => string | Promise<string>);
  /** Heartbeat interval in ms; `0` disables it. Defaults to 30_000. */
  heartbeat?: number;
  /** Reconnection backoff; defaults to capped exponential (500ms → 30s). */
  backoff?:   Partial<RetryConfig>;
  /** Static headers sent on the upgrade request. */
  headers?:   Record<string, string>;
  /** Well-known auth scheme — sent as headers on the upgrade request. */
  auth?:      AuthSpec;
}

export interface WsClientHandle extends ClientHandle {
  start(): Promise<WsClientHandle>;
  stop(): WsClientHandle;
  dispose(): void;
  send(data: WsData): void;
  /** Register one or many messages (re)sent on every open. `stop()` removes them. */
  sendOnOpen(message: WsData | WsData[]): { stop(): void };
  onMessage(handler: (data: Buffer) => void): WsClientHandle;
  on(event: string, handler: (...args: unknown[]) => void): WsClientHandle;
  off(event: string, handler: (...args: unknown[]) => void): WsClientHandle;
  isUp(): boolean;
  isDown(): boolean;
  readonly status: WsStatus;
  /** The raw underlying socket (the current one; replaced on reconnect) — escape hatch. */
  readonly socket: WebSocket | null;
  configure(partial: Partial<WsClientSpec>): WsClientHandle;
}

interface ResolvedConfig {
  url:       string | (() => string | Promise<string>);
  heartbeat: number;
  backoff:   RetryConfig;
  headers:   Record<string, string>;
  auth?:     AuthSpec;
}

const isRateLimited = (err: unknown): boolean =>
  /Unexpected server response: 429/.test((err as { message?: string })?.message ?? '');

// ── The client ────────────────────────────────────────────────────────────────

class WsClient implements WsClientHandle {
  #name:    string;
  #service: Service;
  #remove:  () => void;
  #emitter = new EventEmitter();
  #reach:   Reachability;

  #rawSpec: WsClientSpec;
  #config!: ResolvedConfig;
  #backoff!: Backoff;

  #ws:       WebSocket | null = null;
  #status:   WsStatus = 'down';
  #stopped   = true;
  #everOpened = false;

  #reconnectTimer: NodeJS.Timeout | null = null;
  #pingInterval:   NodeJS.Timeout | null = null;
  #awaitingPong = false;

  #lastError: unknown;
  #sticky = new Set<{ messages: WsData[] }>();

  constructor(spec: WsClientSpec, service: Service, remove: () => void) {
    this.#name    = spec.name ?? 'ws';
    this.#service = service;
    this.#remove  = remove;
    this.#rawSpec = { ...spec };
    this.#reach   = new Reachability(service.logger, this.#name);

    this.#emitter.setMaxListeners(0);
    this.#emitter.on('error', () => {});   // default — keeps emit('error') from throwing when unobserved
    this.#resolveConfig();
  }

  get status(): WsStatus {
    return this.#status;
  }

  get socket(): WebSocket | null {
    return this.#ws;
  }

  isUp(): boolean {
    return this.#status === 'open';
  }

  isDown(): boolean {
    return this.#status === 'down';
  }

  start(): Promise<WsClientHandle> {
    if (this.#status !== 'down') return Promise.resolve(this);

    this.#stopped = false;

    const ready = new Promise<WsClientHandle>((resolve) => {
      const done = (): void => resolve(this);

      this.#emitter.once('open', done);
      this.#emitter.once('stopped', done);
    });

    void this.#connect();

    return ready;
  }

  stop(): WsClientHandle {
    this.#stopped = true;

    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }

    this.#stopHeartbeat();

    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }

    this.#status = 'down';

    this.#reach.dispose();
    this.#emitter.emit('stopped');

    return this;
  }

  dispose(): void {
    this.stop();
    this.#emitter.removeAllListeners();
    this.#remove();
  }

  send(data: WsData): void {
    this.#rawSend(data);
  }

  sendOnOpen(message: WsData | WsData[]): { stop(): void } {
    const entry = { messages: Array.isArray(message) ? message : [message] };

    this.#sticky.add(entry);

    if (this.#status === 'open') {
      for (const m of entry.messages) this.#rawSend(m);
    }

    return { stop: () => { this.#sticky.delete(entry); } };
  }

  onMessage(handler: (data: Buffer) => void): WsClientHandle {
    this.#emitter.on('message', handler as (...args: unknown[]) => void);

    return this;
  }

  on(event: string, handler: (...args: unknown[]) => void): WsClientHandle {
    this.#emitter.on(event, handler);

    return this;
  }

  off(event: string, handler: (...args: unknown[]) => void): WsClientHandle {
    this.#emitter.off(event, handler);

    return this;
  }

  configure(partial: Partial<WsClientSpec>): WsClientHandle {
    if (this.#status !== 'down') {
      throw new Error(`[net] cannot configure ws client "${this.#name}" while it is ${this.#status} — stop() first`);
    }

    Object.assign(this.#rawSpec, partial);
    this.#resolveConfig();

    return this;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  #resolveConfig(): void {
    const s = this.#rawSpec;

    this.#config = {
      url:       s.url,
      heartbeat: s.heartbeat ?? 30_000,
      backoff:   mergeRetryConfig(s.backoff),
      headers:   s.headers ?? {},
      auth:      s.auth,
    };

    this.#backoff = new Backoff(this.#config.backoff);
  }

  async #connect(): Promise<void> {
    if (this.#stopped) return;

    this.#status = this.#everOpened ? 'reconnecting' : 'connecting';

    let url: string;

    try {
      url = typeof this.#config.url === 'function' ? await this.#config.url() : this.#config.url;
    } catch (err) {
      this.#reach.down(`url factory failed: ${describeError(err)}`);
      this.#scheduleReconnect();

      return;
    }

    if (this.#stopped) return;

    const ws = new WebSocket(url, { headers: { ...this.#config.headers, ...authHeaders(this.#config.auth) } });

    this.#ws = ws;
    ws.setMaxListeners(0);

    ws.on('open',  () => this.#handleOpen(ws));
    ws.on('close', (code: number, reason: Buffer) => this.#handleClose(ws, code, reason));
    ws.on('error', (err: Error) => { this.#lastError = err; this.#emitter.emit('error', err); });
    ws.on('ping',  () => { this.#awaitingPong = false; ws.pong(); this.#emitter.emit('ping'); });
    ws.on('pong',  () => { this.#awaitingPong = false; this.#emitter.emit('pong'); });
    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      this.#awaitingPong = false;
      this.#emitter.emit('message', data, isBinary);
    });
    ws.on('unexpected-response', (...args: unknown[]) => this.#emitter.emit('unexpected-response', ...args));
  }

  #handleOpen(ws: WebSocket): void {
    if (ws !== this.#ws || this.#stopped) return;

    this.#status = 'open';
    this.#lastError = undefined;
    this.#backoff.reset();

    if (this.#everOpened) {
      this.#reach.up();
    } else {
      this.#everOpened = true;
      this.#service.logger.info(`[net] ${this.#name} connected`);
    }

    this.#startHeartbeat(ws);

    for (const entry of this.#sticky) {
      for (const m of entry.messages) this.#rawSend(m);
    }

    this.#emitter.emit('open');
  }

  #handleClose(ws: WebSocket, code: number, reason: Buffer): void {
    if (ws !== this.#ws) return;

    this.#stopHeartbeat();
    this.#ws = null;
    this.#emitter.emit('close', code, reason);

    if (this.#stopped) {
      this.#status = 'down';

      return;
    }

    const err = this.#lastError;
    this.#lastError = undefined;

    // A 429 means we are reconnecting too fast — skip the ramp, back off at the cap.
    if (err && isRateLimited(err)) this.#backoff.toCap();

    this.#reach.down(err ? describeError(err) : `closed (code ${code})`);
    this.#scheduleReconnect();
  }

  /**
   * Schedule a single reconnect. Single-flight: a no-op if one is already
   * pending, so the `error` + `close` pair from one failure collapses to one
   * attempt and attempts never pile up.
   */
  #scheduleReconnect(): void {
    if (this.#reconnectTimer || this.#stopped) return;

    this.#status = 'reconnecting';

    const delay = this.#backoff.next();

    this.#emitter.emit('reconnecting', delay);

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#connect();
    }, delay);

    this.#reconnectTimer.unref?.();
  }

  #startHeartbeat(ws: WebSocket): void {
    if (! this.#config.heartbeat) return;

    this.#awaitingPong = false;

    this.#pingInterval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;

      if (this.#awaitingPong) {
        ws.terminate();   // missed the previous pong — the connection is dead

        return;
      }

      this.#awaitingPong = true;
      ws.ping();
    }, this.#config.heartbeat);

    this.#pingInterval.unref?.();
  }

  #stopHeartbeat(): void {
    if (this.#pingInterval) {
      clearInterval(this.#pingInterval);
      this.#pingInterval = null;
    }

    this.#awaitingPong = false;
  }

  #rawSend(data: WsData): void {
    if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
      this.#ws.send(data);
    }
  }
}

// ── Kind registration ─────────────────────────────────────────────────────────

const handler: ClientHandler = {
  validate(spec): void {
    const s = spec as WsClientSpec;

    if (s.url === undefined) {
      throw new Error(`[net] ws client "${spec.name}" requires a "url"`);
    }

    if (typeof s.url !== 'string' && typeof s.url !== 'function') {
      throw new Error(`[net] ws client "${spec.name}": "url" must be a string or a factory function`);
    }

    if (s.heartbeat !== undefined && typeof s.heartbeat !== 'number') {
      throw new Error(`[net] ws client "${spec.name}": "heartbeat" must be a number`);
    }
  },

  create(spec, service, remove): WsClientHandle {
    return new WsClient(spec as WsClientSpec, service, remove);
  },
};

registerClient('ws', handler);
