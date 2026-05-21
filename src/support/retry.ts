/**
 * Retry and backoff primitives shared across the kit — the `providers` plugin's
 * connect-with-retry and the `Net` plugin's clients and servers all build on
 * these, so capped exponential backoff is defined exactly once.
 */

export type RetryStrategy = 'linear' | 'exponential';

export interface RetryConfig {
  strategy:  RetryStrategy;
  delay:     number;
  maxDelay?: number;
  attempts?: number;
}

const defaultRetry: RetryConfig = {
  strategy: 'exponential',
  delay:    500,
  maxDelay: 30_000,
};

/**
 * Merge a partial retry config over the kit defaults.
 */
export function mergeRetryConfig(partial?: Partial<RetryConfig>): RetryConfig {
  return { ...defaultRetry, ...partial };
}

/**
 * A stateful backoff cursor. Each `next()` yields the delay for the next
 * attempt and advances; `reset()` returns to the floor after a success.
 *
 * Powers both the promise-retry loop (`withRetry`) and the event-driven
 * reconnection in the `Net` clients.
 */
export class Backoff {
  #config:  RetryConfig;
  #attempt = 0;

  constructor(config: RetryConfig) {
    this.#config = config;
  }

  /** Delay (ms) for the next attempt; advances the cursor. */
  next(): number {
    this.#attempt += 1;

    return computeDelay(this.#config, this.#attempt);
  }

  /** The delay the next `next()` would return, without advancing. */
  peek(): number {
    return computeDelay(this.#config, this.#attempt + 1);
  }

  /** Reset to the floor — call after a successful attempt. */
  reset(): void {
    this.#attempt = 0;
  }

  /**
   * Fast-forward so the next `next()` yields the cap — used after a rate-limit
   * response, where ramping up from the floor would be wrong. No-op for the
   * linear strategy (no ramp) or when no `maxDelay` is set.
   */
  toCap(): void {
    const max = this.#config.maxDelay;

    if (max === undefined || this.#config.strategy !== 'exponential') return;

    while (computeDelay(this.#config, this.#attempt + 1) < max) {
      this.#attempt += 1;
    }
  }
}

/**
 * Run `fn`, retrying on rejection with capped backoff. Stops and rethrows once
 * `config.attempts` is reached; retries forever when `attempts` is undefined.
 */
export async function withRetry<T>(
  fn:      () => Promise<T>,
  config:  RetryConfig,
  onRetry: (attempt: number, delay: number, err: unknown) => void,
): Promise<T> {
  const backoff = new Backoff(config);
  let   attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;

      if (config.attempts !== undefined && attempt >= config.attempts) {
        throw err;
      }

      const delay = backoff.next();

      onRetry(attempt, delay, err);
      await sleep(delay);
    }
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

/** Delay for `attempt` (1-based) under `config`, capped at `maxDelay`. */
function computeDelay(config: RetryConfig, attempt: number): number {
  const delay = config.strategy === 'exponential'
    ? config.delay * Math.pow(2, attempt - 1)
    : config.delay;

  return config.maxDelay !== undefined ? Math.min(delay, config.maxDelay) : delay;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
