/**
 * The `fetch` client kind — a configured HTTP client.
 *
 * A thin, familiar layer over Node `fetch`: `request()` carries the exact
 * `fetch` signature and returns a real `Response`, with retry, timeout, auth,
 * a base URL, and transition logging layered on. `get<T>()` and friends are
 * the JSON sugar on top.
 *
 * Status policy is declarative: `retryOn` statuses (and network errors) are
 * retried with capped backoff; `passThrough` statuses resolve to `null` from
 * the JSON helpers; everything else non-2xx throws.
 */

import type { Service } from '../..';
import type { ClientHandle, ClientHandler, NetSpec } from '../types';
import { registerClient } from '../registry';
import { Backoff, mergeRetryConfig, type RetryConfig } from '../../support/retry';
import { Reachability, describeError } from '../../support/reachability';
import { authHeaders, type AuthSpec } from '../auth';

/** Per-request signer — returns headers for one request. */
export type SignFn = (req: { method: string; url: string; body: string })
  => Record<string, string> | Promise<Record<string, string>>;

export interface FetchInit extends RequestInit {
  /** Override the client's retry config for this request. */
  retry?:       Partial<RetryConfig>;
  /** Override the statuses retried for this request. */
  retryOn?:     number[];
  /** Statuses the JSON helpers resolve to `null` instead of throwing. */
  passThrough?: number[];
  /** Override the per-request timeout (ms); `0` disables it. */
  timeout?:     number;
  /**
   * Override how long the response body may go **silent** (ms); `0` disables it.
   *
   * Distinct from `timeout`, which bounds the wait for headers. This bounds the
   * gap between body chunks, so a large download is never cut off for being
   * large — only for having stopped.
   */
  stallTimeout?: number;
}

export interface FetchClientSpec extends NetSpec {
  type?:        'fetch';
  /** Base URL — relative paths passed to the client are resolved against it. */
  url?:         string;
  headers?:     Record<string, string>;
  timeout?:     number;
  stallTimeout?: number;
  retry?:       Partial<RetryConfig>;
  retryOn?:     number[];
  passThrough?: number[];
  auth?:        AuthSpec;
  sign?:        SignFn;
}

export interface FetchClientHandle extends ClientHandle {
  get<T>(path: string, opts?: FetchInit): Promise<T | null>;
  post<T>(path: string, body?: unknown, opts?: FetchInit): Promise<T | null>;
  put<T>(path: string, body?: unknown, opts?: FetchInit): Promise<T | null>;
  patch<T>(path: string, body?: unknown, opts?: FetchInit): Promise<T | null>;
  delete<T>(path: string, body?: unknown, opts?: FetchInit): Promise<T | null>;
  /** Exact `fetch` signature with retry/timeout/auth layered on; returns the raw `Response`. */
  request(input: string | URL, init?: FetchInit): Promise<Response>;
  configure(partial: Partial<FetchClientSpec>): FetchClientHandle;
  dispose(): void;
}

interface ResolvedConfig {
  url:         string;
  headers:     Record<string, string>;
  timeout:     number;
  /** `undefined` means "nobody chose" — the JSON helpers then apply their own default. */
  stallTimeout?: number;
  retry:       RetryConfig;
  retryOn:     number[];
  passThrough: number[];
  auth?:       AuthSpec;
  sign?:       SignFn;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * How long a **bounded** body may go silent before it is treated as dead.
 *
 * Applied by the JSON helpers, which read a whole document and can therefore
 * say that silence is always a fault. `request()` returns the body untouched
 * unless a stall timeout is asked for, because a raw response may legitimately
 * be a long-lived stream that says nothing for minutes at a time.
 */
const DEFAULT_STALL_MS = 30_000;
const DEFAULT_RETRY_ON   = [429, 502, 503, 504];

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** Statuses the `Response` constructor refuses to give a body to. */
const BODYLESS = new Set([101, 103, 204, 205, 304]);

const stalled = (ms: number): Error =>
  Object.assign(new Error(`Response body went silent for ${ms}ms`), { name: 'StallTimeoutError' });

/** How a response body is watched: what may end it, and who wants to know. */
export interface BodyGuard {
  /** Silence allowed between chunks, in ms. `0` or absent watches without a clock. */
  stallMs?:   number;
  /** The body went quiet for `stallMs`. Raised before the reader is answered. */
  onStall?:   () => void;
  /** The body is finished with — ended, failed, or cancelled. Called exactly once. */
  onSettled?: () => void;
}

/**
 * A response whose body is bounded by **silence rather than size**.
 *
 * `fetch` resolves when the headers arrive, so a deadline around the call
 * guards only the wait for a reply. Everything after it is unguarded: a server
 * that sends headers and then stops leaves whoever reads the body waiting for
 * ever, and a deadline covering the read is not the answer either, since it
 * would abort a large download for being large.
 *
 * So the clock here measures the gap between chunks and is restarted by every
 * one of them. A body that keeps arriving is never interrupted, however long it
 * takes; a body that stops is a fault within `stallMs` of stopping.
 *
 * **The error is raised on our own stream rather than through the abort.**
 * Aborting is asked for as well — a stalled body is still holding a socket —
 * but nothing here waits for the abort to be honoured, so a reader is answered
 * whether or not it is.
 *
 * `onSettled` is the other half, and the reason a caller may want this with no
 * clock at all: a request is not over when its headers arrive, and anything
 * counting what is in flight has to know when the transfer actually ended. It
 * fires once, whether the body ended, failed, or was cancelled unread — and
 * immediately when there is no body to wait for.
 */
export const guardBody = (res: Response, guard: BodyGuard): Response => {
  const { stallMs = 0, onStall, onSettled } = guard;

  let settled = false;

  const settle = (): void => {
    if (settled) return;

    settled = true;
    onSettled?.();
  };

  if (! res.body || BODYLESS.has(res.status)) {
    settle();

    return res;
  }

  if (stallMs <= 0 && ! onSettled) return res;

  const source = res.body.getReader();

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        const step = await Promise.race([
          source.read(),
          new Promise<never>((_, reject) => {
            if (stallMs > 0) timer = setTimeout(() => reject(stalled(stallMs)), stallMs);
          }),
        ]);

        if (step.done) {
          settle();
          controller.close();
        } else {
          controller.enqueue(step.value);
        }
      } catch (err) {
        onStall?.();
        void source.cancel().catch(() => {});
        settle();
        controller.error(err);
      } finally {
        clearTimeout(timer);
      }
    },

    cancel: reason => {
      settle();

      return source.cancel(reason);
    },
  });

  const guarded = new Response(stream, {
    status:     res.status,
    statusText: res.statusText,
    headers:    res.headers,
  });

  // Neither survives the constructor, and both are read by ordinary callers.
  Object.defineProperty(guarded, 'url',        { value: res.url,        configurable: true });
  Object.defineProperty(guarded, 'redirected', { value: res.redirected, configurable: true });

  return guarded;
};

