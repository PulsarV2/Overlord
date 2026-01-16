import { logger } from "./logger";

interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
  lockedUntil?: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL = 60 * 1000;

export function isRateLimited(ip: string): {
  limited: boolean;
  retryAfter?: number;
} {
  const entry = rateLimitStore.get(ip);

  if (!entry) {
    return { limited: false };
  }

  const now = Date.now();

  if (entry.lockedUntil && entry.lockedUntil > now) {
    const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
    return { limited: true, retryAfter };
  }

  if (now - entry.firstAttempt > WINDOW_MS) {
    rateLimitStore.delete(ip);
    return { limited: false };
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
    const retryAfter = Math.ceil(LOCKOUT_MS / 1000);
    logger.warn(
      `[rate-limit] IP ${ip} locked out for ${retryAfter}s after ${entry.attempts} failed attempts`,
    );
    return { limited: true, retryAfter };
  }

  return { limited: false };
}

export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry) {
    rateLimitStore.set(ip, {
      attempts: 1,
      firstAttempt: now,
    });
    return;
  }

  if (now - entry.firstAttempt > WINDOW_MS) {
    rateLimitStore.set(ip, {
      attempts: 1,
      firstAttempt: now,
    });
    return;
  }

  entry.attempts++;
  logger.debug(
    `[rate-limit] IP ${ip} failed attempt ${entry.attempts}/${MAX_ATTEMPTS}`,
  );
}

export function recordSuccessfulAttempt(ip: string): void {
  rateLimitStore.delete(ip);
}

function cleanupExpired(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [ip, entry] of rateLimitStore.entries()) {
    const windowExpired = now - entry.firstAttempt > WINDOW_MS;
    const lockoutExpired = entry.lockedUntil && entry.lockedUntil < now;

    if ((windowExpired && !entry.lockedUntil) || lockoutExpired) {
      rateLimitStore.delete(ip);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug(`[rate-limit] Cleaned up ${cleaned} expired entries`);
  }
}

export function getRateLimitStats(): { total: number; locked: number } {
  const now = Date.now();
  let locked = 0;

  for (const entry of rateLimitStore.values()) {
    if (entry.lockedUntil && entry.lockedUntil > now) {
      locked++;
    }
  }

  return {
    total: rateLimitStore.size,
    locked,
  };
}

setInterval(cleanupExpired, CLEANUP_INTERVAL);

logger.info(
  `[rate-limit] Initialized: ${MAX_ATTEMPTS} attempts per ${WINDOW_MS / 60000} minutes, ${LOCKOUT_MS / 60000} minute lockout`,
);
