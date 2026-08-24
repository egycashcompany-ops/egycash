import { Types, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { AtmMachineModel, type AtmMachineDoc } from './machine.model';

class AtmMachineRepository extends BaseRepository<AtmMachineDoc> {
  constructor() {
    // `branchField` makes the platform's branch scope (and ADR-028 narrowing) apply everywhere.
    super(AtmMachineModel, { branchField: 'branchId' });
  }

  /**
   * The active machine behind a code, in one branch — what an open form validates against.
   * ACTIVE ONLY: the legacy replenishment create validated against every machine ever stored,
   * deleted included (`Event6.find({})`, contad_app.js:657), while the mail reader validated
   * against active ones (Automation/src/index.js:149-153). The port resolves the disagreement to
   * the active set (port doc T7).
   */
  async findActiveByCode(branchId: string, machineCode: string): Promise<AtmMachineDoc | null> {
    const doc = await this.findOne({
      branchId: new Types.ObjectId(branchId),
      machineCode,
    } as FilterQuery<AtmMachineDoc>);
    return doc !== null && doc.isActive ? doc : null;
  }

  /** Batch form of the same lookup — one query for a 50-line paste, not 50. */
  async findActiveByCodes(
    branchId: string,
    machineCodes: readonly string[],
  ): Promise<Map<string, AtmMachineDoc>> {
    if (machineCodes.length === 0) return new Map();
    const rows = await this.model
      .find({
        isDeleted: false,
        isActive: true,
        branchId: new Types.ObjectId(branchId),
        machineCode: { $in: [...machineCodes] },
      })
      .lean<AtmMachineDoc[]>()
      .exec();
    return new Map(rows.map((row) => [row.machineCode, row]));
  }
}

export const atmMachineRepository = new AtmMachineRepository();
