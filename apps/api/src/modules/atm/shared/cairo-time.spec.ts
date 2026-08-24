import { describe, expect, it } from 'vitest';
import { cairoDateString, cairoDayRange, cairoShiftWindow, cairoWallClockUtc } from './cairo-time';

// Egypt is UTC+2 in winter and UTC+3 under DST (re-adopted 2023; last Friday of April → last
// Thursday of October). The fixtures below pin one date on each side.

describe('cairoWallClockUtc', () => {
  it('resolves 06:00 Cairo to 04:00 UTC in winter', () => {
    expect(cairoWallClockUtc('2026-01-15', 6).toISOString()).toBe('2026-01-15T04:00:00.000Z');
  });

  it('resolves 06:00 Cairo to 03:00 UTC under DST', () => {
    expect(cairoWallClockUtc('2026-07-15', 6).toISOString()).toBe('2026-07-15T03:00:00.000Z');
  });
});

describe('cairoDateString / cairoDayRange', () => {
  it('names the Cairo day, not the UTC day, near midnight', () => {
    // 23:30 UTC on the 14th is 01:30 Cairo on the 15th (winter, UTC+2).
    expect(cairoDateString(new Date('2026-01-14T23:30:00.000Z'))).toBe('2026-01-15');
  });

  it('spans exactly one Cairo day', () => {
    const { start, end } = cairoDayRange('2026-01-15');
    expect(start.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-15T22:00:00.000Z');
  });
});

describe('cairoShiftWindow — the leader-cascade selector (contad_app.js:854-868)', () => {
  it('an open time inside 06:00–16:00 selects the day-shift window of its day', () => {
    const openedAt = new Date('2026-01-15T08:00:00.000Z'); // 10:00 Cairo
    const { start, end } = cairoShiftWindow(openedAt);
    expect(start.toISOString()).toBe('2026-01-15T04:00:00.000Z'); // 06:00 Cairo
    expect(end.toISOString()).toBe('2026-01-15T14:00:00.000Z'); // 16:00 Cairo
  });

  it('an open time after 16:00 selects 16:00 that day → 06:00 the next', () => {
    const openedAt = new Date('2026-01-15T16:30:00.000Z'); // 18:30 Cairo
    const { start, end } = cairoShiftWindow(openedAt);
    expect(start.toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-16T04:00:00.000Z');
  });

  it('an open time before 06:00 anchors the night window to its OWN day — the legacy quirk', () => {
    // 03:00 Cairo on the 15th: legacy builds shift_two_start/end from the open date itself
    // (contad_app.js:815-817), i.e. 16:00 on the 15th → 06:00 on the 16th, a window that does
    // not contain the open time. Preserved verbatim.
    const openedAt = new Date('2026-01-15T01:00:00.000Z'); // 03:00 Cairo
    const { start, end } = cairoShiftWindow(openedAt);
    expect(start.toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-16T04:00:00.000Z');
  });
});
