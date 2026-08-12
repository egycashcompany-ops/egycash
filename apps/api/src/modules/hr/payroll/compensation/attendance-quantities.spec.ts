// Counting frozen attendance into quantities (PY-4), without a database.
//
// The rows below are hand-built feed rows, which is the point: this is where a day either counts
// or does not, and every rule about that — which statuses are attendance, which days fall outside
// employment, which fall outside the assignment — is arithmetic over values.
import { describe, expect, it } from 'vitest';
import {
  PAY_ITEM_QUANTITY_SOURCES,
  QUANTITY_SOURCE_UNITS,
  type AttendanceFeedRow,
  type AttendanceDayStatus,
} from '@ecms/contracts';
import { quantityFor, unitOf } from './attendance-quantities';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const row = (
  workDate: string,
  status: AttendanceDayStatus,
  over: Partial<AttendanceFeedRow> = {},
): AttendanceFeedRow => ({
  employeeId: 'e1',
  workDate,
  status,
  shiftId: 's1',
  workedMinutes: 0,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  approvedOvertimeMinutes: 0,
  leaveId: null,
  branchId: 'b1',
  flags: [],
  frozenAt: '2026-04-01T00:00:00.000Z',
  ...over,
});

const MARCH = { from: d('2026-03-01'), to: d('2026-03-31') };
const ALWAYS_EMPLOYED = [{ from: d('2020-01-01'), to: null }];

describe('the unit table covers every source, and nothing else', () => {
  it('assigns each source a unit', () => {
    for (const source of PAY_ITEM_QUANTITY_SOURCES) {
      expect(unitOf(source), source).toMatch(/^(days|minutes)$/);
      expect(QUANTITY_SOURCE_UNITS[source]).toBe(unitOf(source));
    }
    expect(Object.keys(QUANTITY_SOURCE_UNITS).sort()).toEqual([...PAY_ITEM_QUANTITY_SOURCES].sort());
  });
});

describe('day sources', () => {
  const month = [
    row('2026-03-02', 'present'),
    row('2026-03-03', 'late'),
    row('2026-03-04', 'earlyLeave'),
    row('2026-03-05', 'lateAndEarly'),
    row('2026-03-06', 'absent'),
    row('2026-03-09', 'absent'),
    row('2026-03-10', 'onLeave'),
    // The four nobody has ruled on — see the header of attendance-quantities.ts.
    row('2026-03-11', 'incomplete'),
    row('2026-03-07', 'weekend'),
    row('2026-03-08', 'holiday'),
    row('2026-03-12', 'dayOff'),
  ];

  it('counts the four attendance statuses and only those', () => {
    expect(quantityFor(month, 'attendedDays', MARCH, ALWAYS_EMPLOYED)).toBe(4);
  });

  it('counts absences', () => {
    expect(quantityFor(month, 'absentDays', MARCH, ALWAYS_EMPLOYED)).toBe(2);
  });

  it('counts leave days', () => {
    expect(quantityFor(month, 'leaveDays', MARCH, ALWAYS_EMPLOYED)).toBe(1);
  });

  // The decision this asserts: `incomplete`, `weekend`, `holiday` and `dayOff` belong to NO group.
  // Whether a missing checkout is attendance is a labour rule, and none has been given.
  it('puts incomplete, weekend, holiday and dayOff in no group at all', () => {
    const unruled = [
      row('2026-03-11', 'incomplete'),
      row('2026-03-07', 'weekend'),
      row('2026-03-08', 'holiday'),
      row('2026-03-12', 'dayOff'),
    ];
    expect(quantityFor(unruled, 'attendedDays', MARCH, ALWAYS_EMPLOYED)).toBe(0);
    expect(quantityFor(unruled, 'absentDays', MARCH, ALWAYS_EMPLOYED)).toBe(0);
    expect(quantityFor(unruled, 'leaveDays', MARCH, ALWAYS_EMPLOYED)).toBe(0);
  });
});

