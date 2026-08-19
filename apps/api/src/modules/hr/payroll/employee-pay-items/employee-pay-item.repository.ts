// Employee pay-item data access.
//
// Visibility is INHERITED FROM THE EMPLOYEE — the caller scopes the employee first and these rows
// follow, the same contract Personnel Actions have. So no query here takes a `ScopeSelector`:
// reaching this layer at all already means the employee was resolved inside the caller's scope.
import { Types } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { NotFoundError } from '../../../../shared/errors';
import { EmployeePayItemModel, type EmployeePayItemDoc } from './employee-pay-item.model';

class EmployeePayItemRepository extends BaseRepository<EmployeePayItemDoc> {
  constructor() {
    super(EmployeePayItemModel, { branchField: 'branchId', departmentField: 'departmentId' });
  }

  async getForEmployee(employeeId: string, id: string): Promise<EmployeePayItemDoc> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundError('employee pay item not found');
    const doc = await EmployeePayItemModel.findOne({
      _id: new Types.ObjectId(id),
      employeeId: new Types.ObjectId(employeeId),
      isDeleted: false,
    })
      .lean<EmployeePayItemDoc>()
      .exec();
    if (doc === null) throw new NotFoundError('employee pay item not found');
    return doc;
  }

  /**
   * The assignments for one employee × one item whose interval intersects [from, to].
   *
   * Two inclusive intervals overlap when each starts on or before the other ends, with a null end
   * meaning "never ends". An open-ended candidate therefore has no upper condition at all — it
   * runs past every existing row by definition.
   */
  async findOverlapping(
    employeeId: string,
    payItemId: string,
    from: Date,
    to: Date | null,
  ): Promise<EmployeePayItemDoc | null> {
    return EmployeePayItemModel.findOne({
      employeeId: new Types.ObjectId(employeeId),
      payItemId: new Types.ObjectId(payItemId),
      isDeleted: false,
      // the existing row ends on or after the candidate starts (or never ends)
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: from } }],
      // and starts on or before the candidate ends (vacuous when the candidate is open-ended)
      ...(to === null ? {} : { effectiveFrom: { $lte: to } }),
    })
      .sort({ effectiveFrom: 1 })
      .lean<EmployeePayItemDoc>()
      .exec();
  }

  /** True while any assignment — live, ended or future — still cites this catalog item. */
  async isPayItemInUse(payItemId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(payItemId)) return false;
    const used = await EmployeePayItemModel.exists({
      payItemId: new Types.ObjectId(payItemId),
      isDeleted: false,
    }).exec();
    return used !== null;
  }
}

export const employeePayItemRepository = new EmployeePayItemRepository();
