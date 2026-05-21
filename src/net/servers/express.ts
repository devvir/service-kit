/**
 * The `express` server kind — an HTTP server with batteries included.
 *
 * `create()` builds the app with body parsing, request logging, a `/ping`
 * route, and rate limiting already wired. Routes and middleware are added
 * cumulatively on the handle; `start()` appends the one complete error handler
 * and binds the port. `tls` upgrades the listener to HTTPS in place.
 */

import express, { type Application, type Router, type ErrorRequestHandler } from 'express';
import http from 'node:http';
import https from 'node:https';
import type { Service } from '../..';
import type { ServerHandle, ServerHandler, NetSpec } from '../types';
import { registerServer } from '../registry';
import { rateLimitMiddleware, type RateLimit } from './rate-limit';

export type ExpressStatus = 'down' | 'starting' | 'up' | 'closing';

/** A cumulative route contribution: an express `Router` or an `(app) => void` builder. */
export type RouteContribution = Router | ((app: Application) => void);

export interface ExpressServerSpec extends NetSpec {
  type?:      'express';
  port?:      number;
  /** JSON body parsing — `true`, `{ limit }`, or `false` to disable. */
  json?:      boolean | { limit?: string };
  /** Parse the body as raw bytes instead of JSON (e.g. a proxy). */
  raw?:       boolean;
  /** Prefix prepended to every route added via `addRoute`. */
  basePath?:  string;
  /** Mount `GET /ping` → `200`. Default `true`. */
  pingable?:  boolean;
  rateLimit?: RateLimit | null;
  tls?:       { cert: string | Buffer; key: string | Buffer };
  /** Node `http.Server.requestTimeout` (ms) — the full-request deadline; `0` disables it. */
  requestTimeout?: number;
  /** Node `http.Server.headersTimeout` (ms). */
  headersTimeout?: number;
  /**
   * Node `http.Server.keepAliveTimeout` (ms) — how long an idle keep-alive
   * connection is held before the server closes it. Node's default (5 s) is
   * often too short for pooled HTTP clients (undici/fetch), which can reuse a
   * connection just as the server closes it → `ECONNRESET`/`write EPIPE`. Raise
   * it above the client's idle-reuse window; keep `headersTimeout` larger still.
   */
  keepAliveTimeout?: number;
}

export interface ExpressServerHandle extends ServerHandle {
  addRoutes(routes: RouteContribution | RouteContribution[]): ExpressServerHandle;
  addRoute(method: string, path: string, ...handlers: unknown[]): ExpressServerHandle;
  use(...middleware: unknown[]): ExpressServerHandle;
  mount(basePath: string, router: Router): ExpressServerHandle;
  setBase(path: string): ExpressServerHandle;
  start(): Promise<ExpressServerHandle>;
  stop(): Promise<ExpressServerHandle>;
  dispose(): Promise<void>;
  isUp(): boolean;
  isDown(): boolean;
  readonly status: ExpressStatus;
  /** The underlying express app — escape hatch, and the supertest entry point. */
  readonly app: Application;
  /** The underlying HTTP server once started — escape hatch. */
  readonly server: http.Server | null;
  configure(partial: Partial<ExpressServerSpec>): ExpressServerHandle;
}

interface ResolvedConfig {
  port:      number;
  json:      boolean;
  bodyLimit?: string;
  raw:       boolean;
  pingable:  boolean;
  rateLimit: RateLimit | null;
  tls?:      { cert: string | Buffer; key: string | Buffer };
  requestTimeout?: number;
  headersTimeout?: number;
  keepAliveTimeout?: number;
}

const resolvePort = (spec: ExpressServerSpec): number =>
  spec.port ?? (Number(process.env.NET_DEFAULT_PORT) || 80);

// ── The server ────────────────────────────────────────────────────────────────

class ExpressServer implements ExpressServerHandle {
  #name:    string;
  #service: Service;
  #remove:  () => void;

  #app:    Application;
  #server: http.Server | null = null;
  #status: ExpressStatus = 'down';
  #errorHandlerAdded = false;

  #rawSpec:  ExpressServerSpec;
  #config!:  ResolvedConfig;
  #basePath: string;

  constructor(spec: ExpressServerSpec, service: Service, remove: () => void) {
    this.#name     = spec.name ?? 'express';
    this.#service  = service;
    this.#remove   = remove;
    this.#rawSpec  = { ...spec };
    this.#basePath = spec.basePath ?? '';

    this.#resolveConfig();

    this.#app = express();
    this.#applyBuiltins();
  }

  get status(): ExpressStatus {
    return this.#status;
  }

  get app(): Application {
    return this.#app;
  }

  get server(): http.Server | null {
    return this.#server;
  }

  isUp(): boolean {
    return this.#status === 'up';
  }

  isDown(): boolean {
    return this.#status === 'down';
  }

  addRoute(method: string, path: string, ...handlers: unknown[]): ExpressServerHandle {
    (this.#app as unknown as Record<string, (...a: unknown[]) => void>)[method.toLowerCase()]!(
      this.#basePath + path,
      ...handlers,
    );

    return this;
  }

