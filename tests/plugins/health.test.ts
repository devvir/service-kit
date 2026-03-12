import { describe, it, expect, vi, beforeEach } from 'vitest';
import runner from '../../src/core/runner';
import healthPlugin from '../../src/plugins/health';
import shutdownPlugin from '../../src/plugins/shutdown';
import statePlugin from '../../src/plugins/state';
import type { Service } from '../../src';
import http from 'node:http';

describe('Health Plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== HEALTHCHECK PROPERTY ==========
  describe('healthcheck property', () => {
    it('adds healthcheck property to service', async () => {
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce(() => {
        const mockServer = {
          close: vi.fn(),
          listen: vi.fn(function() { return this; }),
        };
        return mockServer as any;
      });

      await runner((service: Service) => {
        expect((service as any).healthcheck).toBeDefined();
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [], bindings: [], plugins: [],
      });

      createServerSpy.mockRestore();
    });

    it('defaults healthcheck to true when not specified', async () => {
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce(() => {
        const mockServer = {
          close: vi.fn(),
          listen: vi.fn(function() { return this; }),
        };
        return mockServer as any;
      });

      await runner((service: Service) => {
        expect((service as any).healthcheck).toBe(true);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [], bindings: [], plugins: [],
      });

      createServerSpy.mockRestore();
    });

    it('preserves healthcheck from spec when set to true', async () => {
      const mockServer = {
        close: vi.fn(),
        listen: vi.fn(() => mockServer),
      };
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce(() => mockServer as any);

      await runner((service: Service) => {
        expect((service as any).healthcheck).toBe(true);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [{ healthcheck: true }],
        bindings: [],
        plugins: [],
      });

      createServerSpy.mockRestore();
    });

    it('preserves healthcheck from spec when set to false', async () => {
      await runner((service: Service) => {
        expect((service as any).healthcheck).toBe(false);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [{ healthcheck: false }],
        bindings: [],
        plugins: [],
      });
    });

    it('preserves healthcheck from spec when set to port number', async () => {
      const mockServer = {
        close: vi.fn(),
        listen: vi.fn(() => mockServer),
      };
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce(() => mockServer as any);

      await runner((service: Service) => {
        expect((service as any).healthcheck).toBe(44580);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [{ healthcheck: 44580 }],
        bindings: [],
        plugins: [],
      });

      createServerSpy.mockRestore();
    });

    it('preserves healthcheck from spec when set to config object', async () => {
      const mockServer = {
        close: vi.fn(),
        listen: vi.fn(() => mockServer),
      };
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce(() => mockServer as any);

      const config = { port: 44581, message: 'healthy' };
      await runner((service: Service) => {
        expect((service as any).healthcheck).toEqual(config);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [{ healthcheck: config }],
        bindings: [],
        plugins: [],
      });

      createServerSpy.mockRestore();
    });
  });

  // ========== SERVER INITIALIZATION ==========
  describe('server initialization', () => {
    it('starts server when healthcheck is not false', async () => {
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce((handler) => {
        const mockServer = {
          close: vi.fn(),
          listen: vi.fn(() => mockServer),
        };
        return mockServer as any;
      });

      await runner(() => {}, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [{ healthcheck: true }],
        bindings: [],
        plugins: [],
      });

      expect(createServerSpy).toHaveBeenCalled();
      createServerSpy.mockRestore();
    });

    it('skips server initialization when healthcheck is false', async () => {
      const createServerSpy = vi.spyOn(http, 'createServer');

      await runner(() => {}, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [{ healthcheck: false }],
        bindings: [],
        plugins: [],
      });

      expect(createServerSpy).not.toHaveBeenCalled();
      createServerSpy.mockRestore();
    });

    it('server listens on default port 3000', async () => {
      const mockServer = {
        close: vi.fn(),
        listen: vi.fn(function() { return this; }),
      };
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce(() => mockServer as any);

      await runner(() => {}, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [{ healthcheck: true }],
        bindings: [],
        plugins: [],
      });

      expect(mockServer.listen).toHaveBeenCalledWith(3000, expect.any(Function));
      createServerSpy.mockRestore();
    });

    it('server listens on custom port when specified as number', async () => {
      const mockServer = {
        close: vi.fn(),
        listen: vi.fn(function() { return this; }),
      };
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce(() => mockServer as any);

      await runner(() => {}, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [{ healthcheck: 5000 }],
        bindings: [],
        plugins: [],
      });

      expect(mockServer.listen).toHaveBeenCalledWith(5000, expect.any(Function));
      createServerSpy.mockRestore();
    });

    it('server listens on custom port from config object', async () => {
      const mockServer = {
        close: vi.fn(),
        listen: vi.fn(function() { return this; }),
      };
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce(() => mockServer as any);

      await runner(() => {}, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [{ healthcheck: { port: 7000 } }],
        bindings: [],
        plugins: [],
      });

      expect(mockServer.listen).toHaveBeenCalledWith(7000, expect.any(Function));
      createServerSpy.mockRestore();
    });

    it('server defaults to port 3000 when config object has no port', async () => {
      const mockServer = {
        close: vi.fn(),
        listen: vi.fn(function() { return this; }),
      };
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce(() => mockServer as any);

      await runner(() => {}, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [{ healthcheck: { message: 'ok' } }],
        bindings: [],
        plugins: [],
      });

      expect(mockServer.listen).toHaveBeenCalledWith(3000, expect.any(Function));
      createServerSpy.mockRestore();
    });
  });

  // ========== SERVER SHUTDOWN ==========
  describe('server shutdown', () => {
    it('closes server on shutdown event', async () => {
      const closeSpy = vi.fn();
      const createServerSpy = vi.spyOn(http, 'createServer');

      createServerSpy.mockImplementationOnce((handler) => {
        const mockServer = {
          close: closeSpy,
          listen: vi.fn(() => mockServer),
        };
        return mockServer as any;
      });

      await runner((service: Service) => {
        (service as any).shutdown();
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin, shutdownPlugin] },
        spec: [{ healthcheck: true }],
        bindings: [],
        plugins: [],
      });

      expect(closeSpy).toHaveBeenCalled();
      createServerSpy.mockRestore();
    });
  });

  // ========== HEALTHCHECK EVENTS ==========
  describe('healthCheck event handling', () => {
    it('emits healthCheck event if listeners exist', async () => {
      let capturedHandler: any = null;
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce((handler) => {
        capturedHandler = handler;
        const mockServer = {
          close: vi.fn(),
          listen: vi.fn(function() { return this; }),
        };
        return mockServer as any;
      });

      const healthCheckCalls: any[] = [];

      await runner((service: Service) => {
        service.on('healthCheck', (svc, res) => {
          healthCheckCalls.push(res);
        });

        // Simulate HTTP request after listener is registered
        if (capturedHandler) {
          const mockRes = { writeHead: vi.fn(), end: vi.fn() };
          capturedHandler!({} as any, mockRes as any);
        }
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [{ healthcheck: true }],
        bindings: [],
        plugins: [],
      });

      expect(healthCheckCalls.length).toBeGreaterThan(0);
      createServerSpy.mockRestore();
    });

    it('returns default JSON response when no healthCheck listeners', async () => {
      let capturedHandler: any = null;
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce((handler) => {
        capturedHandler = handler;
        const mockServer = {
          close: vi.fn(),
          listen: vi.fn(function() { return this; }),
        };
        return mockServer as any;
      });

      await runner(() => {
        // Simulate HTTP request with no listeners
        if (capturedHandler) {
          const mockRes = {
            writeHead: vi.fn(),
            end: vi.fn(),
          };
          capturedHandler!({} as any, mockRes as any);

          expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
            'Content-Type': 'application/json',
          });
          expect(mockRes.end).toHaveBeenCalledWith(
            JSON.stringify({ status: 'ok' })
          );
        }
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin] },
        spec: [{ healthcheck: true }],
        bindings: [],
        plugins: [],
      });

      createServerSpy.mockRestore();
    });
  });

  // ========== STATE.HEALTHY ==========
  describe('state.healthy tracking', () => {
    it('sets state.healthy to true when response status is 2xx', async () => {
      let capturedHandler: any = null;
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce((handler) => {
        capturedHandler = handler;
        return { close: vi.fn(), listen: vi.fn(function() { return this; }) } as any;
      });

      let service!: Service;

      await runner((svc: Service) => { service = svc; }, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin, statePlugin] },
        spec: [{ healthcheck: true }],
        bindings: [],
        plugins: [],
      });

      const mockRes: any = {
        statusCode: 200,
        writeHead: vi.fn((code: number) => { mockRes.statusCode = code; }),
        end: vi.fn(),
      };

      await capturedHandler({} as any, mockRes);

      expect((service as any).isHealthy()).toBe(true);
      createServerSpy.mockRestore();
    });

    it('sets state.healthy to false when response status is non-2xx', async () => {
      let capturedHandler: any = null;
      const createServerSpy = vi.spyOn(http, 'createServer').mockImplementationOnce((handler) => {
        capturedHandler = handler;
        return { close: vi.fn(), listen: vi.fn(function() { return this; }) } as any;
      });

      let service!: Service;

      await runner((svc: Service) => {
        service = svc;
        service.on('healthCheck', (_, res: any) => {
          res.writeHead(503);
          res.end(JSON.stringify({ status: 'error' }));
        });
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [healthPlugin, statePlugin] },
        spec: [{ healthcheck: true }],
        bindings: [],
        plugins: [],
      });

      const mockRes: any = {
        statusCode: 200,
        writeHead: vi.fn((code: number) => { mockRes.statusCode = code; }),
        end: vi.fn(),
      };

      await capturedHandler({} as any, mockRes);

      expect((service as any).isHealthy()).toBe(false);
      createServerSpy.mockRestore();
    });
  });
});
