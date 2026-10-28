import { describe, expect, it } from 'vitest';
import {
  cairoDay,
  actionTargets,
  doneRange,
  elapsedSeconds,
  formatDuration,
  formatElapsed,
  timerLevel,
} from './operation-view';

describe('cairoDay — the day a board shows a row on', () => {
  it('is the Cairo calendar day, not the UTC day', () => {
    // 23:30 UTC on Jan 14 is 01:30 Cairo on Jan 15 (UTC+2).
    expect(cairoDay('2026-01-14T23:30:00.000Z')).toBe('2026-01-15');
  });
});

describe('actionTargets — a row’s own button, over the checked rows', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const c = { id: 'c' };
  it('on a checked row, acts on every checked row', () => {
    expect(actionTargets(b, [a, b])).toEqual([a, b]);
  });
  it('on an unchecked row, acts on that row alone — the selection is not swept in', () => {
    expect(actionTargets(c, [a, b])).toEqual([c]);
    expect(actionTargets(c, [])).toEqual([c]);
  });
});

describe('doneRange — the done pages’ period, from their URL', () => {
  const today = '2026-10-27';
  it('is today with no bound, and one bound serves as both — the server’s ladder', () => {
    expect(doneRange(null, null, today)).toEqual({ from: today, to: today });
    expect(doneRange('2026-10-20', null, today)).toEqual({ from: '2026-10-20', to: '2026-10-20' });
    expect(doneRange(null, '2026-10-20', today)).toEqual({ from: '2026-10-20', to: '2026-10-20' });
  });

  it('a bound cleared in its field counts as absent, not as «—»', () => {
    expect(doneRange('2026-10-20', '', today)).toEqual({ from: '2026-10-20', to: '2026-10-20' });
    expect(doneRange('', '', today)).toEqual({ from: today, to: today });
  });

  it('a «to» before the «from» reads the days between', () => {
    expect(doneRange('2026-10-25', '2026-10-20', today)).toEqual({
      from: '2026-10-20',
      to: '2026-10-25',
    });
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
