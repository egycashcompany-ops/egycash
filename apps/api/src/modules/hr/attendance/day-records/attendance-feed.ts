// The Attendance → Payroll feed seam (AT-4, v1.1 §15.1 + D-PR-07 Option A).
//
// Two internal functions and nothing else — no endpoint, no permission, no caller until the
// Payroll Run exists (P-HR-09). `readFrozenFeed` is the ONLY way attendance leaves this module,
// and it refuses a period that is not fully frozen: a partial feed would let Payroll price a
// month whose truth was still moving, which is the exact failure the freeze exists to prevent.
//
// The row mapper is pure and its output carries EXACTLY the twelve §15.1 fields — no id, no
// computedAt, no punch instants, and no unapproved `overtimeMinutes`. A contract test holds the
// keys to `ATTENDANCE_FEED_FIELDS` by name, so a field added here without a contract change is a
// failing test, not a silent widening of what Payroll can see.
import {
  ATTENDANCE_FEED_FIELDS,
  type AttendanceFeedRow,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../../../shared/errors';
import { dateOnlyIso } from '../../shared/business-date';
import { type AttendanceDayDoc } from './day-record.model';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` → the UTC-midnight first and last days of that Cairo calendar month. Pure. */
export const monthRange = (period: string): { from: Date; to: Date } => {
  if (!PERIOD_PATTERN.test(period)) {
    throw new BusinessRuleError(`not a period: ${period} (expected YYYY-MM)`);
  }
  const [y, m] = period.split('-').map(Number) as [number, number];
  return {
    from: new Date(Date.UTC(y, m - 1, 1)),
    to: new Date(Date.UTC(y, m, 0)),
  };
};

/** One frozen row, in exactly the contract's shape. Pure; throws on an unfrozen row. */
export const toFeedRow = (doc: AttendanceDayDoc): AttendanceFeedRow => {
  if (doc.frozenAt === null) {
    // Belt to the reader's braces: the query filters on the period being frozen, and this makes
    // the invariant local so no future call path can map an unfrozen row by accident.
    throw new BusinessRuleError('an unfrozen row never leaves the module');
  }
  return {
    employeeId: String(doc.employeeId),
    workDate: dateOnlyIso(doc.workDate),
    status: doc.status,
    shiftId: doc.shiftId === null ? null : String(doc.shiftId),
    workedMinutes: doc.workedMinutes,
    lateMinutes: doc.lateMinutes,
    earlyLeaveMinutes: doc.earlyLeaveMinutes,
    approvedOvertimeMinutes: doc.approvedOvertimeMinutes,
    leaveId: doc.leaveId === null ? null : String(doc.leaveId),
    branchId: String(doc.branchId),
    flags: doc.flags,
    frozenAt: doc.frozenAt.toISOString(),
  };
};

/** The contract's spine, re-exported beside the mapper so the two are reviewed together. */
export { ATTENDANCE_FEED_FIELDS };
