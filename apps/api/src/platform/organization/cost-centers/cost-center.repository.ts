import { BaseRepository } from '../../../shared/base/base.repository';
import { CostCenterModel, type CostCenterDoc } from './cost-center.model';

class CostCenterRepository extends BaseRepository<CostCenterDoc> {
  constructor() {
    super(CostCenterModel, {}); // organization-wide catalog, no branch scope
  }

  /**
   * Names for these ids, for a caller that already holds the rows referencing them.
   *
   * System-scoped on purpose and named so: a label is not a reach. The callers are an employee's
   * own assignment list and the payslip issue pass, both of which have already been scoped by the
   * employee they are working on.
   */
  async byIdsSystem(ids: readonly string[]): Promise<Map<string, CostCenterDoc>> {
    if (ids.length === 0) return new Map();
    const rows = await this.model
      .find({ _id: { $in: [...ids] }, isDeleted: false })
      .lean<CostCenterDoc[]>()
      .exec();
    return new Map(rows.map((row) => [String(row._id), row]));
  }
}

export const costCenterRepository = new CostCenterRepository();