// ── The client ────────────────────────────────────────────────────────────────

class FetchClient implements FetchClientHandle {
  #name:    string;
  #remove:  () => void;
  #reach:   Reachability;
  #rawSpec: FetchClientSpec;
  #config!: ResolvedConfig;

  constructor(spec: FetchClientSpec, service: Service, remove: () => void) {
    this.#name    = spec.name ?? 'fetch';
    this.#remove  = remove;
    this.#rawSpec = { ...spec };
    this.#reach   = new Reachability(service.logger, this.#name);

    this.#resolveConfig();
  }

  get<T>(path: string, opts?: FetchInit): Promise<T | null> {
    return this.#json<T>(path, { ...opts, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, opts?: FetchInit): Promise<T | null> {
    return this.#json<T>(path, this.#withBody('POST', body, opts));
  }

  put<T>(path: string, body?: unknown, opts?: FetchInit): Promise<T | null> {
    return this.#json<T>(path, this.#withBody('PUT', body, opts));
  }

  patch<T>(path: string, body?: unknown, opts?: FetchInit): Promise<T | null> {
    return this.#json<T>(path, this.#withBody('PATCH', body, opts));
  }

  delete<T>(path: string, body?: unknown, opts?: FetchInit): Promise<T | null> {
    return this.#json<T>(path, this.#withBody('DELETE', body, opts));
  }

