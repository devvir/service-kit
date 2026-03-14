import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConn = vi.hoisted(() => ({ close: vi.fn().mockResolvedValue(undefined) }));

vi.mock('amqplib', () => ({
  default: { connect: vi.fn().mockResolvedValue(mockConn) },
}));

import amqp from 'amqplib';
import { lookupProvider } from '../../../src/providers/registry';
import '../../../src/providers/queue/rabbitmq';

const { handler } = lookupProvider('rabbitmq')!;
const mockConnect = amqp.connect as ReturnType<typeof vi.fn>;

describe('RabbitMQ Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== REGISTRATION ==========
  it('self-registers as rabbitmq', () => {
    expect(handler).toBeDefined();
  });

  // ========== VALIDATE ==========
  describe('validate()', () => {
    it('accepts amqp:// URLs', () => {
      expect(() => handler.validate({ provider: 'rabbitmq', url: 'amqp://guest:guest@localhost:5672' })).not.toThrow();
    });

    it('accepts amqps:// (TLS) URLs', () => {
      expect(() => handler.validate({ provider: 'rabbitmq', url: 'amqps://guest:guest@localhost:5671' })).not.toThrow();
    });

    it('rejects non-amqp URLs', () => {
      expect(() => handler.validate({ provider: 'rabbitmq', url: 'redis://localhost' }))
        .toThrow('[rabbitmq] Invalid URL');

      expect(() => handler.validate({ provider: 'rabbitmq', url: 'http://localhost' }))
        .toThrow('[rabbitmq] Invalid URL');
    });
  });

  // ========== CONNECT ==========
  describe('connect()', () => {
    it('calls amqp.connect with the given URL', async () => {
      await handler.connect({ provider: 'rabbitmq', url: 'amqp://localhost' });

      expect(mockConnect).toHaveBeenCalledWith('amqp://localhost');
    });

    it('returns the connection object', async () => {
      const connection = await handler.connect({ provider: 'rabbitmq', url: 'amqp://localhost' });

      expect(connection).toBe(mockConn);
    });
  });

  // ========== DISCONNECT ==========
  describe('disconnect()', () => {
    it('calls close() on the connection', async () => {
      const connection = await handler.connect({ provider: 'rabbitmq', url: 'amqp://localhost' });
      vi.clearAllMocks();

      await handler.disconnect(connection);

      expect(mockConn.close).toHaveBeenCalledOnce();
    });
  });

  // ========== RECONNECT ==========
  describe('reconnect()', () => {
    it('closes the old connection and opens a new one', async () => {
      const old = await handler.connect({ provider: 'rabbitmq', url: 'amqp://localhost' });
      vi.clearAllMocks();

      const newConnection = await handler.reconnect({ provider: 'rabbitmq', url: 'amqp://localhost' }, old);

      expect(mockConn.close).toHaveBeenCalledOnce();
      expect(mockConnect).toHaveBeenCalledOnce();
      expect(newConnection).toBeDefined();
    });

    it('still connects even if closing the old connection fails', async () => {
      const old = await handler.connect({ provider: 'rabbitmq', url: 'amqp://localhost' });
      mockConn.close.mockRejectedValueOnce(new Error('already closed'));
      vi.clearAllMocks();

      const newConnection = await handler.reconnect({ provider: 'rabbitmq', url: 'amqp://localhost' }, old);

      expect(newConnection).toBeDefined();
    });
  });
});
