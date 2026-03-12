import { vi, describe, it, expect, afterEach } from 'vitest';
import SK, { type ServiceFn, type Plugin } from '../../src/';
import shutdown from '../../src/plugins/shutdown';

const mockRun = vi.hoisted(() => vi.fn());
vi.mock('../../src/core/runner', () => ({ default: mockRun }));

const serviceFn: ServiceFn = () => undefined;

function lastCallArg() {
  return mockRun.mock.calls.at(-1)?.[1];
}

// ============================================================================
// Bare run — nothing configured
// ============================================================================

it('bare SK.run() passes defaults and empty spec, bindings, plugins', () => {
  const original = SK.defaults;

  SK.defaults = {
    spec: { name: 'service', config: {} },
    bindings: {}, plugins: [ shutdown ],
  }

  SK.run(serviceFn);

  expect(lastCallArg()).toEqual({
    defaults: { spec: { name: 'service', config: {} }, bindings: {}, plugins: [ shutdown ] },
    spec:     [],
    bindings: [],
    plugins:  [],
  });

  SK.defaults = original;
});

// ============================================================================
// declare()
// ============================================================================

describe('declare()', () => {
  it('passes spec to run', () => {
    SK.create().declare({ name: 'my-service' }).run(serviceFn);

    expect(lastCallArg().spec).toEqual([{ name: 'my-service' }]);
  });

  it('multiple calls accumulate in order', () => {
    SK.create()
      .declare({ name: 'first'  })
      .declare({ name: 'second' })
      .run(serviceFn);

    expect(lastCallArg().spec).toEqual([{ name: 'first' }, { name: 'second' }]);
  });

  it('throws if a spec field value is a function', () => {
    expect(() => SK.create().declare({ handler: vi.fn() } as any))
      .toThrow('cannot be a function');
  });
});

// ============================================================================
// bind()
// ============================================================================

describe('bind()', () => {
  it('passes bindings to run', () => {
    const onInit = vi.fn();

    SK.create().bind({ onInit }).run(serviceFn);

    expect(lastCallArg().bindings).toEqual([{ onInit }]);
  });

  it('multiple calls accumulate as separate objects — no merging', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();

    SK.create().bind({ onInit: h1 }).bind({ onShutdown: h2 }).run(serviceFn);

    expect(lastCallArg().bindings).toEqual([{ onInit: h1 }, { onShutdown: h2 }]);
  });

  it('throws if a binding key does not match onEventName pattern', () => {
    expect(() => SK.create().bind({ init:        vi.fn() } as any)).toThrow('Invalid binding key');
    expect(() => SK.create().bind({ onlowercase: vi.fn() } as any)).toThrow('Invalid binding key');
    expect(() => SK.create().bind({ on:          vi.fn() } as any)).toThrow('Invalid binding key');
  });
});

// ============================================================================
// use()
// ============================================================================

describe('use()', () => {
  it('passes a single plugin to run', () => {
    const plugin: Plugin = {name: 'plugin'};

    SK.create().use(plugin).run(serviceFn);

    expect(lastCallArg().plugins).toContain(plugin);
  });

  it('accepts an array of plugins', () => {
    const p1: Plugin = { name: 'p1' };
    const p2: Plugin = { name: 'p2' };

    SK.create().use([p1, p2]).run(serviceFn);

    expect(lastCallArg().plugins).toEqual([p1, p2]);
  });

  it('multiple calls accumulate in order', () => {
    const p1: Plugin = { name: 'p1' };
    const p2: Plugin = { name: 'p2' };

    SK.create().use(p1).use(p2).run(serviceFn);

    expect(lastCallArg().plugins).toEqual([p1, p2]);
  });
});

// ============================================================================
// create()
// ============================================================================

it('create() with spec, bindings and plugins pre-configures a fresh instance', () => {
  const onInit = vi.fn();
  const plugin: Plugin = {name: 'plugin'};

  SK.create({ spec: { name: 'svc' }, bindings: { onInit }, plugins: [plugin] }).run(serviceFn);

  expect(lastCallArg().spec).toEqual([{ name: 'svc' }]);
  expect(lastCallArg().bindings).toEqual([{ onInit }]);
  expect(lastCallArg().plugins).toEqual([plugin]);
});

// ============================================================================
// defaults
// ============================================================================

describe('defaults', () => {
  let original: typeof SK.defaults;

  afterEach(() => {
    SK.defaults = original;
  });

  it('setter replaces defaults; getter reflects the change', () => {
    original = SK.defaults;

    SK.defaults = { spec: { name: 'custom', config: { port: 3000 } } };
    SK.create().run(serviceFn);

    expect(lastCallArg().defaults).toEqual({ spec: { name: 'custom', config: { port: 3000 } }, bindings: {}, plugins: [] });
    // note: getter normalizes missing keys — bindings and plugins default to {} and []
  });

  it('defaults and declared spec are passed separately to run', () => {
    original = SK.defaults;

    SK.defaults = { spec: { name: 'default-name' } };
    SK.create().declare({ name: 'explicit' }).run(serviceFn);

    expect(lastCallArg().defaults.spec?.name).toBe('default-name');
    expect(lastCallArg().spec).toEqual([{ name: 'explicit' }]);
  });

  it('getter returns a copy — mutating it does not affect internal state', () => {
    original = SK.defaults;

    (SK.defaults as any)['injected'] = true;
    SK.create().run(serviceFn);

    expect(lastCallArg().defaults).not.toHaveProperty('injected');
  });
});
