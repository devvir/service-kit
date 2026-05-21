import { describe, it, expect } from 'vitest';
import { createCollection, type CollectionDeps } from '../../src/net/collection';
import { registerServer, registerClient, lookupServer, lookupClient } from '../../src/net/registry';
import type { NetSpec, NetHandle, NetHandler } from '../../src/net/types';

// ── Mock kind ─────────────────────────────────────────────────────────────────

interface MockHandle extends NetHandle {
  spec:    NetSpec;
  stopped: boolean;
  removed: boolean;
  dispose(): void;
}

const mockHandler = (validate: (spec: NetSpec) => void = () => {}): NetHandler => ({
  validate,
  create: (spec, _service, remove) => {
    const handle: MockHandle = {
      spec,
      stopped: false,
      removed: false,
      stop()    { handle.stopped = true; },
      dispose() { handle.stopped = true; handle.removed = true; remove(); },
    };

    return handle;
  },
});

const deps = (handler: NetHandler): CollectionDeps<NetSpec, NetHandle> => ({
  label:   'server',
  lookup:  (kind) => (kind === 'mock' ? handler : undefined),
  kindOf:  () => 'mock',
  service: {} as never,
});

// ── createCollection ──────────────────────────────────────────────────────────

describe('createCollection', () => {
  it('instantiates declared (non-template) entries at boot', () => {
    const coll = createCollection(deps(mockHandler()), [
      { name: 'a', type: 'mock' },
      { name: 'b', type: 'mock' },
    ]);

    expect(coll.has('a')).toBe(true);
    expect(coll.all()).toHaveLength(2);
    expect((coll.get('a') as MockHandle).spec.name).toBe('a');
  });

  it('defaults name to type', () => {
    const coll = createCollection(deps(mockHandler()), [{ type: 'mock' }]);

    expect(coll.has('mock')).toBe(true);
  });

  it('throws on a duplicate name', () => {
    expect(() => createCollection(deps(mockHandler()), [
      { name: 'x', type: 'mock' },
      { name: 'x', type: 'mock' },
    ])).toThrow(/duplicate/);
  });

  it('throws on an unknown kind', () => {
    expect(() => createCollection(deps(mockHandler()), [{ type: 'nope' }]))
      .toThrow(/unknown server kind/);
  });

  it('runs handler.validate at boot and fails fast', () => {
    const handler = mockHandler(() => { throw new Error('bad spec'); });

    expect(() => createCollection(deps(handler), [{ type: 'mock' }])).toThrow('bad spec');
  });

  it('get() with no name returns the sole instance', () => {
    const coll = createCollection(deps(mockHandler()), [{ name: 'only', type: 'mock' }]);

    expect((coll.get() as MockHandle).spec.name).toBe('only');
  });

  it('get() with no name throws when ambiguous', () => {
    const coll = createCollection(deps(mockHandler()), [
      { name: 'a', type: 'mock' },
      { name: 'b', type: 'mock' },
    ]);

    expect(() => coll.get()).toThrow(/ambiguous/);
  });

  it('get() throws for an unknown name', () => {
    const coll = createCollection(deps(mockHandler()), []);

    expect(() => coll.get('ghost')).toThrow(/no server named/);
  });

  it('create() builds a runtime instance and auto-names collisions', () => {
    const coll = createCollection(deps(mockHandler()), [{ name: 'mock', type: 'mock' }]);

    expect((coll.create('mock') as MockHandle).spec.name).toBe('mock#2');
    expect((coll.create('mock') as MockHandle).spec.name).toBe('mock#3');
  });

  it('does not instantiate a template entry', () => {
    const coll = createCollection(deps(mockHandler()), [
      { name: 'tmpl', type: 'mock', template: true },
    ]);

    expect(coll.all()).toHaveLength(0);
    expect(coll.has('tmpl')).toBe(false);
    expect(() => coll.get('tmpl')).toThrow(/is a template/);
  });

  it('clone() instantiates from a template, merging overrides', () => {
    const coll = createCollection(deps(mockHandler()), [
      { name: 'tmpl', type: 'mock', template: true, shared: 'yes' },
    ]);

    const inst = coll.clone('tmpl', { name: 'inst', extra: 1 }) as MockHandle;

    expect(inst.spec.name).toBe('inst');
    expect(inst.spec.shared).toBe('yes');
    expect(inst.spec.extra).toBe(1);
    expect(inst.spec.template).toBeUndefined();
  });

  it('clone() auto-names from the template when no name override is given', () => {
    const coll = createCollection(deps(mockHandler()), [
      { name: 'tmpl', type: 'mock', template: true },
    ]);

    expect((coll.clone('tmpl') as MockHandle).spec.name).toBe('tmpl#2');
    expect((coll.clone('tmpl') as MockHandle).spec.name).toBe('tmpl#3');
  });

  it('clone() of a non-template name throws', () => {
    const coll = createCollection(deps(mockHandler()), [{ name: 'live', type: 'mock' }]);

    expect(() => coll.clone('live')).toThrow(/not a template/);
  });

  it('stopAll() stops every live instance', async () => {
    const coll = createCollection(deps(mockHandler()), [
      { name: 'a', type: 'mock' },
      { name: 'b', type: 'mock' },
    ]);

    const a = coll.get('a') as MockHandle;
    const b = coll.get('b') as MockHandle;

    await coll.stopAll();

    expect(a.stopped).toBe(true);
    expect(b.stopped).toBe(true);
  });

  it('a handle can remove itself from the collection', () => {
    const coll = createCollection(deps(mockHandler()), [{ name: 'a', type: 'mock' }]);

    const a = coll.get('a') as MockHandle;

    a.dispose();

    expect(a.removed).toBe(true);
    expect(coll.has('a')).toBe(false);
    expect(coll.all()).toHaveLength(0);
  });
});

// ── registry ──────────────────────────────────────────────────────────────────

describe('registry', () => {
  it('registers and looks up server and client kinds independently', () => {
    const handler = mockHandler();

    registerServer('net-test-srv', handler);
    registerClient('net-test-cli', handler);

    expect(lookupServer('net-test-srv')).toBe(handler);
    expect(lookupClient('net-test-cli')).toBe(handler);
    expect(lookupServer('net-test-cli')).toBeUndefined();
    expect(lookupClient('net-test-srv')).toBeUndefined();
  });
});
