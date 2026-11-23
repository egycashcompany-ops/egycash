// The one piece of the attendance surface that is a decision rather than a read: how HR's ten day
// statuses become the five buckets a planner counts by.
//
// It is tested on its own because the mapping is where this surface could quietly start lying —
// folding `incomplete` or `weekend` into "present" would put a number on a planning screen that
// says people are at work when attendance never said so.
import { describe, expect, it } from 'vitest';
import { ATTENDANCE_DAY_STATUSES } from '@ecms/contracts';
import { attendanceBucket, crewAvailabilityFrom } from './crew-requirements.service';

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
    // Somebody nobody has scheduled derives `noSchedule` where they used to derive `dayOff`. The
    // board's question — can I count on this person today — has the same answer either way, so it
    // must not drift into `unknown` when the status was renamed.
    expect(attendanceBucket('noSchedule')).toBe('notScheduled');
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

// Round 22 — «لو القائد غايب ... مقدرش احطه على العربيه»: the board's «away» is TWO of those buckets
// and nothing else, because this answer keeps somebody off a van.
describe('crew availability on the board (Round 22)', () => {
  it('is away only when HR’s record says absent or on leave', () => {
    expect(crewAvailabilityFrom({ status: 'absent' }, false)).toBe('absent');
    expect(crewAvailabilityFrom({ status: 'onLeave' }, false)).toBe('onLeave');
    for (const status of ATTENDANCE_DAY_STATUSES) {
      if (status === 'absent' || status === 'onLeave') continue;
      expect(crewAvailabilityFrom({ status }, false), status).toBeNull();
    }
  });

  it('never makes an unknown an absence — no record and no leave is null', () => {
    expect(crewAvailabilityFrom(undefined, false)).toBeNull();
    expect(crewAvailabilityFrom({ status: 'incomplete' }, false)).toBeNull();
  });

  it('answers on leave from an approved leave only where HR has not computed the day', () => {
    expect(crewAvailabilityFrom(undefined, true)).toBe('onLeave');
    // A record is HR's answer for the day, and it wins: an absence stays an absence.
    expect(crewAvailabilityFrom({ status: 'absent' }, true)).toBe('absent');
    expect(crewAvailabilityFrom({ status: 'present' }, true)).toBeNull();
  });
});
