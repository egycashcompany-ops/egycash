// The one piece of the attendance surface that is a decision rather than a read: how HR's ten day
// statuses become the five buckets a planner counts by.
//
// It is tested on its own because the mapping is where this surface could quietly start lying —
// folding `incomplete` or `weekend` into "present" would put a number on a planning screen that
// says people are at work when attendance never said so.
import { describe, expect, it } from 'vitest';
import { ATTENDANCE_DAY_STATUSES } from '@ecms/contracts';
import { attendanceBucket } from './crew-requirements.service';

describe('attendance buckets (B5)', () => {
  it('counts at-work variants as present — late and early-leave are still at work', () => {
    expect(attendanceBucket('present')).toBe('present');
    expect(attendanceBucket('late')).toBe('present');
    expect(attendanceBucket('earlyLeave')).toBe('present');
    expect(attendanceBucket('lateAndEarly')).toBe('present');
  });

  it('keeps absence and leave apart — HR distinguishes them and so does the header', () => {
    expect(attendanceBucket('absent')).toBe('absent');
    expect(attendanceBucket('onLeave')).toBe('onLeave');
  });

  it('does not count a non-working day as anybody being anywhere', () => {
    expect(attendanceBucket('weekend')).toBe('notScheduled');
    expect(attendanceBucket('holiday')).toBe('notScheduled');
    expect(attendanceBucket('dayOff')).toBe('notScheduled');
  });

  it('treats "no answer" and "attendance could not decide" the same, and never as present', () => {
    expect(attendanceBucket(undefined)).toBe('unknown');
    expect(attendanceBucket('incomplete')).toBe('unknown');
  });

  it('accounts for every status HR declares — a new one must not default to present', () => {
    for (const status of ATTENDANCE_DAY_STATUSES) {
      const bucket = attendanceBucket(status);
      expect(['present', 'absent', 'onLeave', 'notScheduled', 'unknown']).toContain(bucket);
    }
    // The guard that matters: exactly four statuses may ever mean "at work".
    const atWork = ATTENDANCE_DAY_STATUSES.filter((s) => attendanceBucket(s) === 'present');
    expect([...atWork]).toEqual(['present', 'late', 'earlyLeave', 'lateAndEarly']);
  });
});
