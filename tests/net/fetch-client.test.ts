import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Service } from '../../src';
import { lookupClient } from '../../src/net/registry';
import '../../src/net/clients/fetch';
import type { FetchClientHandle, FetchClientSpec } from '../../src/net/clients/fetch';

// ── helpers ───────────────────────────────────────────────────────────────────

const mockService = (): Service => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}) as unknown as Service;

const makeClient = (spec: Partial<FetchClientSpec> = {}): FetchClientHandle => {
  const handler = lookupClient('fetch')!;

  return handler.create(
    { name: 'api', type: 'fetch', ...spec },
    mockService(),
    () => {},
  ) as FetchClientHandle;
};

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

// ── tests ─────────────────────────────────────────────────────────────────────

describe('fetch client', () => {
  it('registers as the "fetch" kind', () => {
    expect(lookupClient('fetch')).toBeDefined();
  });

  it('get() resolves parsed JSON on a 2xx', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));

    expect(await makeClient({ url: 'http://svc' }).get('/thing')).toEqual({ ok: true });
  });

  it('resolves relative paths against the base url', async () => {
    fetchMock.mockResolvedValueOnce(json({}));

    await makeClient({ url: 'http://svc' }).get('/thing');

    expect(fetchMock.mock.calls[0][0]).toBe('http://svc/thing');
  });

  it('get() returns null for a passThrough status', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404));

    expect(await makeClient({ url: 'http://svc', passThrough: [404] }).get('/missing')).toBeNull();
  });

  it('get() throws on an unexpected non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }));

    await expect(makeClient({ url: 'http://svc' }).get('/x')).rejects.toThrow(/HTTP 400/);
  });

  it('retries a retryOn status then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(json({ ok: 1 }));

    const client = makeClient({ url: 'http://svc', retry: { strategy: 'linear', delay: 1 } });

    expect(await client.get('/x')).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a network error then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error('fail'), { code: 'ECONNREFUSED' }))
      .mockResolvedValueOnce(json({ ok: 1 }));

    const client = makeClient({ url: 'http://svc', retry: { strategy: 'linear', delay: 1 } });

    expect(await client.get('/x')).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops retrying once the attempt cap is reached', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));

    const client = makeClient({ url: 'http://svc', retry: { strategy: 'linear', delay: 1, attempts: 3 } });

    await expect(client.get('/x')).rejects.toThrow(/HTTP 503/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('request() returns the raw Response', async () => {
    fetchMock.mockResolvedValueOnce(json({ a: 1 }));

    const res = await makeClient({ url: 'http://svc' }).request('/x');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1 });
  });

  it('post() sends a JSON body', async () => {
    fetchMock.mockResolvedValueOnce(json({}));

    await makeClient({ url: 'http://svc' }).post('/x', { hello: 'world' });

    const init = fetchMock.mock.calls[0][1];

    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"hello":"world"}');
  });

  it('applies bearer auth headers', async () => {
    fetchMock.mockResolvedValueOnce(json({}));

    await makeClient({ url: 'http://svc', auth: { bearer: 'abc' } }).get('/x');

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer abc');
  });

  it('applies a timeout signal to a normal request', async () => {
    fetchMock.mockResolvedValueOnce(json({}));

    await makeClient({ url: 'http://svc' }).get('/x');

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('does not apply the default timeout to a streaming-body upload', async () => {
    fetchMock.mockResolvedValueOnce(json({}));

    await makeClient({ url: 'http://svc' })
      .request('/upload', { method: 'PUT', body: new ReadableStream() });

    // No timeout controller — a large upload must not be aborted mid-stream.
    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
  });
});
