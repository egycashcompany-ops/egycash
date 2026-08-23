// The ATM domain's business clock is Africa/Cairo — every legacy time rule is written against
// the Cairo wall clock (the day boundary the "today" grouping uses, the 06:00 force-date opening,
// the 06:00/16:00 shift windows the leader cascade selects by). Storage is real UTC instants,
// which is itself the port's one time normalization: the legacy replenishment path composed
// "now" as a Cairo-local string LABELED UTC (contad_app.js:644-650) while its close wrote a true
// UTC instant (:782) — the +3h display kludge in atm_replenishment_done.ejs:471-478 exists to
// bridge that. With honest instants the kludge dies (port doc quirk T1).
//
// Pure date arithmetic over Intl (the hr business-date technique) — modules cannot import hr's
// helpers and must not grow a timezone dependency for four functions.
const CAIRO_TZ = 'Africa/Cairo';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAIRO_TZ,
  timeZoneName: 'longOffset',
});

/** The zone's UTC offset in minutes at a given instant (Egypt has re-adopted DST). */
const cairoOffsetMinutes = (instant: Date): number => {
  const name =
    offsetFormatter.formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (match === null) return 0; // "GMT" exactly — offset zero
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
};

/** `YYYY-MM-DD` of the Cairo calendar day an instant falls on. */
export const cairoDateString = (instant: Date): string => dateFormatter.format(instant);

/**
 * The UTC instant of a Cairo wall-clock time `HH:00` on a calendar day (`YYYY-MM-DD`).
 * Resolved via the offset in force at that moment, so a DST edge day still lands on the wall
 * clock the rule names.
 */
export const cairoWallClockUtc = (dateString: string, hour: number): Date => {
  const [y, m, d] = dateString.split('-').map(Number) as [number, number, number];
  // First guess with the offset "now-ish" at that date, then correct once — the correction
  // converges because offsets are stable within a day except at the transition instant itself.
  const guess = new Date(Date.UTC(y, m - 1, d, hour));
  const corrected = new Date(guess.getTime() - cairoOffsetMinutes(guess) * 60_000);
  return new Date(guess.getTime() - cairoOffsetMinutes(corrected) * 60_000);
};

/**
 * Re-read an instant's UTC CLOCK FACE as a Cairo wall clock, and return the instant that really
 * was — the T1 repair, and the only reason it exists.
 *
 * The legacy replenishment create composed "now" from LOCAL date parts and stamped `+00:00` on it
 * (contad_app.js:644-650), so a row opened at 10:00 in Cairo is stored as 10:00Z — two or three
 * hours ahead of the instant it names. Reading those parts back as Cairo and converting gives the
 * true instant. Applied ONLY by the legacy importer, and only to the fields whose deployment is
 * known to have written them that way.
 */
export const reinterpretUtcPartsAsCairo = (stored: Date): Date => {
  const guess = new Date(stored.getTime() - cairoOffsetMinutes(stored) * 60_000);
  return new Date(stored.getTime() - cairoOffsetMinutes(guess) * 60_000);
};

/** [start, end) UTC instants of one Cairo calendar day. */
export const cairoDayRange = (dateString: string): { start: Date; end: Date } => {
  const start = cairoWallClockUtc(dateString, 0);
  const [y, m, d] = dateString.split('-').map(Number) as [number, number, number];
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const end = cairoWallClockUtc(nextDay.toISOString().slice(0, 10), 0);
  return { start, end };
};

/**
 * The shift window an operation's open time falls into — the exact selector of the legacy leader
 * cascade (contad_app.js:854-868 for replenishment, :2019-2032 for maintenance):
 *
 *   day shift    06:00 ≤ t < 16:00  →  [06:00, 16:00) of that Cairo day
 *   night shift  otherwise          →  [16:00 of that day, 06:00 of the next)
 *
 * The legacy computed this over its stored clock strings; over honest instants the same wall-
 * clock rule selects the same rows.
 */
export const cairoShiftWindow = (openedAt: Date): { start: Date; end: Date } => {
  const day = cairoDateString(openedAt);
  const shiftOneStart = cairoWallClockUtc(day, 6);
  const shiftTwoStart = cairoWallClockUtc(day, 16);
  if (
    openedAt.getTime() >= shiftOneStart.getTime() &&
    openedAt.getTime() < shiftTwoStart.getTime()
  ) {
    return { start: shiftOneStart, end: shiftTwoStart };
  }
  // Night shift: legacy anchors the window to the open time's OWN calendar day (16:00 that day →
  // 06:00 next), even for an open time before 06:00 — preserved verbatim (:815-817, :2008-2010).
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start: shiftTwoStart, end: cairoWallClockUtc(nextDay, 6) };
};
