import { describe, it, expect, vi, beforeEach } from 'vitest';
import runner from '../../src/core/runner';
import providersPlugin, { registerProvider } from '../../src/plugins/providers';
import shutdownPlugin, { __test__ as shutdownTest } from '../../src/plugins/shutdown';
import type { Service } from '../../src';

// ---- Fake provider setup ------------------------------------------------

const fakeConnection  = Symbol('connection');
let connectMock:    ReturnType<typeof vi.fn>;
let disconnectMock: ReturnType<typeof vi.fn>;
let validateMock:   ReturnType<typeof vi.fn>;

beforeEach(() => {
  shutdownTest.reset();

  connectMock    = vi.fn().mockResolvedValue(fakeConnection);
  disconnectMock = vi.fn().mockResolvedValue(undefined);
  validateMock   = vi.fn();

  registerProvider('fake-db', 'database', {
    validate:   validateMock,
    connect:    connectMock,
    disconnect: disconnectMock,
    reconnect:  vi.fn(),
  });
});

const ctx = (spec: Record<string, unknown>[] = []) => ({
  defaults: { spec: {}, bindings: {}, plugins: [providersPlugin, shutdownPlugin] },
  spec,
  bindings: [],
  plugins:  [],
});

const dbSpec = { providers: { mydb: { provider: 'fake-db', url: 'fake://host' } } };

// ---- Tests ---------------------------------------------------------------

