import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { Service } from '../../src';
import { lookupServer } from '../../src/net/registry';
import '../../src/net/servers/ws';
import type { WsServerHandle, WsServerSpec } from '../../src/net/servers/ws';

// ── helpers ───────────────────────────────────────────────────────────────────

const mockService = (): Service => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}) as unknown as Service;

const makeServer = (spec: Partial<WsServerSpec> = {}): WsServerHandle => {
  const handler = lookupServer('ws')!;

  return handler.create(
    { name: 'feed', type: 'ws', port: 0, ...spec },
    mockService(),
    () => {},
  ) as WsServerHandle;
};

const running: WsServerHandle[] = [];
const clients: WebSocket[]      = [];

const start = async (h: WsServerHandle): Promise<number> => {
  running.push(h);
  await h.start();

  return (h.server!.address() as AddressInfo).port;
};

const connect = (port: number): Promise<WebSocket> => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://localhost:${port}`);

  clients.push(ws);
  ws.once('open',  () => resolve(ws));
  ws.once('error', reject);
});

const nextMessage = (ws: WebSocket): Promise<string> =>
  new Promise((resolve) => ws.once('message', (d) => resolve(d.toString())));

const until = async (cond: () => boolean, ms = 1_000): Promise<void> => {
  const deadline = Date.now() + ms;

  while (! cond() && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5));
  }

  if (! cond()) throw new Error('condition not met within timeout');
};

afterEach(async () => {
  for (const ws of clients.splice(0)) ws.close();
  for (const h of running.splice(0)) await h.stop();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ws server', () => {
  it('registers as the "ws" server kind', () => {
    expect(lookupServer('ws')).toBeDefined();
  });

  it('accepts connections and tracks them in the registry', async () => {
    const server = makeServer();
    let connects = 0;

    server.onConnect(() => { connects += 1; });

    const port = await start(server);

    await connect(port);
    await until(() => [...server.clients()].length === 1);

    expect(connects).toBe(1);
  });

  it('dispatches a command by op', async () => {
    const server = makeServer();
    let received: Record<string, unknown> | undefined;

    server.addCommand('sub', (_client, msg) => { received = msg; });

    const port = await start(server);
    const ws   = await connect(port);

    ws.send(JSON.stringify({ op: 'sub', channel: 'trades' }));
    await until(() => received !== undefined);

    expect(received).toEqual({ op: 'sub', channel: 'trades' });
  });

  it('passes every frame to onMessage', async () => {
    const server = makeServer();
    const frames: string[] = [];

    server.onMessage((_client, data) => frames.push(data.toString()));

    const port = await start(server);
    const ws   = await connect(port);

    ws.send('not json');
    await until(() => frames.length === 1);

    expect(frames[0]).toBe('not json');
  });

  it('answers a "ping" text frame with "pong"', async () => {
    const port = await start(makeServer());
    const ws   = await connect(port);

    const reply = nextMessage(ws);
    ws.send('ping');

    expect(await reply).toBe('pong');
  });

  it('broadcast() reaches every client', async () => {
    const server = makeServer();
    const port   = await start(server);
    const ws     = await connect(port);

    await until(() => [...server.clients()].length === 1);

    const msg = nextMessage(ws);
    server.broadcast('hello-all');

    expect(await msg).toBe('hello-all');
  });

  it('fires onDisconnect and drops the client on close', async () => {
    const server = makeServer();
    let gone = 0;

    server.onDisconnect(() => { gone += 1; });

    const port = await start(server);
    const ws   = await connect(port);

    await until(() => [...server.clients()].length === 1);

    ws.close();
    await until(() => gone === 1);

    expect([...server.clients()]).toHaveLength(0);
  });

  it('tracks status across start and stop', async () => {
    const server = makeServer();

    expect(server.isDown()).toBe(true);

    await start(server);
    expect(server.isUp()).toBe(true);

    await server.stop();
    expect(server.status).toBe('down');
  });
});
