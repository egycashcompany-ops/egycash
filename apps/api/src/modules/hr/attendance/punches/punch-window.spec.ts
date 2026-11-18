// The §13 clock-drift window, pinned: rows outside it are QUARANTINED with a reason, and the
// reason strings are part of what an import reviewer reads back.
//
// THE TWO HALVES ARE NO LONGER THE SAME KIND OF RULE. The future guard is a constant, because a
// scan dated an hour from now is a broken clock in every case. The age guard is a setting that
// defaults to no limit, because the one it replaced — 90 days — was not protecting anything the
// future guard does not: it was hiding 62,505 scans the branch machines had been holding since
// December 2024, and nothing on any screen said so.
import { describe, expect, it } from 'vitest';
import { punchWindowProblem, PUNCH_MAX_FUTURE_MS } from './punch.service';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

describe('punchWindowProblem', () => {
  it('accepts now, the recent past, and small future skew', () => {
    expect(punchWindowProblem(NOW, NOW)).toBeNull();
    expect(punchWindowProblem(daysAgo(1), NOW)).toBeNull();
    expect(punchWindowProblem(new Date(NOW.getTime() + PUNCH_MAX_FUTURE_MS), NOW)).toBeNull();
  });

  it('quarantines the far future — a device clock running ahead', () => {
    expect(punchWindowProblem(new Date(NOW.getTime() + PUNCH_MAX_FUTURE_MS + 60_000), NOW)).toBe(
      'timestamp is in the future',
    );
  });

  it('accepts two years of history when no limit is set — the default', () => {
    // THE WHOLE POINT OF THE CHANGE. December 2024 is roughly 580 days before this NOW.
    expect(punchWindowProblem(daysAgo(580), NOW)).toBeNull();
    expect(punchWindowProblem(daysAgo(580), NOW, null)).toBeNull();
    // 0 is how «no limit» is written in a numeric setting the screens can edit.
    expect(punchWindowProblem(daysAgo(580), NOW, 0)).toBeNull();
  });

  it('quarantines rows older than the limit, when a limit is set', () => {
    expect(punchWindowProblem(daysAgo(91), NOW, 90)).toBe('timestamp is older than 90 days');
    expect(punchWindowProblem(daysAgo(89), NOW, 90)).toBeNull();
    // And the reason names the limit that was applied, not a constant the reader cannot see.
    expect(punchWindowProblem(daysAgo(40), NOW, 30)).toBe('timestamp is older than 30 days');
  });

  it('quarantines an unparseable timestamp', () => {
    expect(punchWindowProblem(new Date('nonsense'), NOW)).toBe('invalid timestamp');
  });
});
