import { describe, it, expect, vi, beforeEach } from 'vitest';
import runner from '../../src/core/runner';
import shutdownPlugin, { __test__ } from '../../src/plugins/shutdown';
import type { Service } from '../../src';

describe('Shutdown Plugin', () => {
  beforeEach(() => {
    __test__.reset();
  });

  // ========== shutdown() METHOD ==========
  describe('shutdown() method', () => {
    it('adds shutdown() method to service', async () => {
      await runner((service: Service) => {
        expect(typeof (service as any).shutdown).toBe('function');
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [shutdownPlugin] },
        spec: [], bindings: [], plugins: [],
      });
    });

    it('emits shutdown and shutdownComplete events in order', async () => {
      const eventOrder: string[] = [];

      await runner(async (service: Service) => {
        service.on('shutdown', () => eventOrder.push('shutdown'));
        service.on('shutdownComplete', () => eventOrder.push('shutdownComplete'));

        await (service as any).shutdown('test-reason');

        expect(eventOrder).toEqual(['shutdown', 'shutdownComplete']);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [shutdownPlugin] },
        spec: [], bindings: [], plugins: [],
      });
    });

    it('passes signal reason to both shutdown and shutdownComplete events', async () => {
      const signals: string[] = [];

      await runner(async (service: Service) => {
        service.on('shutdown', (svc, signal) => signals.push(`shutdown:${signal}`));
        service.on('shutdownComplete', (svc, signal) => signals.push(`complete:${signal}`));

        await (service as any).shutdown('custom-signal');

        expect(signals).toEqual(['shutdown:custom-signal', 'complete:custom-signal']);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [shutdownPlugin] },
        spec: [], bindings: [], plugins: [],
      });
    });

    it('uses MANUAL as default signal when none provided', async () => {
      const signals: string[] = [];

      await runner((service: Service) => {
        service.on('shutdown', (svc, signal) => signals.push(signal));

        (service as any).shutdown();

        expect(signals).toEqual(['MANUAL']);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [shutdownPlugin] },
        spec: [], bindings: [], plugins: [],
      });
    });
  });

  // ========== PROCESS SIGNALS ==========
  describe('process signal handlers', () => {
    it('registers handlers for SIGTERM and SIGINT during init', async () => {
      const processOnceSpy = vi.spyOn(process, 'once');

      await runner(() => {}, {
        defaults: { spec: {}, bindings: {}, plugins: [shutdownPlugin] },
        spec: [], bindings: [], plugins: [],
      });

      expect(processOnceSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(processOnceSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));

      processOnceSpy.mockRestore();
    });

    it('SIGTERM handler emits shutdown event with SIGTERM signal', async () => {
      const signals: string[] = [];

      const processOnceSpy = vi.spyOn(process, 'once');
      let sigTermHandler: (() => void) | null = null;

      processOnceSpy.mockImplementation((event: string, handler: any) => {
        if (event === 'SIGTERM') {
          sigTermHandler = handler;
        }
        return process;
      });

      await runner((service: Service) => {
        service.on('shutdown', (svc, signal) => signals.push(signal));

        if (sigTermHandler) {
          sigTermHandler();
          expect(signals).toContain('SIGTERM');
        }
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [shutdownPlugin] },
        spec: [], bindings: [], plugins: [],
      });

      processOnceSpy.mockRestore();
    });

    it('SIGINT handler emits shutdown event with SIGINT signal', async () => {
      const signals: string[] = [];

      const processOnceSpy = vi.spyOn(process, 'once');
      let sigIntHandler: (() => void) | null = null;

      processOnceSpy.mockImplementation((event: string, handler: any) => {
        if (event === 'SIGINT') {
          sigIntHandler = handler;
        }
        return process;
      });

      await runner((service: Service) => {
        service.on('shutdown', (svc, signal) => signals.push(signal));

        if (sigIntHandler) {
          sigIntHandler();
          expect(signals).toContain('SIGINT');
        }
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [shutdownPlugin] },
        spec: [], bindings: [], plugins: [],
      });

      processOnceSpy.mockRestore();
    });
  });

  // ========== EVENT LISTENERS ==========
  describe('shutdown event listeners', () => {
    it('allows multiple listeners to listen for shutdown event', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      await runner((service: Service) => {
        service.on('shutdown', listener1);
        service.on('shutdown', listener2);

        (service as any).shutdown('test');

        expect(listener1).toHaveBeenCalledWith(service, 'test');
        expect(listener2).toHaveBeenCalledWith(service, 'test');
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [shutdownPlugin] },
        spec: [], bindings: [], plugins: [],
      });
    });

    it('allows listeners for both shutdown and shutdownComplete', async () => {
      const shutdownListener = vi.fn();
      const completeListener = vi.fn();

      await runner(async (service: Service) => {
        service.on('shutdown', shutdownListener);
        service.on('shutdownComplete', completeListener);

        await (service as any).shutdown('graceful');

        expect(shutdownListener).toHaveBeenCalledWith(service, 'graceful');
        expect(completeListener).toHaveBeenCalledWith(service, 'graceful');
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [shutdownPlugin] },
        spec: [], bindings: [], plugins: [],
      });
    });
  });
});
