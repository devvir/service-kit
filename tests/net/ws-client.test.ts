import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Service } from '../../src';
import { lookupClient } from '../../src/net/registry';
import '../../src/net/clients/ws';
import type { WsClientHandle, WsClientSpec } from '../../src/net/clients/ws';

// ── ws mock ───────────────────────────────────────────────────────────────────

const { sockets } = vi.hoisted(() => ({ sockets: [] as any[] }));

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;

    readyState = 1;
    url:     string;
    options: unknown;
    send  = vi.fn();
    ping  = vi.fn();
    pong  = vi.fn();
    setMaxListeners = vi.fn();
    close     = vi.fn(function (this: MockWebSocket) { this.readyState = 3; this.emit('close', 1000, Buffer.from('')); });
    terminate = vi.fn(function (this: MockWebSocket) { this.readyState = 3; this.emit('close', 1006, Buffer.from('')); });

    constructor(url: string, options?: unknown) {
      super();
      this.url     = url;
      this.options = options;
      sockets.push(this);
    }
  }

  return { default: MockWebSocket };
});

// ── helpers ───────────────────────────────────────────────────────────────────

const mockService = (): Service => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}) as unknown as Service;

const makeClient = (spec: Partial<WsClientSpec> & Pick<WsClientSpec, 'url'>): WsClientHandle => {
  const handler = lookupClient('ws')!;

  return handler.create(
    { name: 'test', type: 'ws', ...spec },
    mockService(),
    () => {},
  ) as WsClientHandle;
};

beforeEach(() => { sockets.length = 0; vi.useFakeTimers(); });
afterEach(()  => { vi.clearAllTimers(); vi.useRealTimers(); });

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ws client', () => {
  it('registers itself as the "ws" kind', () => {
    expect(lookupClient('ws')).toBeDefined();
  });

  it('dials the url on start and opens', async () => {
    const client = makeClient({ url: 'wss://example.com/feed' });
    const ready  = client.start();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://example.com/feed');
    expect(client.status).toBe('connecting');

    sockets[0].emit('open');
    await ready;

    expect(client.isUp()).toBe(true);
    expect(client.status).toBe('open');
  });

  it('reconnects after a close, single-flight on error + close', () => {
    const client = makeClient({ url: 'wss://x' });

    client.start();
    sockets[0].emit('open');

    // a real failure emits both — they must collapse to one reconnect
    sockets[0].emit('error', new Error('ECONNRESET'));
    sockets[0].emit('close', 1006, Buffer.from(''));

    vi.advanceTimersByTime(500);   // first backoff step

    expect(sockets).toHaveLength(2);   // exactly one reconnect
  });

  it('re-sends sendOnOpen messages on every open', () => {
    const client = makeClient({ url: 'wss://x' });

    client.start();
    client.sendOnOpen(['{"op":"subscribe"}', '{"op":"auth"}']);
    sockets[0].emit('open');

    expect(sockets[0].send).toHaveBeenCalledTimes(2);

    sockets[0].emit('close', 1006, Buffer.from(''));
    vi.advanceTimersByTime(500);
    sockets[1].emit('open');

    expect(sockets[1].send).toHaveBeenCalledTimes(2);   // re-sent on the new socket
  });

  it('stops re-sending a sendOnOpen entry once its handle is stopped', () => {
    const client = makeClient({ url: 'wss://x' });

    client.start();
    const sticky = client.sendOnOpen('{"op":"subscribe"}');
    sticky.stop();
    sockets[0].emit('open');

    expect(sockets[0].send).not.toHaveBeenCalled();
  });

  it('sends a heartbeat ping while open', () => {
    const client = makeClient({ url: 'wss://x', heartbeat: 1_000 });

    client.start();
    sockets[0].emit('open');

    vi.advanceTimersByTime(1_000);
    expect(sockets[0].ping).toHaveBeenCalledTimes(1);
  });

  it('stop() goes down and does not reconnect', () => {
    const client = makeClient({ url: 'wss://x' });

    client.start();
    sockets[0].emit('open');
    client.stop();

    expect(client.status).toBe('down');

    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);   // no reconnect after stop
  });

  it('re-invokes a url factory on every connect', () => {
    let n = 0;
    const client = makeClient({ url: () => `wss://x/${n++}` });

    client.start();

    return Promise.resolve().then(() => {
      expect(sockets[0].url).toBe('wss://x/0');

      sockets[0].emit('close', 1006, Buffer.from(''));
      vi.advanceTimersByTime(500);

      return Promise.resolve().then(() => {
        expect(sockets[1].url).toBe('wss://x/1');
      });
    });
  });

  it('sends well-known auth as upgrade headers', () => {
    const client = makeClient({ url: 'wss://x', auth: { bearer: 'tok-123' } });

    client.start();

    expect((sockets[0].options as { headers: Record<string, string> }).headers.Authorization)
      .toBe('Bearer tok-123');
  });
});
