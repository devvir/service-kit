import { describe, it, expect, beforeEach } from 'vitest';
import Service from '../../src/core/service';
import * as registry from '../../src/core/registry';
import { SK_CONFIG, SK_STATE, SK_PROVIDERS } from '../../src/core/registry';
import type { Config } from '../../src';

function makeService(name: string, config?: Record<string, unknown>): Service {
  const cfg: Config = {
    spec:     { name, config: config ?? {} },
    bindings: {},
    plugins:  [],
  };

  return new Service(cfg);
}

beforeEach(() => {
  registry.clear();
});

describe('registry.add / registry.has / registry.get', () => {
  it('registers a service and retrieves it by name', () => {
    const svc = makeService('alpha');
    registry.add(svc);

    expect(registry.has('alpha')).toBe(true);
    expect(registry.get('alpha')).toBe(svc);
  });

  it('has() returns false for unknown service', () => {
    expect(registry.has('missing')).toBe(false);
  });

  it('get() throws for unknown service', () => {
    expect(() => registry.get('missing')).toThrow('[registry] Service "missing" is not registered');
  });

  it('add() throws when service has no name in spec', () => {
    const cfg: Config = { spec: {}, bindings: {}, plugins: [] };
    const svc = new Service(cfg);

    expect(() => registry.add(svc)).toThrow('[registry] Cannot register a service without a name in spec');
  });

  it('throws when registering a service with a name that is already taken', () => {
    const svc1 = makeService('alpha');
    const svc2 = makeService('alpha');

    registry.add(svc1);

    expect(() => registry.add(svc2)).toThrow('[registry] Service "alpha" is already registered');

    expect(registry.get('alpha')).toBe(svc1);
  });
});

describe('registry.get with member symbols', () => {
  it('SK_CONFIG returns service.config()', () => {
    const svc = makeService('beta', { port: 3000, debug: true });
    registry.add(svc);

    const cfg = registry.get('beta', SK_CONFIG);

    expect(cfg).toEqual({ port: 3000, debug: true });
  });

  it('SK_STATE calls service.state() if the plugin is present', () => {
    const svc = makeService('gamma');

    const fakeState = { count: 5 };
    (svc as any).state = () => fakeState;

    registry.add(svc);

    expect(registry.get('gamma', SK_STATE)).toBe(fakeState);
  });

  it('SK_STATE returns undefined when state plugin is not present', () => {
    const svc = makeService('delta');
    registry.add(svc);

    expect(registry.get('delta', SK_STATE)).toBeUndefined();
  });

  it('SK_PROVIDERS returns service.providers if the plugin is present', () => {
    const svc = makeService('epsilon');

    const fakeProviders = { get: () => undefined };
    (svc as any).providers = fakeProviders;

    registry.add(svc);

    expect(registry.get('epsilon', SK_PROVIDERS)).toBe(fakeProviders);
  });
});

describe('registry.clear', () => {
  it('removes all registered services', () => {
    registry.add(makeService('a'));
    registry.add(makeService('b'));

    registry.clear();

    expect(registry.has('a')).toBe(false);
    expect(registry.has('b')).toBe(false);
  });
});
