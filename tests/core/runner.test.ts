import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import runner from '../../src/core/runner';
import type { Context, Service, Plugin, Config } from '../../src';

describe('runner', () => {

  // ========== EVENT EMISSIONS ==========
  describe('service events', () => {
    it('emits started and complete events in order around serviceFn', async () => {
      const eventOrder: string[] = [];

      const onStarted = vi.fn(() => eventOrder.push('started'));
      const onComplete = vi.fn(() => eventOrder.push('complete'));
      const serviceFn = vi.fn(() => eventOrder.push('serviceFn'));

      const context: Context = {
        defaults: { spec: {}, bindings: { onStarted, onComplete }, plugins: [] },
        spec: [], bindings: [], plugins: [],
      };

      await runner(serviceFn, context);

      expect(eventOrder).toEqual(['started', 'serviceFn', 'complete']);
    });

    it('emits created event before listeners are registered (for plugins only)', async () => {
      const onCreated = vi.fn();
      const onStarted = vi.fn();
      const eventOrder: string[] = [];

      const serviceFn = vi.fn(() => eventOrder.push('serviceFn'));

      const context: Context = {
        defaults: { spec: {}, bindings: { onCreated, onStarted }, plugins: [] },
        spec: [], bindings: [], plugins: [],
      };

      await runner(serviceFn, context);

      // onCreated never called because created emitted before listeners registered
      expect(onCreated).not.toHaveBeenCalled();
      // onStarted called because started emitted after listeners registered
      expect(onStarted).toHaveBeenCalled();
    });
  });

  // ========== PLUGIN SIDE EFFECTS ==========
  describe('plugin initialization', () => {
    it('calls plugin.init() with service instance that extends EventEmitter', async () => {
      const pluginInit = vi.fn();
      const plugin: Plugin = {
        name: 'test-plugin',
        init: pluginInit,
      };

      const context: Context = {
        defaults: { spec: { name: 'default' }, bindings: {}, plugins: [] },
        spec: [{ name: 'custom' }],
        bindings: [],
        plugins: [plugin],
      };

      await runner(() => {}, context);

      expect(pluginInit).toHaveBeenCalledTimes(1);
      const serviceArg = pluginInit.mock.calls[0][0];
      expect(serviceArg).toBeInstanceOf(EventEmitter);
    });

    it('handles plugins without init() gracefully', async () => {
      const plugin: Plugin = {
        name: 'no-init-plugin',
        // no init method
        extends: () => ({ dummy: true }),
      };

      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [] },
        spec: [], bindings: [], plugins: [plugin],
      };

      await runner((service: Service) => {
        expect((service as any).dummy).toBe(true);
      }, context);
    });

    it('handles plugins without extends() gracefully', async () => {
      const pluginInit = vi.fn();
      const plugin: Plugin = {
        name: 'no-extends-plugin',
        init: pluginInit,
        // no extends method
      };

      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [] },
        spec: [], bindings: [], plugins: [plugin],
      };

      await runner(() => {}, context);

      expect(pluginInit).toHaveBeenCalled();
    });

    it('applies extends from multiple plugins to service', async () => {
      const method1 = vi.fn();
      const method2 = vi.fn();

      const plugin1: Plugin = {
        name: 'plugin-1',
        extends: () => ({ method1 }),
      };

      const plugin2: Plugin = {
        name: 'plugin-2',
        extends: () => ({ method2 }),
      };

      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [] },
        spec: [], bindings: [], plugins: [plugin1, plugin2],
      };

      await runner((service: Service) => {
        expect((service as any).method1).toBeDefined();
        expect((service as any).method2).toBeDefined();

        (service as any).method1();
        (service as any).method2();

        expect(method1).toHaveBeenCalled();
        expect(method2).toHaveBeenCalled();
      }, context);
    });

    it('deduplicates plugin by reference (same object only processed once)', async () => {
      const pluginInit = vi.fn();
      const plugin: Plugin = {
        name: 'shared-plugin',
        init: pluginInit,
      };

      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [plugin] },
        spec: [], bindings: [], plugins: [plugin], // Same plugin reference
      };

      await runner(() => {}, context);

      // init should only be called once even though plugin provided twice
      expect(pluginInit).toHaveBeenCalledTimes(1);
    });

    it('calls plugins in order: defaults first, then context', async () => {
      const callOrder: string[] = [];

      const plugin1: Plugin = {
        name: 'p1',
        init: () => callOrder.push('p1'),
      };

      const plugin2: Plugin = {
        name: 'p2',
        init: () => callOrder.push('p2'),
      };

      const plugin3: Plugin = {
        name: 'p3',
        init: () => callOrder.push('p3'),
      };

      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [plugin1, plugin2] },
        spec: [], bindings: [], plugins: [plugin3],
      };

      await runner(() => {
        expect(callOrder).toEqual(['p1', 'p2', 'p3']);
      }, context);
    });

    it('plugin.init() can register event listeners on service', async () => {
      const onStartedHandler = vi.fn();
      const onCompleteHandler = vi.fn();

      const plugin: Plugin = {
        name: 'listener-plugin',
        init: (service: Service) => {
          service.on('started', onStartedHandler);
          service.once('complete', onCompleteHandler);
        },
      };

      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [] },
        spec: [], bindings: [], plugins: [plugin],
      };

      await runner(() => {}, context);

      // Plugin should have registered listeners that were called
      expect(onStartedHandler).toHaveBeenCalledWith(expect.any(Object));
      expect(onCompleteHandler).toHaveBeenCalledWith(expect.any(Object));
    });

    it('extends receives merged config including all plugins', async () => {
      const extendsCallback = vi.fn(() => ({}));

      const plugin1: Plugin = {
        name: 'p1',
        extends: extendsCallback,
      };

      const plugin2: Plugin = {
        name: 'p2',
      };

      const context: Context = {
        defaults: { spec: { version: '1.0' }, bindings: {}, plugins: [] },
        spec: [{ env: 'test' }], bindings: [], plugins: [plugin1, plugin2],
      };

      await runner(() => {}, context);

      expect(extendsCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          spec: { version: '1.0', env: 'test' },
          plugins: [plugin1, plugin2],
        })
      );
    });

    it('plugin.init() receives service with access to config and spec', async () => {
      const pluginInit = vi.fn();

      const plugin: Plugin = {
        name: 'config-aware-plugin',
        init: pluginInit,
      };

      const context: Context = {
        defaults: { spec: { name: 'default', config: { apiUrl: 'http://localhost' } }, bindings: {}, plugins: [] },
        spec: [{ env: 'test' }],
        bindings: [],
        plugins: [plugin],
      };

      await runner((service: Service) => {
        // Plugin should have been initialized with service that can access spec and config
        expect(service.spec()).toEqual({ name: 'default', config: { apiUrl: 'http://localhost' }, env: 'test' });
        expect(service.config('apiUrl')).toBe('http://localhost');
      }, context);

      expect(pluginInit).toHaveBeenCalled();
    });
  });

  // ========== BINDINGS (EVENT LISTENER REGISTRATION) ==========
  describe('event listener binding', () => {
    it('registers onEventName handlers as event listeners', async () => {
      const onStarted = vi.fn();
      const onComplete = vi.fn();

      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [] },
        spec: [], bindings: [{ onStarted, onComplete }], plugins: [],
      };

      await runner(() => {
        // Handlers should have been called during runner execution
        expect(onStarted).toHaveBeenCalledWith(expect.any(Object)); // service instance
      }, context);

      // onComplete called after serviceFn
      expect(onComplete).toHaveBeenCalledWith(expect.any(Object));
    });

    it('passes service as first argument to event handlers', async () => {
      const onStarted = vi.fn();

      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [] },
        spec: [], bindings: [{ onStarted }], plugins: [],
      };

      let capturedService: Service | null = null;

      await runner((service: Service) => {
        capturedService = service;
      }, context);

      expect(onStarted).toHaveBeenCalledWith(capturedService);
    });

    it('extracts event name from binding key (onEventName → eventName)', async () => {
      const onCustomEvent = vi.fn();
      const onAnotherOne = vi.fn();

      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [] },
        spec: [], bindings: [{ onCustomEvent, onAnotherOne }], plugins: [],
      };

      await runner((service: Service) => {
        // Verify that onCustomEvent was registered as listener for 'customEvent'
        expect(service.hasListeners('customEvent')).toBe(true);
        expect(service.hasListeners('anotherOne')).toBe(true);
      }, context);
    });
  });

  // ========== SPEC/BINDINGS MERGING ==========
  describe('config merging', () => {
    it('merges defaults with context sources, context overrides defaults', async () => {
      const context: Context = {
        defaults: {
          spec: { name: 'default', version: '1.0' },
          bindings: {},
          plugins: []
        },
        spec: [{ name: 'override', extra: 'value' }],
        bindings: [],
        plugins: [],
      };

      await runner((service: Service) => {
        const spec = service.spec();
        expect(spec.name).toBe('override');      // overridden
        expect(spec.version).toBe('1.0');        // from defaults
        expect(spec.extra).toBe('value');        // from context
      }, context);
    });

    it('multiple spec sources merge left to right', async () => {
      const context: Context = {
        defaults: { spec: { a: 1 }, bindings: {}, plugins: [] },
        spec: [{ b: 2 }, { c: 3, a: 99 }],      // second overrides first
        bindings: [],
        plugins: [],
      };

      await runner((service: Service) => {
        const spec = service.spec();
        expect(spec).toEqual({ a: 99, b: 2, c: 3 });
      }, context);
    });

    it('plugins() getter returns array of plugin names', async () => {
      const p1: Plugin = { name: 'plugin-1' };
      const p2: Plugin = { name: 'plugin-2' };

      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [p1] },
        spec: [], bindings: [], plugins: [p2],
      };

      await runner((service: Service) => {
        expect(service.plugins()).toEqual(['plugin-1', 'plugin-2']);
      }, context);
    });

    it('bindings() getter returns merged bindings', async () => {
      const onFirst = vi.fn();
      const onSecond = vi.fn();

      const context: Context = {
        defaults: { spec: {}, bindings: { onFirst }, plugins: [] },
        spec: [], bindings: [{ onSecond }], plugins: [],
      };

      await runner((service: Service) => {
        const bindings = service.bindings();
        expect(bindings.onFirst).toBe(onFirst);
        expect(bindings.onSecond).toBe(onSecond);
      }, context);
    });
  });

  // ========== SERVICEFN EXECUTION ==========
  describe('serviceFn execution', () => {
    it('calls serviceFn with service instance that extends EventEmitter', async () => {
      const serviceFn = vi.fn();
      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [] },
        spec: [], bindings: [], plugins: [],
      };

      await runner(serviceFn, context);

      expect(serviceFn).toHaveBeenCalledTimes(1);
      const serviceArg = serviceFn.mock.calls[0][0];
      expect(serviceArg).toBeInstanceOf(EventEmitter);
    });

    it('awaits async serviceFn', async () => {
      const execOrder: string[] = [];

      const serviceFn = async () => {
        execOrder.push('serviceFn-start');
        await Promise.resolve();
        execOrder.push('serviceFn-end');
      };

      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [] },
        spec: [], bindings: [], plugins: [],
      };

      await runner(serviceFn, context);

      expect(execOrder).toEqual(['serviceFn-start', 'serviceFn-end']);
    });

    it('emits complete event after async serviceFn finishes', async () => {
      const onComplete = vi.fn();
      const serviceFn = async () => {
        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 10));
      };

      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [] },
        spec: [], bindings: [{ onComplete }], plugins: [],
      };

      await runner(serviceFn, context);

      expect(onComplete).toHaveBeenCalled();
    });
  });
});