describe('minute sources', () => {
  const month = [
    row('2026-03-02', 'late', { workedMinutes: 480, lateMinutes: 15, approvedOvertimeMinutes: 30 }),
    row('2026-03-03', 'earlyLeave', { workedMinutes: 400, earlyLeaveMinutes: 20 }),
    row('2026-03-04', 'present', { workedMinutes: 480, approvedOvertimeMinutes: 45 }),
  ];

  it('sums each minute field independently', () => {
    expect(quantityFor(month, 'workedMinutes', MARCH, ALWAYS_EMPLOYED)).toBe(1360);
    expect(quantityFor(month, 'lateMinutes', MARCH, ALWAYS_EMPLOYED)).toBe(15);
    expect(quantityFor(month, 'earlyLeaveMinutes', MARCH, ALWAYS_EMPLOYED)).toBe(20);
    expect(quantityFor(month, 'approvedOvertimeMinutes', MARCH, ALWAYS_EMPLOYED)).toBe(75);
  });

  // Unapproved overtime never crosses the feed at all (attendance D5), so there is nothing here
  // to filter — the row simply has no field for it. This asserts the shape that guarantees it.
  it('has no unapproved overtime to read, because the feed carries none', () => {
    expect(Object.keys(row('2026-03-02', 'present'))).not.toContain('overtimeMinutes');
  });
});

describe('the window: assignment ∩ period', () => {
  const month = [
    row('2026-03-02', 'present'),
    row('2026-03-20', 'present'),
    row('2026-04-02', 'present'), // the feed never returns this for March, but a guard is cheap
  ];

  it('counts only days inside the slice', () => {
    const firstHalf = { from: d('2026-03-01'), to: d('2026-03-15') };
    expect(quantityFor(month, 'attendedDays', firstHalf, ALWAYS_EMPLOYED)).toBe(1);
  });

  it('treats an open-ended slice as running to the end', () => {
    expect(quantityFor(month, 'attendedDays', { from: d('2026-03-16'), to: null }, ALWAYS_EMPLOYED)).toBe(2);
  });

  it('includes both endpoints', () => {
    const oneDay = { from: d('2026-03-02'), to: d('2026-03-02') };
    expect(quantityFor(month, 'attendedDays', oneDay, ALWAYS_EMPLOYED)).toBe(1);
  });
});

describe('the employment leg', () => {
  const month = [
    row('2026-03-02', 'present'),
    row('2026-03-05', 'present'),
    row('2026-03-15', 'present'),
    row('2026-03-25', 'present'),
  ];

  it('drops days before the hire', () => {
    expect(quantityFor(month, 'attendedDays', MARCH, [{ from: d('2026-03-10'), to: null }])).toBe(2);
  });

  it('drops days after the exit', () => {
    expect(
      quantityFor(month, 'attendedDays', MARCH, [{ from: d('2020-01-01'), to: d('2026-03-10') }]),
    ).toBe(2);
  });

  // The case the whole plural-spans design exists for.
  it('skips the gap between two spans — a rehire', () => {
    expect(
      quantityFor(month, 'attendedDays', MARCH, [
        { from: d('2020-01-01'), to: d('2026-03-06') },
        { from: d('2026-03-20'), to: null },
      ]),
    ).toBe(3); // the 2nd and 5th, then the 25th — the 15th falls in the gap
  });

  it('counts nothing for an employee not employed in the period at all', () => {
    expect(quantityFor(month, 'attendedDays', MARCH, [{ from: d('2027-01-01'), to: null }])).toBe(0);
    expect(quantityFor(month, 'attendedDays', MARCH, [])).toBe(0);
  });
});

describe('degenerate inputs', () => {
  it('is zero over no rows — which is a KNOWN zero, not an unknown', () => {
    for (const source of PAY_ITEM_QUANTITY_SOURCES) {
      expect(quantityFor([], source, MARCH, ALWAYS_EMPLOYED), source).toBe(0);
    }
  });

  it('is zero when a frozen month simply has nothing to count', () => {
    const quiet = [row('2026-03-07', 'weekend'), row('2026-03-08', 'holiday')];
    expect(quantityFor(quiet, 'attendedDays', MARCH, ALWAYS_EMPLOYED)).toBe(0);
    expect(quantityFor(quiet, 'workedMinutes', MARCH, ALWAYS_EMPLOYED)).toBe(0);
  });

  // Every minute field is a non-negative integer by contract and a day contributes 0 or 1, so
  // this cannot arise from a well-formed feed. The guard is here because this is the one place a
  // number crosses from another module into a figure somebody is paid.
  it('refuses a negative minute rather than subtracting from someone’s pay', () => {
    const corrupt = [row('2026-03-02', 'present', { workedMinutes: -60 })];
    expect(() => quantityFor(corrupt, 'workedMinutes', MARCH, ALWAYS_EMPLOYED)).toThrow(RangeError);
  });
});
