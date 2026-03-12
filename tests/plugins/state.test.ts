import { describe, it, expect } from 'vitest';
import runner from '../../src/core/runner';
import statePlugin from '../../src/plugins/state';
import type { Context, Service } from '../../src';

describe('State Plugin', () => {

  // ========== INITIAL STATE ==========
  describe('initial state', () => {
    it('initializes empty state when spec.state is not provided', async () => {
      await runner((service: Service) => {
        const state = (service as any).state();
        expect(state).toEqual({});
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [], bindings: [], plugins: [],
      });
    });

    it('initializes state from spec.state', async () => {
      await runner((service: Service) => {
        const state = (service as any).state();
        expect(state).toEqual({ count: 0, name: 'test', active: true });
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { count: 0, name: 'test', active: true } }],
        bindings: [],
        plugins: [],
      });
    });

    it('throws if spec.state is not an object', async () => {
      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: 'invalid' }],
        bindings: [],
        plugins: [],
      };

      await expect(async () => {
        await runner(() => {}, context);
      }).rejects.toThrow('[State Plugin] Spec `state` must be an object');
    });

    it('throws if spec.state is a number', async () => {
      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: 42 }],
        bindings: [],
        plugins: [],
      };

      await expect(async () => {
        await runner(() => {}, context);
      }).rejects.toThrow('[State Plugin] Spec `state` must be an object');
    });
  });

  // ========== state() METHOD ==========
  describe('state() method', () => {
    it('returns copy of entire state when called without key', async () => {
      await runner((service: Service) => {
        const state1 = (service as any).state();
        const state2 = (service as any).state();

        expect(state1).toEqual({ count: 5, name: 'initial' });
        expect(state1).not.toBe(state2); // Different references
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { count: 5, name: 'initial' } }],
        bindings: [],
        plugins: [],
      });
    });

    it('mutations to returned state do not affect service state', async () => {
      await runner((service: Service) => {
        const state1 = (service as any).state();
        state1.count = 999;
        state1.newKey = 'added';

        const state2 = (service as any).state();
        expect(state2.count).toBe(5);
        expect(state2.newKey).toBeUndefined();
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { count: 5, name: 'initial' } }],
        bindings: [],
        plugins: [],
      });
    });

    it('state(key) returns value for existing key', async () => {
      await runner((service: Service) => {
        expect((service as any).state('count')).toBe(5);
        expect((service as any).state('name')).toBe('test');
        expect((service as any).state('active')).toBe(true);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { count: 5, name: 'test', active: true } }],
        bindings: [],
        plugins: [],
      });
    });

    it('state(key) returns undefined for missing key', async () => {
      await runner((service: Service) => {
        expect((service as any).state('nonexistent')).toBeUndefined();
        expect((service as any).state('missing')).toBeUndefined();
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { count: 5 } }],
        bindings: [],
        plugins: [],
      });
    });
  });

  // ========== setState() METHOD ==========
  describe('setState(key, value) method', () => {
    it('sets value for a key and persists across calls', async () => {
      await runner((service: Service) => {
        (service as any).setState('count', 10);
        expect((service as any).state('count')).toBe(10);

        (service as any).setState('name', 'updated');
        expect((service as any).state('name')).toBe('updated');

        // Previous state still there
        expect((service as any).state('count')).toBe(10);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { count: 0, name: 'initial' } }],
        bindings: [],
        plugins: [],
      });
    });

    it('can create new state keys', async () => {
      await runner((service: Service) => {
        (service as any).setState('newKey', 'new value');
        expect((service as any).state('newKey')).toBe('new value');

        const fullState = (service as any).state();
        expect(fullState.newKey).toBe('new value');
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: {} }],
        bindings: [],
        plugins: [],
      });
    });

    it('can set any type of value', async () => {
      await runner((service: Service) => {
        (service as any).setState('string', 'text');
        (service as any).setState('number', 42);
        (service as any).setState('boolean', true);
        (service as any).setState('null', null);
        (service as any).setState('object', { nested: 'value' });
        (service as any).setState('array', [1, 2, 3]);

        expect((service as any).state('string')).toBe('text');
        expect((service as any).state('number')).toBe(42);
        expect((service as any).state('boolean')).toBe(true);
        expect((service as any).state('null')).toBeNull();
        expect((service as any).state('object')).toEqual({ nested: 'value' });
        expect((service as any).state('array')).toEqual([1, 2, 3]);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: {} }],
        bindings: [],
        plugins: [],
      });
    });

    it('overwrites previous value', async () => {
      await runner((service: Service) => {
        (service as any).setState('count', 10);
        expect((service as any).state('count')).toBe(10);

        (service as any).setState('count', 20);
        expect((service as any).state('count')).toBe(20);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { count: 0 } }],
        bindings: [],
        plugins: [],
      });
    });
  });

  // ========== increment() METHOD ==========
  describe('increment(key) method', () => {
    it('increments numeric state', async () => {
      await runner((service: Service) => {
        (service as any).increment('count');
        expect((service as any).state('count')).toBe(6);

        (service as any).increment('count');
        expect((service as any).state('count')).toBe(7);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { count: 5 } }],
        bindings: [],
        plugins: [],
      });
    });

    it('creates value of 1 when key is undefined', async () => {
      await runner((service: Service) => {
        (service as any).increment('newCounter');
        expect((service as any).state('newCounter')).toBe(1);

        (service as any).increment('newCounter');
        expect((service as any).state('newCounter')).toBe(2);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: {} }],
        bindings: [],
        plugins: [],
      });
    });

    it('throws when trying to increment non-numeric value', async () => {
      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { text: 'not a number' } }],
        bindings: [],
        plugins: [],
      };

      await expect(async () => {
        await runner((service: Service) => {
          (service as any).increment('text');
        }, context);
      }).rejects.toThrow('[State Plugin] State "text" must be a number to use increment/decrement');
    });

    it('works with 0 and negative numbers', async () => {
      await runner((service: Service) => {
        (service as any).increment('zero');
        expect((service as any).state('zero')).toBe(1);

        (service as any).increment('negative');
        expect((service as any).state('negative')).toBe(-4); // -5 + 1 = -4
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { zero: 0, negative: -5 } }],
        bindings: [],
        plugins: [],
      });
    });
  });

  // ========== decrement() METHOD ==========
  describe('decrement(key) method', () => {
    it('decrements numeric state', async () => {
      await runner((service: Service) => {
        (service as any).decrement('count');
        expect((service as any).state('count')).toBe(4);

        (service as any).decrement('count');
        expect((service as any).state('count')).toBe(3);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { count: 5 } }],
        bindings: [],
        plugins: [],
      });
    });

    it('creates value of -1 when key is undefined', async () => {
      await runner((service: Service) => {
        (service as any).decrement('counter');
        expect((service as any).state('counter')).toBe(-1);

        (service as any).decrement('counter');
        expect((service as any).state('counter')).toBe(-2);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: {} }],
        bindings: [],
        plugins: [],
      });
    });

    it('throws when trying to decrement non-numeric value', async () => {
      const context: Context = {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { text: 'not a number' } }],
        bindings: [],
        plugins: [],
      };

      await expect(async () => {
        await runner((service: Service) => {
          (service as any).decrement('text');
        }, context);
      }).rejects.toThrow('[State Plugin] State "text" must be a number to use increment/decrement');
    });

    it('works with 0 and negative numbers', async () => {
      await runner((service: Service) => {
        (service as any).decrement('zero');
        expect((service as any).state('zero')).toBe(-1);

        (service as any).decrement('positive');
        expect((service as any).state('positive')).toBe(4);
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { zero: 0, positive: 5 } }],
        bindings: [],
        plugins: [],
      });
    });
  });

  // ========== STATE ISOLATION ==========
  describe('state isolation between services', () => {
    it('each service instance has independent state', async () => {
      let service1State: any;
      let service2State: any;

      await runner((service: Service) => {
        (service as any).setState('count', 10);
        service1State = (service as any).state();
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { count: 1 } }],
        bindings: [],
        plugins: [],
      });

      await runner((service: Service) => {
        (service as any).setState('count', 20);
        service2State = (service as any).state();
      }, {
        defaults: { spec: {}, bindings: {}, plugins: [statePlugin] },
        spec: [{ state: { count: 1 } }],
        bindings: [],
        plugins: [],
      });

      expect(service1State.count).toBe(10);
      expect(service2State.count).toBe(20);
    });
  });
});