describe('Providers Plugin', () => {

  // ========== SERVICE API ==========
  describe('service.providers', () => {
    it('exposes a connect() method on the service', async () => {
      await runner((service: Service) => {
        expect(typeof (service as any).providers?.connect).toBe('function');
      }, ctx());
    });
  });

  // ========== CONNECT ==========
  describe('connect()', () => {
    it('returns the connection for a single name', async () => {
      await runner(async (service: Service) => {
        const conn = await (service as any).providers.connect('mydb');
        expect(conn).toBe(fakeConnection);
      }, ctx([dbSpec]));
    });

    it('returns an array of connections for multiple names', async () => {
      registerProvider('fake-db-2', 'database', {
        validate:   vi.fn(),
        connect:    vi.fn().mockResolvedValue(Symbol('conn2')),
        disconnect: vi.fn().mockResolvedValue(undefined),
        reconnect:  vi.fn(),
      });

      await runner(async (service: Service) => {
        const conns = await (service as any).providers.connect(['mydb', 'otherdb']);
        expect(Array.isArray(conns)).toBe(true);
        expect(conns).toHaveLength(2);
      }, ctx([{ providers: {
        mydb:    { provider: 'fake-db',   url: 'fake://host' },
        otherdb: { provider: 'fake-db-2', url: 'fake://host' },
      } }]));
    });

    it('throws when connecting a name not in spec', async () => {
      await expect(runner(async (service: Service) => {
        await (service as any).providers.connect('nonexistent');
      }, ctx())).rejects.toThrow('[Providers] No provider configured with name "nonexistent"');
    });
  });

  // ========== EVENTS ==========
  describe('events', () => {
    it('emits providerConnected with (type, name) after connect', async () => {
      const listener = vi.fn();

      await runner(async (service: Service) => {
        service.on('providerConnected', listener);
        await (service as any).providers.connect('mydb');
        expect(listener).toHaveBeenCalledWith(service, 'database', 'mydb');
      }, ctx([dbSpec]));
    });

    it("emits '${name}Connected' when a named provider connects", async () => {
      const listener = vi.fn();

      await runner(async (service: Service) => {
        service.on('mydbConnected', listener);
        await (service as any).providers.connect('mydb');
        expect(listener).toHaveBeenCalledWith(service, 'database', 'mydb');
      }, ctx([dbSpec]));
    });

    it("only emits '${name}Connected' for the connected provider, not others", async () => {
      const mydbListener   = vi.fn();
      const otherListener  = vi.fn();

      await runner(async (service: Service) => {
        service.on('mydbConnected',    mydbListener);
        service.on('otherdbConnected', otherListener);
        await (service as any).providers.connect('mydb');
        expect(mydbListener).toHaveBeenCalledOnce();
        expect(otherListener).not.toHaveBeenCalled();
      }, ctx([{ providers: {
        mydb:    { provider: 'fake-db', url: 'fake://host' },
        otherdb: { provider: 'fake-db', url: 'fake://host' },
      } }]));
    });

    it('emits providerDisconnected on shutdown', async () => {
      const listener = vi.fn();

      await runner(async (service: Service) => {
        service.on('providerDisconnected', listener);
        await (service as any).providers.connect('mydb');
        (service as any).shutdown();
        await new Promise(r => setImmediate(r));
        expect(listener).toHaveBeenCalledWith(service, 'database', 'mydb');
      }, ctx([dbSpec]));
    });

    it("emits '${name}Disconnected' on shutdown", async () => {
      const listener = vi.fn();

      await runner(async (service: Service) => {
        service.on('mydbDisconnected', listener);
        await (service as any).providers.connect('mydb');
        (service as any).shutdown();
        await new Promise(r => setImmediate(r));
        expect(listener).toHaveBeenCalledWith(service, 'database', 'mydb');
      }, ctx([dbSpec]));
    });
  });

  // ========== SHUTDOWN ==========
  describe('shutdown', () => {
    it('calls disconnect on all active connections', async () => {
      await runner(async (service: Service) => {
        await (service as any).providers.connect('mydb');
        (service as any).shutdown();
        expect(disconnectMock).toHaveBeenCalledWith(fakeConnection);
      }, ctx([dbSpec]));
    });

    it('disconnects in reverse connection order', async () => {
      const order: string[] = [];

      const makeHandler = (label: string) => ({
        validate:   vi.fn(),
        connect:    vi.fn().mockResolvedValue(Symbol(label)),
        disconnect: vi.fn().mockImplementation(() => { order.push(label); return Promise.resolve(); }),
        reconnect:  vi.fn(),
      });

      registerProvider('db-a', 'database', makeHandler('a'));
      registerProvider('db-b', 'database', makeHandler('b'));

      await runner(async (service: Service) => {
        await (service as any).providers.connect(['conn-a', 'conn-b']);
        (service as any).shutdown();
        await new Promise(r => setImmediate(r));
        expect(order).toEqual(['b', 'a']);
      }, ctx([{ providers: {
        'conn-a': { provider: 'db-a', url: 'fake://host' },
        'conn-b': { provider: 'db-b', url: 'fake://host' },
      } }]));
    });
  });

  // ========== VALIDATION ==========
  describe('init-time validation', () => {
    it('throws at init if a configured provider is not registered', async () => {
      await expect(runner(() => {}, ctx([{
        providers: { mydb: { provider: 'nonexistent-driver', url: 'fake://host' } },
      }]))).rejects.toThrow('[Providers] Unknown provider "nonexistent-driver"');
    });

    it("calls the provider's validate() during init", async () => {
      await runner(() => {}, ctx([dbSpec]));
      expect(validateMock).toHaveBeenCalledWith({ provider: 'fake-db', url: 'fake://host' });
    });

    it('throws at init if validate() fails', async () => {
      validateMock.mockImplementation(() => { throw new Error('bad url'); });

      await expect(runner(() => {}, ctx([dbSpec]))).rejects.toThrow('bad url');
    });
  });

  // ========== OPTIONAL PROVIDER PROPERTY ==========
  describe('optional provider property', () => {
    it('uses the key name as provider when provider is omitted', async () => {
      await runner(async (service: Service) => {
        const conn = await (service as any).providers.connect('fake-db');
        expect(conn).toBe(fakeConnection);
      }, ctx([{ providers: { 'fake-db': { url: 'fake://host' } } }]));
    });

    it('throws with hint when provider is omitted and name does not match a registered provider', async () => {
      await expect(runner(() => {}, ctx([{
        providers: { mydb: { url: 'fake://host' } },
      }]))).rejects.toThrow('Did you forget to set the provider property?');
    });

    it('throws without hint when provider is explicitly set but unregistered', async () => {
      const error = await runner(() => {}, ctx([{
        providers: { mydb: { provider: 'nonexistent-driver', url: 'fake://host' } },
      }])).catch(e => e);

      expect(error.message).toContain('[Providers] Unknown provider "nonexistent-driver"');
      expect(error.message).not.toContain('Did you forget');
    });
  });
});
