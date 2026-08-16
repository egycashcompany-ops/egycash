import { Types } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import {
  CostCenterAssignmentModel,
  type CostCenterAssignmentDoc,
} from './cost-center-assignment.model';

class CostCenterAssignmentRepository extends BaseRepository<CostCenterAssignmentDoc> {
  constructor() {
    super(CostCenterAssignmentModel, { branchField: 'branchId' });
  }

  /** One employee's whole history, oldest first. */
  async listForEmployee(employeeId: string): Promise<CostCenterAssignmentDoc[]> {
    return this.model
      .find({ employeeId: new Types.ObjectId(employeeId), isDeleted: false })
      .sort({ effectiveFrom: 1 })
      .lean<CostCenterAssignmentDoc[]>()
      .exec();
  }

  /**
   * An existing interval that would collide with `[from, to]` for this employee.
   *
   * The same two conditions the pay-item assignment uses, and for the same reason: on any given
   * day exactly one centre is in force, or none — so nothing downstream ever has to choose
   * between two rows. Unlike pay items, the check is per EMPLOYEE rather than per employee × item:
   * a person may hold many pay items at once but only ever one cost centre.
   */
  async findOverlapping(
    employeeId: string,
    from: Date,
    to: Date | null,
    excludeId?: string,
  ): Promise<CostCenterAssignmentDoc | null> {
    return this.model
      .findOne({
        employeeId: new Types.ObjectId(employeeId),
        isDeleted: false,
        ...(excludeId === undefined ? {} : { _id: { $ne: new Types.ObjectId(excludeId) } }),
        // the existing row ends on or after the candidate starts (or never ends)
        $or: [{ effectiveTo: null }, { effectiveTo: { $gte: from } }],
        // and starts on or before the candidate ends (vacuous when the candidate is open-ended)
        ...(to === null ? {} : { effectiveFrom: { $lte: to } }),
      })
      .sort({ effectiveFrom: 1 })
      .lean<CostCenterAssignmentDoc>()
      .exec();
  }

  /**
   * The rows covering `on` for these employees — ONE query for a whole payroll population.
   *
   * System-scoped by design: the caller is the payslip issue pass, which has already decided the
   * population from the run. Per-employee queries here would turn a payroll run into a few hundred
   * round trips for a label.
   */
  async coveringSystem(
    employeeIds: readonly string[],
    on: Date,
  ): Promise<CostCenterAssignmentDoc[]> {
    if (employeeIds.length === 0) return [];
    return this.model
      .find({
        employeeId: { $in: employeeIds.map((id) => new Types.ObjectId(id)) },
        isDeleted: false,
        effectiveFrom: { $lte: on },
        $or: [{ effectiveTo: null }, { effectiveTo: { $gte: on } }],
      })
      .lean<CostCenterAssignmentDoc[]>()
      .exec();
  }
}

export const costCenterAssignmentRepository = new CostCenterAssignmentRepository();
