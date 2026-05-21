import { describe, it, expect, vi } from 'vitest';
import { Backoff, withRetry, mergeRetryConfig, type RetryConfig } from '../../src/support/retry';

// ── Backoff ───────────────────────────────────────────────────────────────────

describe('Backoff', () => {
  it('yields capped exponential delays', () => {
    const backoff = new Backoff({ strategy: 'exponential', delay: 100, maxDelay: 800 });

    expect(backoff.next()).toBe(100);
    expect(backoff.next()).toBe(200);
    expect(backoff.next()).toBe(400);
    expect(backoff.next()).toBe(800);
    expect(backoff.next()).toBe(800);  // capped
  });

  it('yields a constant delay for the linear strategy', () => {
    const backoff = new Backoff({ strategy: 'linear', delay: 250 });

    expect(backoff.next()).toBe(250);
    expect(backoff.next()).toBe(250);
  });

  it('peek() reports the next delay without advancing', () => {
    const backoff = new Backoff({ strategy: 'exponential', delay: 100 });

    expect(backoff.peek()).toBe(100);
    expect(backoff.peek()).toBe(100);
    expect(backoff.next()).toBe(100);
    expect(backoff.peek()).toBe(200);
  });

  it('reset() returns the cursor to the floor', () => {
    const backoff = new Backoff({ strategy: 'exponential', delay: 100 });

    backoff.next();
    backoff.next();
    backoff.reset();

    expect(backoff.next()).toBe(100);
  });
});

// ── mergeRetryConfig ──────────────────────────────────────────────────────────

describe('mergeRetryConfig', () => {
  it('returns the defaults when given nothing', () => {
    expect(mergeRetryConfig()).toEqual({ strategy: 'exponential', delay: 500, maxDelay: 30_000 });
  });

  it('overlays a partial config on the defaults', () => {
    expect(mergeRetryConfig({ delay: 100, attempts: 3 })).toEqual({
      strategy: 'exponential',
      delay:    100,
      maxDelay: 30_000,
      attempts: 3,
    });
  });
});

// ── withRetry ─────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  const fast: RetryConfig = { strategy: 'linear', delay: 1 };

  it('returns the result without retrying on first success', async () => {
    const onRetry = vi.fn();
    const result  = await withRetry(async () => 'ok', fast, onRetry);

    expect(result).toBe('ok');
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries until the call succeeds', async () => {
    const onRetry = vi.fn();
    let   calls   = 0;

    const result = await withRetry(async () => {
      calls += 1;

      if (calls < 3) throw new Error('fail');

      return 'ok';
    }, fast, onRetry);

    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('stops and rethrows once the attempt cap is reached', async () => {
    const onRetry = vi.fn();

    await expect(
      withRetry(async () => { throw new Error('always'); }, { ...fast, attempts: 3 }, onRetry),
    ).rejects.toThrow('always');

    expect(onRetry).toHaveBeenCalledTimes(2);  // attempts 1 and 2 retried; attempt 3 rethrows
  });
});
