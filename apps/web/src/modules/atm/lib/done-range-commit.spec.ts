// The done pages' range reaches the address bar — and so the read — only as a day a reader meant: a
// complete, real calendar date from the year 2000, once the box has held still for half a second,
// or at once when it is left. Typing a year into a native date box walks its value through
// 0002-…, 0020-…, 0202-… before 2026-…; each of those used to start the walk of a range reaching back
// centuries. Pinned with fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DONE_RANGE_COMMIT_DELAY_MS,
  DONE_RANGE_MIN_YEAR,
  committableRange,
  createRangeCommitter,
  isCommittableDay,
  type DayRange,
} from './done-range-commit';

const TODAY: DayRange = { from: '2026-11-04', to: '2026-11-04' };

describe('isCommittableDay', () => {
  it('takes a complete, real calendar day from the year 2000', () => {
    expect(DONE_RANGE_MIN_YEAR).toBe(2000);
    expect(isCommittableDay('2026-11-04')).toBe(true);
    expect(isCommittableDay('2000-01-01')).toBe(true);
    expect(isCommittableDay('2028-02-29')).toBe(true);
  });

  it('refuses a year still being typed', () => {
    for (const value of ['0002-11-04', '0020-11-04', '0202-11-04', '1999-12-31']) {
      expect(isCommittableDay(value), value).toBe(false);
    }
  });

  it('refuses what is not a day: empty, partial, impossible, or a six-digit year', () => {
    for (const value of [
      '',
      '2026-11',
      '2026-13-01',
      '2026-02-30',
      '2027-02-29',
      '202611-04',
      '+012026-11-04',
    ]) {
      expect(isCommittableDay(value), value).toBe(false);
    }
  });
});

describe('committableRange', () => {
  it('keeps the day the page reads for a box that holds no day to commit', () => {
    expect(committableRange({ from: '0202-11-04', to: '2026-11-05' }, TODAY)).toEqual({
      from: '2026-11-04',
      to: '2026-11-05',
    });
    expect(committableRange({ from: '', to: '' }, TODAY)).toEqual(TODAY);
  });
});

describe('the range committer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const build = () => {
    const commits: DayRange[] = [];
    const committer = createRangeCommitter((range) => commits.push(range), TODAY);
    return { commits, committer };
  };

  it('typing a year commits ONCE, the finished day, after the box holds still', () => {
    const { commits, committer } = build();
    // The browser's own sequence while «2025» is typed over the year of «from».
    for (const from of ['0002-11-04', '0020-11-04', '0202-11-04', '2025-11-04']) {
      committer.edit({ from, to: TODAY.to });
      vi.advanceTimersByTime(120);
    }
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(DONE_RANGE_COMMIT_DELAY_MS - 121);
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual([{ from: '2025-11-04', to: '2026-11-04' }]);
    vi.advanceTimersByTime(10_000);
    expect(commits).toHaveLength(1);
  });

  it('never commits a day that is not one — however long the box holds it', () => {
    const { commits, committer } = build();
    committer.edit({ from: '0202-11-04', to: TODAY.to });
    vi.advanceTimersByTime(60_000);
    committer.edit({ from: '', to: TODAY.to });
    vi.advanceTimersByTime(60_000);
    expect(commits).toEqual([]);
  });

  it('a box left commits at once, without waiting', () => {
    const { commits, committer } = build();
    committer.edit({ from: TODAY.from, to: '2026-11-09' });
    committer.flush();
    expect(commits).toEqual([{ from: '2026-11-04', to: '2026-11-09' }]);
    // The timer the edit started does not send it a second time.
    vi.advanceTimersByTime(DONE_RANGE_COMMIT_DELAY_MS * 2);
    expect(commits).toHaveLength(1);
    committer.flush();
    expect(commits).toHaveLength(1);
  });

  it('a box left holding no day commits nothing', () => {
    const { commits, committer } = build();
    committer.edit({ from: '0020-11-04', to: TODAY.to });
    committer.flush();
    vi.advanceTimersByTime(DONE_RANGE_COMMIT_DELAY_MS * 2);
    expect(commits).toEqual([]);
  });

  it('a box typed back to the day the page reads commits nothing', () => {
    const { commits, committer } = build();
    committer.edit({ from: '2026-11-01', to: TODAY.to });
    committer.edit({ from: TODAY.from, to: TODAY.to });
    vi.advanceTimersByTime(DONE_RANGE_COMMIT_DELAY_MS * 2);
    expect(commits).toEqual([]);
  });

  it('measures a draft against the range the page reads NOW', () => {
    const { commits, committer } = build();
    // The back button moved the page to another range.
    committer.sync({ from: '2026-10-01', to: '2026-10-31' });
    committer.edit({ from: '2026-10-01', to: '2026-10-31' });
    vi.advanceTimersByTime(DONE_RANGE_COMMIT_DELAY_MS);
    expect(commits).toEqual([]);
    committer.edit({ from: '2026-10-05', to: '2026-10-31' });
    vi.advanceTimersByTime(DONE_RANGE_COMMIT_DELAY_MS);
    expect(commits).toEqual([{ from: '2026-10-05', to: '2026-10-31' }]);
  });

  it('a cancelled committer never fires', () => {
    const { commits, committer } = build();
    committer.edit({ from: '2026-11-01', to: TODAY.to });
    committer.cancel();
    vi.advanceTimersByTime(DONE_RANGE_COMMIT_DELAY_MS * 4);
    committer.flush();
    expect(commits).toEqual([]);
  });
});
