// Expiration + scheduling math (Sprint 3.3 plan §2c/§2d) — pure, unit-testable.

/** Caller-supplied `expiresAt` wins; otherwise the template's declared default; else none. */
export const resolveExpiresAt = (
  callerExpiresAt: Date | undefined,
  templateDefaultExpiryHours: number | null,
  now: Date,
): Date | null => {
  if (callerExpiresAt !== undefined) return callerExpiresAt;
  if (templateDefaultExpiryHours === null) return null;
  return new Date(now.getTime() + templateDefaultExpiryHours * 60 * 60 * 1000);
};

export const isExpired = (expiresAt: Date | null, now: Date): boolean =>
  expiresAt !== null && expiresAt <= now;

/** Clamped to 0 — a `sendAt` already in the past sends immediately (send-now path, §2c). */
export const computeScheduleDelayMs = (sendAt: Date, now: Date): number =>
  Math.max(0, sendAt.getTime() - now.getTime());
