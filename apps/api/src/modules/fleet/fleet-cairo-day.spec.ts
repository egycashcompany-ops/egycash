// «اليوم» is Cairo's day: the boundaries sit at Cairo's midnight in winter (22:00 UTC) and in summer
// (21:00 UTC), and the two nights the clock moves make a 23-hour and a 25-hour day.
import { describe, expect, it } from 'vitest';
import { cairoDayOf, cairoDayRange, cairoDayStart, cairoTodayAsUtcDay } from './fleet-cairo-day';

const at = (iso: string) => new Date(iso);

describe('the Cairo day of an instant', () => {
  it('in winter (+02:00) the day turns at 22:00 UTC — 21:30Z is still today, 22:30Z tomorrow', () => {
    expect(cairoDayOf(at('2026-11-01T21:30:00Z'))).toBe('2026-11-01');
    expect(cairoDayOf(at('2026-11-01T21:59:59.999Z'))).toBe('2026-11-01');
    expect(cairoDayOf(at('2026-11-01T22:00:00Z'))).toBe('2026-11-02');
    expect(cairoDayOf(at('2026-11-01T22:30:00Z'))).toBe('2026-11-02');
  });

  it('in summer (+03:00) the day turns at 21:00 UTC', () => {
    expect(cairoDayOf(at('2026-07-15T20:30:00Z'))).toBe('2026-07-15');
    expect(cairoDayOf(at('2026-07-15T21:30:00Z'))).toBe('2026-07-16');
    expect(cairoDayOf(at('2026-07-15T22:30:00Z'))).toBe('2026-07-16');
  });

  it('a top-up at 00:10 Cairo is today; one at 23:30 Cairo was yesterday', () => {
    // 00:10 on 1 November in Cairo is 22:10Z on 31 October.
    expect(cairoDayOf(at('2026-10-31T22:10:00Z'))).toBe('2026-11-01');
    // 23:30 on 31 October in Cairo is 21:30Z on 31 October.
    expect(cairoDayOf(at('2026-10-31T21:30:00Z'))).toBe('2026-10-31');
  });
});

describe('a Cairo day as instants', () => {
  it('starts at Cairo’s midnight — 22:00Z the day before in winter, 21:00Z in summer', () => {
    expect(cairoDayStart('2026-11-02').toISOString()).toBe('2026-11-01T22:00:00.000Z');
    expect(cairoDayStart('2026-07-16').toISOString()).toBe('2026-07-15T21:00:00.000Z');
    expect(cairoDayRange('2026-11-02')).toEqual({
      start: at('2026-11-01T22:00:00Z'),
      end: at('2026-11-02T22:00:00Z'),
    });
  });

  it('summer time starts on the last Friday of April — a 23-hour day that begins at 01:00', () => {
    const { start, end } = cairoDayRange('2026-04-24');
    expect(start.toISOString()).toBe('2026-04-23T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-24T21:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it('summer time ends on the last Thursday of October — a 25-hour day', () => {
    const { start, end } = cairoDayRange('2026-10-29');
    expect(start.toISOString()).toBe('2026-10-28T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-29T22:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });

  it('round-trips every day of a year — its first and last instant are that day', () => {
    for (let i = 0; i < 366; i += 1) {
      const ymd = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const { start, end } = cairoDayRange(ymd);
      expect(cairoDayOf(start)).toBe(ymd);
      expect(cairoDayOf(new Date(end.getTime() - 1))).toBe(ymd);
      expect(cairoDayStart(ymd)).toEqual(start);
      expect(cairoDayOf(new Date(start.getTime() - 1))).not.toBe(ymd);
    }
  });

  it('refuses what is not a calendar day', () => {
    for (const bad of ['2026-02-30', '2026-1-01', '01-11-2026', '', '2026-11-01T00:00']) {
      expect(() => cairoDayStart(bad)).toThrow(RangeError);
      expect(() => cairoDayRange(bad)).toThrow(RangeError);
    }
  });
});

describe('Cairo’s today as a UTC day', () => {
  it('is the Cairo calendar day of the instant, at UTC midnight', () => {
    expect(cairoTodayAsUtcDay(at('2026-11-01T21:30:00Z')).toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    // 23:30Z on 1 November is already 01:30 on the 2nd in Cairo.
    expect(cairoTodayAsUtcDay(at('2026-11-01T23:30:00Z')).toISOString()).toBe(
      '2026-11-02T00:00:00.000Z',
    );
    expect(cairoTodayAsUtcDay(at('2026-07-15T21:30:00Z')).toISOString()).toBe(
      '2026-07-16T00:00:00.000Z',
    );
  });

  it('defaults to now', () => {
    const before = cairoDayOf(new Date());
    const today = cairoTodayAsUtcDay().toISOString().slice(0, 10);
    const after = cairoDayOf(new Date());
    expect([before, after]).toContain(today);
  });
});
