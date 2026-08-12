// The §15.1 contract, held at both ends (AT-4): the mapper's output carries EXACTLY the twelve
// fields the owner approved — by name, in order, no extras — and an unfrozen row can never leave
// the module, whatever call path reaches the mapper.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { ATTENDANCE_FEED_FIELDS, AttendanceFeedRowSchema } from '@ecms/contracts';
import { monthRange, toFeedRow } from './attendance-feed';
import { type AttendanceDayDoc } from './day-record.model';

const oid = () => new Types.ObjectId();

const doc = (over: Partial<AttendanceDayDoc> = {}): AttendanceDayDoc =>
  ({
    _id: oid(),
    employeeId: oid(),
    workDate: new Date(Date.UTC(2026, 6, 15)),
    status: 'late',
    shiftId: oid(),
    firstInAt: new Date('2026-07-15T07:00:00.000Z'),
    lastOutAt: new Date('2026-07-15T14:00:00.000Z'),
    workedMinutes: 420,
    lateMinutes: 60,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 45,
    approvedOvertimeMinutes: 0,
    leaveId: null,
    flags: ['crossBranchPunch'],
    branchId: oid(),
    computedAt: new Date('2026-08-01T00:00:00.000Z'),
    frozenAt: new Date('2026-08-01T02:00:00.000Z'),
    isDeleted: false,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    __v: 0,
    ...over,
  }) as unknown as AttendanceDayDoc;

describe('the §15.1 feed row', () => {
  it('carries EXACTLY the twelve contract fields, in order — the contract test', () => {
    const row = toFeedRow(doc());
    expect(Object.keys(row)).toEqual([...ATTENDANCE_FEED_FIELDS]);
    expect(ATTENDANCE_FEED_FIELDS).toHaveLength(12);
  });

  it('parses against the contract schema — a strict schema, so extras would fail too', () => {
    expect(AttendanceFeedRowSchema.strict().safeParse(toFeedRow(doc())).success).toBe(true);
  });

  it('never carries the UNAPPROVED overtime — only what the D5 approval released', () => {
    const row = toFeedRow(doc({ overtimeMinutes: 90, approvedOvertimeMinutes: 30 }));
    expect(row.approvedOvertimeMinutes).toBe(30);
    expect('overtimeMinutes' in row).toBe(false);
  });

  it('refuses an unfrozen row, whatever call path reaches the mapper', () => {
    expect(() => toFeedRow(doc({ frozenAt: null }))).toThrow('unfrozen');
  });

  it('the day belongs to its shift-start date (D3) and carries the EMPLOYEE branch (D8)', () => {
    const branchId = oid();
    const row = toFeedRow(doc({ branchId }));
    expect(row.workDate).toBe('2026-07-15');
    expect(row.branchId).toBe(String(branchId));
  });
});

describe('monthRange', () => {
  it('spans the first to the last day of the month, UTC-midnight date-only', () => {
    expect(monthRange('2026-07')).toEqual({
      from: new Date(Date.UTC(2026, 6, 1)),
      to: new Date(Date.UTC(2026, 6, 31)),
    });
    expect(monthRange('2026-02').to).toEqual(new Date(Date.UTC(2026, 1, 28)));
    expect(monthRange('2028-02').to).toEqual(new Date(Date.UTC(2028, 1, 29)));
  });

  it('refuses anything that is not YYYY-MM', () => {
    for (const bad of ['2026-13', '2026-0', '2026-7', 'july', '2026-07-01', '']) {
      expect(() => monthRange(bad), bad).toThrow('not a period');
    }
  });
});
