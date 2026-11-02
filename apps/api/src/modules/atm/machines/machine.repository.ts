import { Types, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
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

  /**
   * The distinct stored values of `field` among the machines `filter` matches in the caller's
   * scope — what the list summary counts and what its dropdowns offer, before names are trimmed.
   */
  async distinctIn(
    field: 'bankName' | 'area',
    filter: FilterQuery<AtmMachineDoc>,
    scope: ScopeSelector,
  ): Promise<string[]> {
    return (await this.model.distinct(field, this.baseFilter(scope, filter)).exec()) as string[];
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

  /**
   * Every machine of one branch that is not deleted — active and archived — as the machine sync
   * compares a file with it (machines/sync). One query for the whole branch.
   */
  async listForSync(branchId: string): Promise<AtmMachineDoc[]> {
    return this.model
      .find({ isDeleted: false, branchId: new Types.ObjectId(branchId) })
      .select({ machineCode: 1, bankName: 1, name: 1, area: 1, isActive: 1 })
      .lean<AtmMachineDoc[]>()
      .exec();
  }

  /** Which of these codes are ACTIVE in a branch other than this one — never added here (DEC-9). */
  async activeCodesElsewhere(
    branchId: string,
    machineCodes: readonly string[],
  ): Promise<Set<string>> {
    if (machineCodes.length === 0) return new Set();
    const codes = (await this.model
      .distinct('machineCode', {
        isDeleted: false,
        isActive: true,
        branchId: { $ne: new Types.ObjectId(branchId) },
        machineCode: { $in: [...machineCodes] },
      })
      .exec()) as string[];
    return new Set(codes);
  }
}

export const atmMachineRepository = new AtmMachineRepository();
