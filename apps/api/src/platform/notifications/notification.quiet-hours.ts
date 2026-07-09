// Quiet-hours window math (Sprint 3.3 plan §3c) — pure, unit-testable without Mongo.
// `start`/`end` are `HH:mm` interpreted in server time: the platform has no per-user
// timezone model (locale is language, not timezone) — the plan's own §3c note accepts
// this as the same simplification `User.locale` already carries everywhere else.
export interface QuietHoursWindow {
  enabled: boolean;
  start: string; // HH:mm
  end: string; // HH:mm
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * `null` when not deferred (channel may send now); otherwise the number of
 * milliseconds until the window ends (when the deferred delivery should retry).
 */
export const computeQuietHoursDeferralMs = (now: Date, window: QuietHoursWindow): number | null => {
  if (!window.enabled) return null;
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const startMinutes = toMinutes(window.start);
  const endMinutes = toMinutes(window.end);
  if (startMinutes === endMinutes) return null; // zero-width window — treat as disabled

  const wraps = startMinutes > endMinutes; // e.g. 22:00 → 07:00
  const inWindow = wraps
    ? nowMinutes >= startMinutes || nowMinutes < endMinutes
    : nowMinutes >= startMinutes && nowMinutes < endMinutes;
  if (!inWindow) return null;

  const minutesUntilEnd = nowMinutes < endMinutes ? endMinutes - nowMinutes : 24 * 60 - nowMinutes + endMinutes;
  return minutesUntilEnd * 60_000;
};