  addRoutes(routes: RouteContribution | RouteContribution[]): ExpressServerHandle {
    const list = Array.isArray(routes) ? routes : [routes];

    for (const route of list) {
      if (isRouter(route)) {
        this.#app.use(this.#basePath || '/', route);
      } else {
        route(this.#app);
      }
    }

    return this;
  }

  use(...middleware: unknown[]): ExpressServerHandle {
    this.#app.use(...(middleware as Parameters<Application['use']>));

    return this;
  }

  mount(basePath: string, router: Router): ExpressServerHandle {
    this.#app.use(basePath, router);

    return this;
  }

  setBase(path: string): ExpressServerHandle {
    this.#basePath = path;

    return this;
  }

  async start(): Promise<ExpressServerHandle> {
    if (this.#status === 'up' || this.#status === 'starting') return this;

    this.#status = 'starting';

    if (! this.#errorHandlerAdded) {
      this.#app.use(errorHandler(this.#service, this.#name));
      this.#errorHandlerAdded = true;
    }

    const server = this.#config.tls
      ? https.createServer(this.#config.tls, this.#app)
      : http.createServer(this.#app);

    if (this.#config.requestTimeout !== undefined) server.requestTimeout = this.#config.requestTimeout;
    if (this.#config.headersTimeout !== undefined) server.headersTimeout = this.#config.headersTimeout;
    if (this.#config.keepAliveTimeout !== undefined) server.keepAliveTimeout = this.#config.keepAliveTimeout;

    await new Promise<void>((resolve, reject) => {
      const onListenError = (err: Error): void => {
        this.#status = 'down';
        reject(err);
      };

      server.once('error', onListenError);

      server.listen(this.#config.port, () => {
        server.off('error', onListenError);
        resolve();
      });
    });

    server.on('error', (err) => this.#service.logger.error({ err }, `[net] ${this.#name} server error`));

    this.#server = server;
    this.#status = 'up';
    this.#service.logger.info(`[net] ${this.#name} listening on :${this.#config.port}`);

    return this;
  }

  async stop(): Promise<ExpressServerHandle> {
    if (! this.#server || this.#status === 'down') {
      this.#status = 'down';

      return this;
    }

    this.#status = 'closing';

    const server = this.#server;

    await new Promise<void>((resolve) => server.close(() => resolve()));

    this.#server = null;
    this.#status = 'down';

    return this;
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.#remove();
  }

  configure(partial: Partial<ExpressServerSpec>): ExpressServerHandle {
    if (this.#status !== 'down') {
      throw new Error(`[net] cannot configure server "${this.#name}" while it is ${this.#status} — stop() first`);
    }

    Object.assign(this.#rawSpec, partial);

    if (partial.basePath !== undefined) this.#basePath = partial.basePath;

    this.#resolveConfig();

    return this;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  #resolveConfig(): void {
    const s    = this.#rawSpec;
    const json = s.json ?? true;

    this.#config = {
      port:      resolvePort(s),
      json:      json !== false,
      bodyLimit: typeof json === 'object' ? json.limit : undefined,
      raw:       s.raw ?? false,
      pingable:  s.pingable ?? true,
      rateLimit: s.rateLimit ?? null,
      requestTimeout: s.requestTimeout,
      headersTimeout: s.headersTimeout,
      keepAliveTimeout: s.keepAliveTimeout,
      tls:       s.tls,
    };
  }

  #applyBuiltins(): void {
    if (this.#config.raw) {
      this.#app.use(express.raw({ type: '*/*', limit: this.#config.bodyLimit }));
    } else if (this.#config.json) {
      this.#app.use(express.json({ limit: this.#config.bodyLimit }));
    }

    this.#app.use((req, _res, next) => {
      this.#service.logger.debug({ method: req.method, url: req.url }, `[net] ${this.#name} request`);
      next();
    });

    if (this.#config.rateLimit) {
      this.#app.use(rateLimitMiddleware(this.#config.rateLimit));
    }

    if (this.#config.pingable) {
      this.#app.get('/ping', (_req, res) => { res.status(200).type('text/plain').send('pong'); });
    }
  }
}

// ── Error handler ─────────────────────────────────────────────────────────────

/**
 * The one complete default error handler — generic signals only, no validation
 * library. A `ZodError` (or any validator's error) reaches `400` by carrying a
 * `status`, set by whatever validated the request.
 */
function errorHandler(service: Service, name: string): ErrorRequestHandler {
  return (err, _req, res, next): void => {
    if (res.headersSent) {
      next(err);

      return;
    }

    const e = err as { status?: number; statusCode?: number; type?: string; message?: string };

    if (e?.type === 'request.aborted') {
      res.status(499).end();

      return;
    }

    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body too large' });

      return;
    }

    if (err instanceof SyntaxError || e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON body' });

      return;
    }

    const status = e?.status ?? e?.statusCode;

    if (typeof status === 'number' && status >= 400 && status < 600) {
      res.status(status).json({ error: e.message ?? 'Error' });

      return;
    }

    service.logger.error({ err }, `[net] ${name} unhandled request error`);
    res.status(500).json({ error: 'Internal server error' });
  };
}

const isRouter = (route: RouteContribution): route is Router =>
  typeof route === 'function' && typeof (route as { use?: unknown }).use === 'function';

// ── Kind registration ─────────────────────────────────────────────────────────

const handler: ServerHandler = {
  validate(spec): void {
    const s = spec as ExpressServerSpec;

    if (s.port !== undefined && (typeof s.port !== 'number' || s.port < 0)) {
      throw new Error(`[net] express server "${spec.name}": "port" must be a non-negative number`);
    }

    if (s.rateLimit != null && typeof s.rateLimit !== 'string' && typeof s.rateLimit !== 'object') {
      throw new Error(`[net] express server "${spec.name}": "rateLimit" must be a string or an object`);
    }
  },

  create(spec, service, remove): ExpressServerHandle {
    return new ExpressServer(spec as ExpressServerSpec, service, remove);
  },
};

registerServer('express', handler);
