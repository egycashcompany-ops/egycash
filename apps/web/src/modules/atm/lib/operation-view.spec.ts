import { describe, expect, it } from 'vitest';
import {
  cairoDay,
  elapsedSeconds,
  formatDuration,
  formatElapsed,
  isOpenedToday,
  timerLevel,
} from './operation-view';

describe('cairoDay / isOpenedToday — the two-group split', () => {
  it('groups by the Cairo calendar day, not the UTC day', () => {
    // 23:30 UTC on Jan 14 is 01:30 Cairo on Jan 15 (UTC+2).
    expect(cairoDay('2026-01-14T23:30:00.000Z')).toBe('2026-01-15');
  });

  it('a row opened on another day is carried-over', () => {
    const now = new Date('2026-01-15T10:00:00.000Z');
    expect(isOpenedToday('2026-01-15T05:00:00.000Z', now)).toBe(true);
    expect(isOpenedToday('2026-01-14T05:00:00.000Z', now)).toBe(false);
  });
});

describe('timer — the legacy colour ladder (atm_replenishment.ejs:1915-1921)', () => {
  it('counts whole seconds since open', () => {
    expect(elapsedSeconds('2026-01-15T10:00:00.000Z', new Date('2026-01-15T10:01:30.500Z'))).toBe(
      90,
    );
  });

  it('paints nothing before 1h, then green, yellow, crimson', () => {
    expect(timerLevel(3599)).toBe('none');
    expect(timerLevel(3600)).toBe('green');
    expect(timerLevel(2 * 3600)).toBe('yellow');
    expect(timerLevel(3 * 3600)).toBe('red');
  });

  it('renders 00h : 00m : 00s zero-padded', () => {
    expect(formatElapsed(3725)).toBe('01h : 02m : 05s');
  });
});

describe('formatDuration — the done pages, without the legacy +3h kludge', () => {
  it('is the plain close − open difference', () => {
    expect(formatDuration('2026-01-15T08:00:00.000Z', '2026-01-15T10:25:00.000Z')).toBe('2h : 25m');
  });
});