  async request(input: string | URL, init: FetchInit = {}): Promise<Response> {
    const url       = this.#resolveUrl(input);
    const retry     = mergeRetryConfig(init.retry ?? this.#config.retry);
    const retryable = new Set(init.retryOn ?? this.#config.retryOn);
    const backoff   = new Backoff(retry);
    const capped    = retry.attempts !== undefined;

    // A streaming-body request is an upload of unbounded duration — `fetch`
    // resolves only once the whole body has been sent, so the default timeout
    // would abort a perfectly healthy large upload. Skip it for streaming
    // bodies; an explicit `timeout` still wins if the caller sets one.
    const streaming = init.body instanceof ReadableStream;
    const timeoutMs = init.timeout ?? (streaming ? 0 : this.#config.timeout);

    /**
     * **Left off unless somebody asked for it.** `request()` hands back a live
     * response, and a caller may be holding it open on purpose — an event
     * stream says nothing between events, and that is not a fault. The JSON
     * helpers know their body is a whole document and pass their own default.
     */
    const stallMs = init.stallTimeout ?? this.#config.stallTimeout ?? 0;

    let attempt = 0;

    while (true) {
      attempt += 1;

      const ownTimeout = ! init.signal && timeoutMs > 0;
      const controller = ownTimeout ? new AbortController() : null;
      const timer      = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

      let res: Response;

      try {
        const headers = await this.#headers(init, url);

        res = await fetch(url, { ...this.#fetchInit(init), headers, signal: init.signal ?? controller?.signal });
      } catch (err) {
        if (timer) clearTimeout(timer);

        if (capped && attempt >= retry.attempts!) {
          this.#reach.down(describeError(err));

          throw err;
        }

        this.#reach.down(describeError(err));
        await sleep(backoff.next());

        continue;
      }

      if (timer) clearTimeout(timer);

      if (retryable.has(res.status)) {
        if (capped && attempt >= retry.attempts!) return res;

        this.#reach.down(`HTTP ${res.status}`);
        await sleep(res.status === 429 ? this.#retryAfter(res, backoff) : backoff.next());

        continue;
      }

      this.#reach.up();

      return guardBody(res, { stallMs, onStall: () => controller?.abort() });
    }
  }

  configure(partial: Partial<FetchClientSpec>): FetchClientHandle {
    Object.assign(this.#rawSpec, partial);
    this.#resolveConfig();

    return this;
  }

  /** Stateless — nothing to keep open; clears the reachability reminder. */
  stop(): void {
    this.#reach.dispose();
  }

  dispose(): void {
    this.stop();
    this.#remove();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  #resolveConfig(): void {
    const s = this.#rawSpec;

    this.#config = {
      url:         s.url ?? '',
      headers:     s.headers ?? {},
      timeout:     s.timeout ?? DEFAULT_TIMEOUT_MS,
      stallTimeout: s.stallTimeout,
      retry:       mergeRetryConfig(s.retry),
      retryOn:     s.retryOn ?? DEFAULT_RETRY_ON,
      passThrough: s.passThrough ?? [],
      auth:        s.auth,
      sign:        s.sign,
    };
  }

  async #json<T>(path: string, init: FetchInit): Promise<T | null> {
    // Reading a whole document, so silence is always a fault — see DEFAULT_STALL_MS.
    const res = await this.request(path, {
      ...init,
      stallTimeout: init.stallTimeout ?? this.#config.stallTimeout ?? DEFAULT_STALL_MS,
    });

    if (res.ok) {
      return res.json() as Promise<T>;
    }

    const passThrough = init.passThrough ?? this.#config.passThrough;

    if (passThrough.includes(res.status)) return null;

    const body = await res.text().catch(() => '');

    throw Object.assign(
      new Error(`[net] ${this.#name}: ${init.method ?? 'GET'} ${path} failed (HTTP ${res.status})${body ? `: ${body}` : ''}`),
      { httpStatus: res.status },
    );
  }

  #withBody(method: string, body: unknown, opts?: FetchInit): FetchInit {
    if (body === undefined) return { ...opts, method };

    return {
      ...opts,
      method,
      body:    typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...toRecord(opts?.headers) },
    };
  }

  #resolveUrl(input: string | URL): string {
    const url = input instanceof URL ? input.toString() : input;

    if (/^[a-z]+:\/\//i.test(url) || ! this.#config.url) return url;

    return `${this.#config.url.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
  }

  async #headers(init: FetchInit, url: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      ...this.#config.headers,
      ...authHeaders(this.#config.auth),
    };

    if (this.#config.sign) {
      const body   = typeof init.body === 'string' ? init.body : '';
      const signed = await this.#config.sign({ method: (init.method ?? 'GET').toUpperCase(), url, body });

      Object.assign(headers, signed);
    }

    Object.assign(headers, toRecord(init.headers));

    return headers;
  }

  /** Strip our own additions so the rest is a plain `RequestInit` for `fetch`. */
  #fetchInit(init: FetchInit): RequestInit {
    const { retry: _r, retryOn: _ro, passThrough: _pt, timeout: _t, stallTimeout: _st,
      headers: _h, signal: _s, ...rest } = init;

    return rest;
  }

  #retryAfter(res: Response, backoff: Backoff): number {
    const retryAfter = res.headers.get('retry-after');

    if (retryAfter) {
      const secs = Number(retryAfter);

      if (! Number.isNaN(secs)) return secs * 1_000;

      const date = Date.parse(retryAfter);

      if (! Number.isNaN(date)) return Math.max(0, date - Date.now());
    }

    const reset = Number(res.headers.get('x-ratelimit-reset'));

    if (! Number.isNaN(reset) && reset > 0) return Math.max(0, reset * 1_000 - Date.now());

    backoff.toCap();

    return backoff.next();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toRecord(headers?: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};

  if (! headers) return out;

  if (headers instanceof Headers) {
    headers.forEach((value, key) => { out[key] = value; });

    return out;
  }

  const entries = Array.isArray(headers) ? headers : Object.entries(headers);

  for (const [key, value] of entries) {
    if (value !== undefined) out[key] = String(value);
  }

  return out;
}

// ── Kind registration ─────────────────────────────────────────────────────────

const handler: ClientHandler = {
  validate(spec): void {
    const s = spec as FetchClientSpec;

    if (s.url !== undefined && typeof s.url !== 'string') {
      throw new Error(`[net] fetch client "${spec.name}": "url" (base URL) must be a string`);
    }

    if (s.sign !== undefined && typeof s.sign !== 'function') {
      throw new Error(`[net] fetch client "${spec.name}": "sign" must be a function`);
    }
  },

  create(spec, service, remove): FetchClientHandle {
    return new FetchClient(spec as FetchClientSpec, service, remove);
  },
};

registerClient('fetch', handler);
