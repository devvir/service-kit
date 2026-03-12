import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import Service from '../../src/core/service';
import type { Config } from '../../src';

describe('Service', () => {

  describe('event listeners', () => {
    it('calls handler with service as first argument', () => {
      const handler = vi.fn();
      const config: Config = { spec: {}, bindings: {}, plugins: [] };
      const service = new Service(config);

      service.on('test', handler);
      service.emit('test');

      expect(handler).toHaveBeenCalledWith(service);
    });

    it('passes additional event arguments after service', () => {
      const handler = vi.fn();
      const config: Config = { spec: {}, bindings: {}, plugins: [] };
      const service = new Service(config);

      service.on('data', handler);
      service.emit('data', 'value1', 'value2');

      expect(handler).toHaveBeenCalledWith(service, 'value1', 'value2');
    });

    it('supports once() listener', () => {
      const handler = vi.fn();
      const config: Config = { spec: {}, bindings: {}, plugins: [] };
      const service = new Service(config);

      service.once('test', handler);
      service.emit('test');
      service.emit('test');

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('supports off() to remove listener', () => {
      const handler = vi.fn();
      const config: Config = { spec: {}, bindings: {}, plugins: [] };
      const service = new Service(config);

      service.on('test', handler);
      service.off('test', handler);
      service.emit('test');

      expect(handler).not.toHaveBeenCalled();
    });

    it('hasListeners() detects registered listeners', () => {
      const handler = vi.fn();
      const config: Config = { spec: {}, bindings: {}, plugins: [] };
      const service = new Service(config);

      expect(service.hasListeners('test')).toBe(false);

      service.on('test', handler);
      expect(service.hasListeners('test')).toBe(true);

      service.off('test', handler);
      expect(service.hasListeners('test')).toBe(false);
    });

    it('prependListener() adds listener at start of list', () => {
      const order: number[] = [];
      const h1 = () => order.push(1);
      const h2 = () => order.push(2);

      const config: Config = { spec: {}, bindings: {}, plugins: [] };
      const service = new Service(config);

      service.on('test', h1);
      service.prependListener('test', h2);
      service.emit('test');

      expect(order).toEqual([2, 1]);
    });

    it('prependOnceListener() adds one-time listener at start', () => {
      const handler = vi.fn();
      const config: Config = { spec: {}, bindings: {}, plugins: [] };
      const service = new Service(config);

      service.prependOnceListener('test', handler);
      service.emit('test');
      service.emit('test');

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('getters return shallow copies', () => {
    it('spec() returns independent copy', () => {
      const originalSpec = { name: 'service' };
      const config: Config = { spec: originalSpec, bindings: {}, plugins: [] };
      const service = new Service(config);

      const spec1 = service.spec();
      const spec2 = service.spec();

      expect(spec1).toEqual(spec2);
      expect(spec1).not.toBe(spec2); // Different object references

      // Mutating returned copy doesn't affect service
      (spec1 as any).name = 'modified';
      expect(service.spec().name).toBe('service');
    });

    it('bindings() returns independent copy', () => {
      const handler = vi.fn();
      const originalBindings = { onTest: handler };
      const config: Config = { spec: {}, bindings: originalBindings, plugins: [] };
      const service = new Service(config);

      const bindings = service.bindings();
      expect(bindings.onTest).toBe(handler);

      // Mutating returned copy doesn't affect service
      (bindings as any).onTest = vi.fn();
      expect(service.bindings().onTest).toBe(handler); // Original unchanged
    });

    it('plugins() returns independent array copy', () => {
      const config: Config = {
        spec: {},
        bindings: {},
        plugins: [{ name: 'p1' }, { name: 'p2' }]
      };
      const service = new Service(config);

      const plugins1 = service.plugins();
      const plugins2 = service.plugins();

      expect(plugins1).toEqual(plugins2);
      expect(plugins1).not.toBe(plugins2); // Different arrays

      plugins1.push('p3' as any);
      expect(service.plugins().length).toBe(2); // Original unchanged
    });
  });

  describe('config()', () => {
    it('returns entire config as shallow copy when called without key', () => {
      const config: Config = {
        spec: { config: { apiUrl: 'http://localhost', port: 3000 } },
        bindings: {},
        plugins: [],
      };
      const service = new Service(config);

      const cfg1 = service.config();
      const cfg2 = service.config();

      expect(cfg1).toEqual({ apiUrl: 'http://localhost', port: 3000 });
      expect(cfg1).not.toBe(cfg2); // Different object references

      // Mutating returned copy doesn't affect service
      cfg1.apiUrl = 'http://modified';
      expect(service.config().apiUrl).toBe('http://localhost');
    });

    it('returns value for specific key, or undefined if not found', () => {
      const config: Config = {
        spec: { config: { apiUrl: 'http://localhost', port: 3000, debug: true } },
        bindings: {},
        plugins: [],
      };
      const service = new Service(config);

      expect(service.config('apiUrl')).toBe('http://localhost');
      expect(service.config('port')).toBe(3000);
      expect(service.config('debug')).toBe(true);
      expect(service.config('nonexistent')).toBeUndefined();
    });
  });

  describe('inheritance and type safety', () => {
    it('extends EventEmitter', () => {
      const config: Config = { spec: {}, bindings: {}, plugins: [] };
      const service = new Service(config);

      expect(service).toBeInstanceOf(EventEmitter);
    });
  });
});
