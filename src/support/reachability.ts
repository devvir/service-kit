/**
 * Clean, noiseless logging for outbound connections — used by the `Net`
 * clients. Logs the *transitions* (unreachable / recovered) once each, with a
 * low-rate reminder while a long outage persists, instead of a line per retry.
 */

import type { Logger } from 'pino';

const REMINDER_INTERVAL_MS = 60_000;

/** Node socket error codes that are routine and expected. */
const KNOWN_NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN',
  'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE',
]);

/**
 * Per-connection reachability tracker. `down()` logs once on the healthy→down
 * transition and starts a ~1/min reminder; `up()` logs once on recovery and
 * clears it. Repeated `down()` calls while already down are silent.
 */
export class Reachability {
  #logger:   Logger;
  #label:    string;
  #down      = false;
  #since     = 0;
  #reminder: NodeJS.Timeout | null = null;

  constructor(logger: Logger, label: string) {
    this.#logger = logger;
    this.#label  = label;
  }

  /** Report a failed attempt; logs once on the healthy→down transition. */
  down(detail?: string): void {
    if (this.#down) return;

    this.#down  = true;
    this.#since = Date.now();

    this.#logger.warn(`[net] ${this.#label} unreachable — retrying${detail ? ` (${detail})` : ''}`);

    this.#reminder = setInterval(() => {
      const mins = Math.max(1, Math.round((Date.now() - this.#since) / 60_000));

      this.#logger.warn(`[net] ${this.#label} still unreachable — down for ~${mins}m`);
    }, REMINDER_INTERVAL_MS);

    this.#reminder.unref?.();
  }

  /** Report a success; logs once on the down→healthy transition. */
  up(): void {
    if (! this.#down) return;

    this.#down = false;

    this.#clearReminder();
    this.#logger.info(`[net] ${this.#label} recovered`);
  }

  /** Stop the reminder without logging — for teardown. */
  dispose(): void {
    this.#clearReminder();
    this.#down = false;
  }

  #clearReminder(): void {
    if (this.#reminder) {
      clearInterval(this.#reminder);
      this.#reminder = null;
    }
  }
}

/**
 * Describe a connection error concisely: a short phrase for known/expected
 * failures, otherwise the message. Strips the stack and surfaces `.cause.code`.
 */
export function describeError(err: unknown): string {
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string } };

  if (e?.name === 'AbortError') return 'timed out';

  const code = e?.code ?? e?.cause?.code;

  if (code && KNOWN_NETWORK_CODES.has(code)) return `network unavailable (${code})`;

  const message = e?.message ?? String(err);

  const httpStatus = message.match(/Unexpected server response: (\d+)/);

  if (httpStatus) return `server returned HTTP ${httpStatus[1]}`;

  if (/socket hang up/i.test(message)) return 'socket hang up';

  return code ? `${code}: ${message}` : message;
}
