/**
 * Request-rate limiting for the `express` server kind. Two window modes:
 * fixed (the default) and rolling. Configured via the `rateLimit` spec option.
 */

import type { RequestHandler } from 'express';

export type RateLimit =
  | string
  | { max: number; unit: 'd' | 'h' | 'm' | 's'; rolling?: boolean };

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

interface Parsed {
  max:      number;
  windowMs: number;
  rolling:  boolean;
}

/** Parse the `rateLimit` spec — the `'<count>/<unit>'` string or the object form. */
export function parseRateLimit(spec: RateLimit): Parsed {
  if (typeof spec === 'string') {
    const match = spec.match(/^(\d+)\/([dhms])$/);

    if (! match) {
      throw new Error(`[net] invalid rateLimit "${spec}" — expected "<count>/<d|h|m|s>"`);
    }

    return { max: Number(match[1]), windowMs: UNIT_MS[match[2]!]!, rolling: false };
  }

  return { max: spec.max, windowMs: UNIT_MS[spec.unit]!, rolling: spec.rolling ?? false };
}

/** Build the rate-limit middleware for a `rateLimit` spec. */
export function rateLimitMiddleware(spec: RateLimit): RequestHandler {
  const { max, windowMs, rolling } = parseRateLimit(spec);

  return rolling ? rollingWindow(max, windowMs) : fixedWindow(max, windowMs);
}

// ── Window strategies ─────────────────────────────────────────────────────────

function fixedWindow(max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  prune(() => {
    const now = Date.now();

    for (const [ip, hit] of hits) if (hit.resetAt <= now) hits.delete(ip);
  }, windowMs);

  return (req, res, next): void => {
    const ip  = req.ip ?? 'unknown';
    const now = Date.now();

    let hit = hits.get(ip);

    if (! hit || hit.resetAt <= now) {
      hit = { count: 0, resetAt: now + windowMs };
      hits.set(ip, hit);
    }

    hit.count += 1;

    if (hit.count > max) {
      res.setHeader('Retry-After', Math.ceil((hit.resetAt - now) / 1_000));
      res.status(429).json({ error: 'Too many requests' });

      return;
    }

    next();
  };
}

function rollingWindow(max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, number[]>();

  prune(() => {
    const cutoff = Date.now() - windowMs;

    for (const [ip, times] of hits) {
      const kept = times.filter(t => t > cutoff);

      if (kept.length === 0) hits.delete(ip);
      else                   hits.set(ip, kept);
    }
  }, windowMs);

  return (req, res, next): void => {
    const ip     = req.ip ?? 'unknown';
    const cutoff = Date.now() - windowMs;
    const times  = (hits.get(ip) ?? []).filter(t => t > cutoff);

    if (times.length >= max) {
      res.status(429).json({ error: 'Too many requests' });

      return;
    }

    times.push(Date.now());
    hits.set(ip, times);

    next();
  };
}

/** Run `sweep` on an interval that never holds the process open. */
function prune(sweep: () => void, windowMs: number): void {
  const timer = setInterval(sweep, Math.max(windowMs, 60_000));

  timer.unref?.();
}
