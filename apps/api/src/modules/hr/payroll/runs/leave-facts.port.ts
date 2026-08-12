// The ONE place in Payroll that knows the leave ledger exists (PY-6).
//
// The same shape as the attendance port, for the same reason: everything else in this module works
// on snapshot ROWS, and widening what payroll can see from leave means editing this file. It reads
// and never writes — the ledger is append-only and belongs to Leave.
//
// AND IT IS ONLY EVER READ AT FREEZE TIME. Pricing reads the snapshot, never this. A request can
// complete, be cancelled or return early after a period is priced, and the ledger would answer
// differently tomorrow; that is precisely what the snapshot exists to stop.
import { Types } from 'mongoose';
import { LEAVE_BLOCKING_STATUSES } from '@ecms/contracts';
import { LeaveLedgerModel } from '../../leave-management/leave-balances/leave-ledger.model';
import { LeaveRequestModel } from '../../leave-management/leave-requests/leave-request.model';
import { LeaveTypeModel } from '../../leave-management/leave-types/leave-type.model';
import { type ConsumedLeave } from './leave-allocation';

/** One consumption as the ledger holds it, plus the identifiers a snapshot row needs. */
export interface ConsumedLeaveEntry extends ConsumedLeave {
  ledgerEntryId: string;
  employeeId: string;
  requestId: string | null;
  typeId: string;
  typeCode: string;
}

export interface LeaveFactsPort {
  /** Consumptions whose dated span touches the window, with their undated pay split. */
  consumedIn(window: { from: Date; to: Date }): Promise<ConsumedLeaveEntry[]>;
  /**
   * Requests still in flight over the window.
   *
   * A request that has not been consumed yet has no ledger entry and no breakdown, so freezing a
   * period containing one would snapshot a silent hole. The run refuses instead.
   */
  unsettledRequestsIn(window: { from: Date; to: Date }): Promise<number>;
}

export const leaveFactsPort: LeaveFactsPort = {
  async consumedIn(window) {
    const rows = await LeaveLedgerModel.find({
      kind: 'consume',
      effectiveFrom: { $ne: null, $lte: window.to },
      effectiveTo: { $ne: null, $gte: window.from },
    })
      .sort({ employeeId: 1, effectiveFrom: 1, _id: 1 })
      .lean()
      .exec();
    if (rows.length === 0) return [];

    // The type code travels onto the snapshot so a row reads without a join later.
    const typeIds = [...new Set(rows.map((row) => String(row.typeId)))];
    const types = await LeaveTypeModel.find({
      _id: { $in: typeIds.map((id) => new Types.ObjectId(id)) },
    })
      .lean<{ _id: unknown; code: string }[]>()
      .exec();
    const codeById = new Map(types.map((type) => [String(type._id), type.code]));

    return rows.map((row) => ({
      ledgerEntryId: String(row._id),
      employeeId: String(row.employeeId),
      requestId: row.requestId === null ? null : String(row.requestId),
      typeId: String(row.typeId),
      typeCode: codeById.get(String(row.typeId)) ?? '',
      from: row.effectiveFrom as Date,
      to: row.effectiveTo as Date,
      days: row.days,
      breakdown: row.paidBreakdown,
    }));
  },

  async unsettledRequestsIn(window) {
    return LeaveRequestModel.countDocuments({
      status: { $in: [...LEAVE_BLOCKING_STATUSES] },
      startDate: { $lte: window.to },
      endDate: { $gte: window.from },
      isDeleted: false,
    }).exec();
  },
};
