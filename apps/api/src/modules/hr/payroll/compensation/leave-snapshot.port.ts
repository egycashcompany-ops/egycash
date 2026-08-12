// The ONE place a calculation reads pinned leave (PY-5).
//
// Note what this file does NOT import: anything from leave-management. PY-5 never asks Leave a
// question — it reads `hr_payroll_leave_snapshots`, a table inside payroll that PY-6 wrote at
// freeze time. That is the whole point of the snapshot and the test of whether PY-6 was designed
// right: the ledger keeps moving (a request completes, is cancelled or returns early long after a
// month was priced), and a calculation that re-read it would answer the same month differently on
// two different days.
//
// So the seam Payroll has into Leave is still exactly one door, still only ever opened at freeze
// time, and this file is not it.
import { Types } from 'mongoose';
import { PayrollLeaveSnapshotModel } from '../runs/payroll-leave-snapshot.model';
import { PayrollRunModel } from '../runs/payroll-run.model';
import { type FrozenLeave } from './leave-pay';

export interface LeaveSnapshotPort {
  /**
   * One employee's pinned leave for a period, or `null` when no run has pinned it.
   *
   * Null is an ordinary state of the world, not a fault: most periods have never been through a
   * run. It is also NOT "this employee took no leave" — an employee with no rows in a frozen
   * period comes back as an empty slice list, which is a real zero. Collapsing the two would
   * price a month nobody has looked at as though it were settled.
   */
  frozenFor(period: string, employeeId: string): Promise<FrozenLeave | null>;
}

export const leaveSnapshotPort: LeaveSnapshotPort = {
  async frozenFor(period, employeeId) {
    // `ux_live_period` allows at most one live run per period, and only a frozen one has a
    // snapshot — a draft has not written a row yet and a cancelled one is no longer the period's
    // answer. So this is a single row or nothing, never a choice between candidates.
    const run = await PayrollRunModel.findOne({ period, status: 'frozen', isDeleted: false })
      .lean()
      .exec();
    if (run === null) return null;

    const rows = await PayrollLeaveSnapshotModel.find({
      runId: run._id as Types.ObjectId,
      employeeId: new Types.ObjectId(employeeId),
      isDeleted: false,
    })
      .sort({ from: 1, _id: 1 })
      .lean()
      .exec();

    return {
      runId: String(run._id),
      // The RUN's freeze stamp, not each row's — every row of one run was pinned by one act, and
      // the reader is being told which version of the truth this is.
      snapshotAt: (run.frozenAt ?? run.updatedAt).toISOString(),
      slices: rows.map((row) => ({
        typeCode: row.typeCode,
        days: row.days,
        breakdown: row.breakdown,
      })),
    };
  },
};
