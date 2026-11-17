// The default working pattern: the expectation that applies to somebody nobody assigned a shift.
//
// WHY THIS FILE IS PURE. Resolving the pattern means reading six settings, which is I/O and lives
// in the service. Deciding what those six values MEAN — whether they amount to a usable pattern at
// all, and whether it crosses midnight — is a rule, and a rule belongs where it can be tested
// without a database, beside the derivation core it feeds.
//
// WHAT THE ENGINE SEES. A pattern is handed to `deriveDay` as its `shift`, so steps 6–8 run
// unchanged: late, early leave, overtime and absence all work for an employee with no assignment.
// That is the entire point of 1b. The engine deliberately cannot tell a pattern from a real shift
// — the difference matters to the RECORD (`shiftId` stays null, because no shift document was
// involved), not to the arithmetic.
import { type EngineShift } from './derive-day';

/** The six settings, as the service reads them. Deliberately the raw values, unvalidated. */
export interface DefaultPatternSettings {
  enabled: boolean;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceInMinutes: number;
  graceOutMinutes: number;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutesOfDay = (time: string): number => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/**
 * The pattern these settings describe, or `null` for "no expectation" — in which case the
 * derivation falls back to reporting the times the devices recorded and nothing more.
 *
 * FOUR WAYS TO GET `null`, and all four are a refusal rather than a guess:
 *
 *   · switched off — the default, and the state this ships in;
 *   · a time that is not `HH:mm` — the setting's own schema refuses these on write, so a bad value
 *     can only come from a row written before the schema existed. It is not repaired here, because
 *     a pattern invented out of a malformed one would quietly make somebody late;
 *   · equal start and end — a zero-length day, which cannot be what anyone meant;
 *   · a negative number anywhere — likewise impossible to mean.
 *
 * `crossesMidnight` is INFERRED (`endTime < startTime`) rather than stored. A night pattern is
 * 22:00→06:00 and a day pattern is 09:00→17:00; there is no third reading, and a stored flag could
 * contradict the hours beside it. Note this is also why equal times are refused rather than
 * treated as a 24-hour day: 09:00→09:00 is far more likely to be a half-finished edit.
 */
export const patternFrom = (settings: DefaultPatternSettings): EngineShift | null => {
  if (!settings.enabled) return null;
  if (!TIME.test(settings.startTime) || !TIME.test(settings.endTime)) return null;
  const start = minutesOfDay(settings.startTime);
  const end = minutesOfDay(settings.endTime);
  if (start === end) return null;
  if (settings.breakMinutes < 0 || settings.graceInMinutes < 0 || settings.graceOutMinutes < 0) {
    return null;
  }
  return {
    startTime: settings.startTime,
    endTime: settings.endTime,
    crossesMidnight: end < start,
    breakMinutes: settings.breakMinutes,
    graceInMinutes: settings.graceInMinutes,
    graceOutMinutes: settings.graceOutMinutes,
  };
};
