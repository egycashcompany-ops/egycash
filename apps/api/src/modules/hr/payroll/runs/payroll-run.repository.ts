// Payroll-run data access. Organization-wide by nature: a run is a period, not a branch.
import { Types } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { PayrollRunModel, type PayrollRunDoc } from './payroll-run.model';

class PayrollRunRepository extends BaseRepository<PayrollRunDoc> {
  constructor() {
    super(PayrollRunModel, {}); // no branch or own axis — the period belongs to the organization
  }

  /**
   * Status of many runs at once — the batch read behind a payslip's `runStatus` (A1).
   *
   * Unscoped like every other batch label read, and for the same reason: it enriches rows the
   * caller has ALREADY been allowed to see, and a run carries no scope axis of its own anyway
   * (see the header). Projected to the status alone, so nothing else can leak through it.
   */
  async statusByIdsSystem(ids: readonly string[]): Promise<Map<string, PayrollRunDoc['status']>> {
    const valid = ids.filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return new Map();
    const rows = await this.model
      .find({ _id: { $in: valid.map((id) => new Types.ObjectId(id)) } })
      .select({ status: 1 })
      .lean<{ _id: Types.ObjectId; status: PayrollRunDoc['status'] }[]>()
      .exec();
    return new Map(rows.map((row) => [String(row._id), row.status]));
  }
}

export const payrollRunRepository = new PayrollRunRepository();
