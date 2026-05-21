import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Service } from '../../src';
import { lookupServer } from '../../src/net/registry';
import '../../src/net/servers/express';
import type { ExpressServerHandle, ExpressServerSpec } from '../../src/net/servers/express';

// ── helpers ───────────────────────────────────────────────────────────────────

const mockService = (): Service => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}) as unknown as Service;

const makeServer = (spec: Partial<ExpressServerSpec> = {}): ExpressServerHandle => {
  const handler = lookupServer('express')!;

  return handler.create(
    { name: 'api', type: 'express', port: 0, ...spec },   // port 0 → ephemeral
    mockService(),
    () => {},
  ) as ExpressServerHandle;
};

const running: ExpressServerHandle[] = [];

const start = async (h: ExpressServerHandle): Promise<string> => {
  running.push(h);
  await h.start();

  return `http://localhost:${(h.server!.address() as AddressInfo).port}`;
};

afterEach(async () => {
  for (const h of running.splice(0)) await h.stop();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('express server', () => {
  it('registers as the "express" kind', () => {
    expect(lookupServer('express')).toBeDefined();
  });

  it('serves a route added via addRoute', async () => {
    const server = makeServer();

    server.addRoute('get', '/hello', (_req: unknown, res: any) => res.json({ hi: true }));

    const base = await start(server);
    const res  = await fetch(`${base}/hello`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hi: true });
  });

  it('answers GET /ping', async () => {
    const base = await start(makeServer());

    expect((await fetch(`${base}/ping`)).status).toBe(200);
  });

  it('parses a JSON body', async () => {
    const server = makeServer();

    server.addRoute('post', '/echo', (req: any, res: any) => res.json(req.body));

    const base = await start(server);
    const res  = await fetch(`${base}/echo`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ value: 42 }),
    });

    expect(await res.json()).toEqual({ value: 42 });
  });

  it('maps a thrown error to 500 via the built-in handler', async () => {
    const server = makeServer();

    server.addRoute('get', '/boom', () => { throw new Error('kaboom'); });

    const base = await start(server);

    expect((await fetch(`${base}/boom`)).status).toBe(500);
  });

  it('honours an error that carries a status', async () => {
    const server = makeServer();

    server.addRoute('get', '/bad', (_req: unknown, _res: unknown, next: any) =>
      next(Object.assign(new Error('nope'), { status: 422 })));

    const base = await start(server);

    expect((await fetch(`${base}/bad`)).status).toBe(422);
  });

  it('rate-limits once the window cap is exceeded', async () => {
    const server = makeServer({ rateLimit: '2/m' });

    server.addRoute('get', '/x', (_req: unknown, res: any) => res.send('ok'));

    const base     = await start(server);
    const statuses = [
      (await fetch(`${base}/x`)).status,
      (await fetch(`${base}/x`)).status,
      (await fetch(`${base}/x`)).status,
    ];

    expect(statuses).toEqual([200, 200, 429]);
  });

  it('tracks status across start and stop', async () => {
    const server = makeServer();

    expect(server.isDown()).toBe(true);

    await start(server);
    expect(server.isUp()).toBe(true);

    await server.stop();
    expect(server.status).toBe('down');
  });

  it('applies requestTimeout to the underlying HTTP server', async () => {
    const server = makeServer({ requestTimeout: 0 });

    await start(server);

    expect(server.server!.requestTimeout).toBe(0);
  });
});
