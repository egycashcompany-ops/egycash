// The ONE place in Payroll that knows Attendance exists (PY-4).
//
// Everything else in this module — the rules engine, the quantity derivation, the service, the
// contracts — works on feed ROWS, a shape, not on attendance. That is what makes the seam real
// rather than a convention: to widen what Payroll can see from attendance you have to edit this
// file, and this file is nine lines long.
//
// WHAT IT MAY CALL, AND NOTHING ELSE. `readFrozenFeed(period, employeeId)` — the §15.1 reader,
// which is complete-or-nothing by design and refuses a period with even one unfrozen row. Payroll
// never touches the day model, never queries punches, and above all never calls `freezePeriod()`:
// freezing is the Payroll RUN's decision and it goes through the OTHER door, `runs/attendance-
// freeze.port.ts` (PY-6). Two doors, one each way, and neither may do the other's job.
import { dayRecordService } from '../../attendance';
import { BusinessRuleError } from '../../../../shared/errors';
import { type FrozenAttendance } from './attendance-quantities';

export interface AttendanceQuantityPort {
  /**
   * One employee's frozen rows for a period, or `null` when the period is not frozen.
   *
   * Not-frozen is answered as a value rather than an exception because it is an ordinary state of
   * the world, not a fault: most months have not been through a payroll run yet, and a screen
   * asking about one should show what it can rather than fail.
   */
  frozenFor(period: string, employeeId: string): Promise<FrozenAttendance | null>;
}

export const attendanceQuantityPort: AttendanceQuantityPort = {
  async frozenFor(period, employeeId) {
    try {
      const rows = await dayRecordService.readFrozenFeed(period, employeeId);
      if (rows.length > 0) return { rows, frozenAt: rows[0]?.frozenAt ?? null };

      // An empty result is AMBIGUOUS, and getting this wrong prices a month nobody has looked at.
      //
      // The reader's completeness test is "this period holds no UNFROZEN row", which a period
      // nobody has ever computed passes vacuously — an untouched future month reads exactly like
      // a frozen one. So before calling it frozen, ask whether the period holds any frozen row at
      // all. Only then is an employee's empty set a real zero rather than an unasked question.
      //
      // The unfiltered read is the expensive branch and it runs only when this employee has no
      // rows, which is either an unfrozen period (cheap — there is nothing to return) or the rare
      // case of someone with no attendance in a frozen one.
      const anyRow = await dayRecordService.readFrozenFeed(period);
      return anyRow.length === 0 ? null : { rows: [], frozenAt: anyRow[0]?.frozenAt ?? null };
    } catch (error) {
      // ONLY the reader's own refusal means "not knowable yet" — a period still holding fluid
      // rows. Anything else (a dropped connection, a bug) must keep travelling: swallowing it
      // would report an unfrozen month while the database was on fire, and every quantity line
      // would quietly read `pending` instead of failing loudly.
      if (error instanceof BusinessRuleError) return null;
      throw error;
    }
  },
};
