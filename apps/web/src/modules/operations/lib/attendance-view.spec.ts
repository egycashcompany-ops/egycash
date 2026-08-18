// The attendance page's two pure decisions, tested where they can be tested.
//
// Tone matters more than it looks: this page sits one click from the crew board, and a planner
// scanning it reads colour before text. A status this build does not recognize must never come
// out green.
import { describe, expect, it } from 'vitest';
import { ATTENDANCE_DAY_STATUSES } from '@ecms/contracts';
import { attendanceTone, toIsoDay } from './attendance-view';

describe('attendance view (B5)', () => {
  it('paints only a clean present day green', () => {
    expect(attendanceTone('present')).toBe('success');
    const alsoAtWork = (['late', 'earlyLeave', 'lateAndEarly'] as const).map(attendanceTone);
    expect(alsoAtWork).toEqual(['warning', 'warning', 'warning']);
  });

  it('separates absence, leave and non-working days by colour', () => {
    expect(attendanceTone('absent')).toBe('danger');
    expect(attendanceTone('onLeave')).toBe('info');
    expect(attendanceTone('weekend')).toBe('neutral');
    expect(attendanceTone('holiday')).toBe('neutral');
    expect(attendanceTone('dayOff')).toBe('neutral');
  });

  it('never paints an unresolved day as success', () => {
    expect(attendanceTone('incomplete')).toBe('neutral');
    const green = ATTENDANCE_DAY_STATUSES.filter((s) => attendanceTone(s) === 'success');
    expect([...green]).toEqual(['present']);
  });

  it('gives every status HR can produce a tone', () => {
    for (const status of ATTENDANCE_DAY_STATUSES) {
      expect(['success', 'danger', 'warning', 'info', 'neutral']).toContain(
        attendanceTone(status),
      );
    }
  });

  it('keys the day in UTC, so a late local evening does not ask for tomorrow', () => {
    expect(toIsoDay(new Date('2026-08-18T23:45:00.000Z'))).toBe('2026-08-18');
    expect(toIsoDay(new Date('2026-08-18T00:05:00.000Z'))).toBe('2026-08-18');
  });
});
