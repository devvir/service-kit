import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('redis', () => {
  const mockClient = {
    connect:    vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };

  return { createClient: vi.fn().mockReturnValue(mockClient) };
});

import { createClient } from 'redis';
import { lookupProvider } from '../../../src/providers/registry';
import '../../../src/providers/cache/redis';

const { handler } = lookupProvider('redis')!;
const mockClient = () => (createClient as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value;

describe('Redis Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== REGISTRATION ==========
  it('self-registers as redis', () => {
    expect(handler).toBeDefined();
  });

  // ========== VALIDATE ==========
  describe('validate()', () => {
    it('accepts redis:// URLs', () => {
      expect(() => handler.validate({ provider: 'redis', url: 'redis://localhost:6379' })).not.toThrow();
    });

    it('accepts rediss:// (TLS) URLs', () => {
      expect(() => handler.validate({ provider: 'redis', url: 'rediss://localhost:6380' })).not.toThrow();
    });

    it('rejects non-redis URLs', () => {
      expect(() => handler.validate({ provider: 'redis', url: 'mongodb://localhost' }))
        .toThrow('[redis] Invalid URL');

      expect(() => handler.validate({ provider: 'redis', url: 'http://localhost' }))
        .toThrow('[redis] Invalid URL');
    });
  });

  // ========== CONNECT ==========
  describe('connect()', () => {
    it('creates a client with the given URL and connects', async () => {
      await handler.connect({ provider: 'redis', url: 'redis://localhost:6379' });

      expect(createClient).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
      expect(mockClient().connect).toHaveBeenCalledOnce();
    });

    it('returns the client instance as the connection', async () => {
      const connection = await handler.connect({ provider: 'redis', url: 'redis://localhost' });

      expect(connection).toBe(mockClient());
    });
  });

  // ========== DISCONNECT ==========
  describe('disconnect()', () => {
    it('calls disconnect() on the client', async () => {
      const client     = await handler.connect({ provider: 'redis', url: 'redis://localhost' });
      const savedMock  = mockClient();
      vi.clearAllMocks();

      await handler.disconnect(client);

      expect(savedMock.disconnect).toHaveBeenCalledOnce();
    });
  });

  // ========== RECONNECT ==========
  describe('reconnect()', () => {
    it('disconnects the old client and opens a new connection', async () => {
      const oldClient = await handler.connect({ provider: 'redis', url: 'redis://localhost' });
      vi.clearAllMocks();

      const newConnection = await handler.reconnect({ provider: 'redis', url: 'redis://localhost' }, oldClient);

      expect(mockClient().disconnect).toHaveBeenCalledOnce();
      expect(mockClient().connect).toHaveBeenCalledOnce();
      expect(newConnection).toBeDefined();
    });

    it('still connects even if disconnecting the old client fails', async () => {
      const oldClient  = await handler.connect({ provider: 'redis', url: 'redis://localhost' });
      const savedMock  = mockClient();
      savedMock.disconnect.mockRejectedValueOnce(new Error('already closed'));
      vi.clearAllMocks();

      const newConnection = await handler.reconnect({ provider: 'redis', url: 'redis://localhost' }, oldClient);

      expect(newConnection).toBeDefined();
    });
  });
});
