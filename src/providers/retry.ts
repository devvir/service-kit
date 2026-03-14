import type { RetryConfig } from './types.js';

export const defaultRetry: RetryConfig = {
  strategy: 'exponential',
  delay:    500,
  maxDelay: 30_000,
};

export function mergeRetryConfig(partial?: Partial<RetryConfig>): RetryConfig {
  return { ...defaultRetry, ...partial };
}

export function computeDelay(config: RetryConfig, attempt: number): number {
  const d = config.strategy === 'exponential'
    ? config.delay * Math.pow(2, attempt - 1)
    : config.delay;

  return config.maxDelay !== undefined ? Math.min(d, config.maxDelay) : d;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  onRetry: (attempt: number, delay: number, err: unknown) => void,
): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;

      if (config.attempts !== undefined && attempt >= config.attempts) {
        throw err;
      }

      const delay = computeDelay(config, attempt);

      onRetry(attempt, delay, err);
      await sleep(delay);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
