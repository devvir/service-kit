import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('mongodb', () => {
  const MockMongoClient = vi.fn();

  MockMongoClient.prototype.connect    = vi.fn().mockResolvedValue(undefined);
  MockMongoClient.prototype.close      = vi.fn().mockResolvedValue(undefined);

  return { MongoClient: MockMongoClient };
});

import { MongoClient } from 'mongodb';
import { lookupProvider } from '../../../src/providers/registry';
import '../../../src/providers/database/mongodb';

const { handler } = lookupProvider('mongodb')!;

describe('MongoDB Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== REGISTRATION ==========
  it('self-registers as mongodb', () => {
    expect(handler).toBeDefined();
  });

  // ========== VALIDATE ==========
  describe('validate()', () => {
    it('accepts mongodb:// URLs', () => {
      expect(() => handler.validate({ provider: 'mongodb', url: 'mongodb://localhost:27017/db' })).not.toThrow();
    });

    it('accepts mongodb+srv:// URLs', () => {
      expect(() => handler.validate({ provider: 'mongodb', url: 'mongodb+srv://cluster.example.mongodb.net/db' })).not.toThrow();
    });

    it('rejects non-mongodb URLs', () => {
      expect(() => handler.validate({ provider: 'mongodb', url: 'http://localhost/db' }))
        .toThrow('[mongodb] Invalid URL');

      expect(() => handler.validate({ provider: 'mongodb', url: 'postgres://localhost/db' }))
        .toThrow('[mongodb] Invalid URL');
    });
  });

  // ========== CONNECT ==========
  describe('connect()', () => {
    it('creates a MongoClient with the given URL and connects', async () => {
      await handler.connect({ provider: 'mongodb', url: 'mongodb://localhost:27017' });

      expect(MongoClient).toHaveBeenCalledWith('mongodb://localhost:27017');
      expect(MongoClient.prototype.connect).toHaveBeenCalledOnce();
    });

    it('returns the MongoClient instance as the connection', async () => {
      const connection = await handler.connect({ provider: 'mongodb', url: 'mongodb://localhost' });

      expect(connection).toBeInstanceOf(MongoClient);
    });
  });

  // ========== DISCONNECT ==========
  describe('disconnect()', () => {
    it('calls close() on the client', async () => {
      const client = new MongoClient('mongodb://localhost');
      await handler.disconnect(client);
      expect(MongoClient.prototype.close).toHaveBeenCalledOnce();
    });
  });

  // ========== RECONNECT ==========
  describe('reconnect()', () => {
    it('closes the old client and opens a new connection', async () => {
      const oldClient = new MongoClient('mongodb://localhost');
      vi.clearAllMocks();

      const newConnection = await handler.reconnect({ provider: 'mongodb', url: 'mongodb://localhost' }, oldClient);

      expect(MongoClient.prototype.close).toHaveBeenCalledOnce();
      expect(MongoClient.prototype.connect).toHaveBeenCalledOnce();
      expect(newConnection).toBeInstanceOf(MongoClient);
    });

    it('still connects even if closing the old client fails', async () => {
      MongoClient.prototype.close.mockRejectedValueOnce(new Error('already closed'));

      const oldClient     = new MongoClient('mongodb://localhost');
      const newConnection = await handler.reconnect({ provider: 'mongodb', url: 'mongodb://localhost' }, oldClient);

      expect(newConnection).toBeInstanceOf(MongoClient);
    });
  });
});
