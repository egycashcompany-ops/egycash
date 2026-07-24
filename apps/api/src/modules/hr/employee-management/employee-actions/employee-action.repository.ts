// Personnel Actions data access. Actions inherit their visibility from the employee (callers
// scope the employee first); the due-work scan is deliberately unscoped (scheduler flow).
import { Types } from 'mongoose';
import { EMPLOYEE_EXIT_TYPES, type ListEmployeeActionsQuery, type Paginated } from '@ecms/contracts';
import { NotFoundError } from '../../../../shared/errors';
import { EmployeeActionModel, type EmployeeActionDoc, type EmployeeActionEntity } from './employee-action.model';

class EmployeeActionRepository {
  /**
   * Record the `hire` action (seq 1) for a newly created employee — every employment history
   * starts with it. Idempotent via the unique (employeeId, seq) index.
   */
  async recordHire(params: {
    employeeId: Types.ObjectId;
    employeeCode: string;
    hiredAt: Date;
    by: Types.ObjectId | null;
    entryStatus: 'probation' | 'active';
    origin: 'recruitment' | 'direct';
    note?: string;
  }): Promise<EmployeeActionDoc> {
    const existing = await EmployeeActionModel.findOne({ employeeId: params.employeeId, seq: 1 });
    if (existing !== null) return existing;
    return EmployeeActionModel.create({
      employeeId: params.employeeId,
      employeeCode: params.employeeCode,
      seq: 1,
      type: 'hire',
      status: 'applied',
      effectiveDate: params.hiredAt,
      appliedAt: params.hiredAt,
      changes: [{ field: 'status', from: null, to: params.entryStatus }],
      payload: { origin: params.origin },
      reason: null,
      note: params.note ?? null,
      attachmentFileId: null,
      failureReason: null,
      cancelledAt: null,
      cancelledBy: null,
      by: params.by,
      createdBy: params.by,
      updatedBy: null,
      isDeleted: false,
    });
  }

  /** Migration helper: synthesize the hire action for a LEGACY employee (entered `active`). */
  async ensureHireAction(params: {
    employeeId: Types.ObjectId;
    employeeCode: string;
    hiredAt: Date;
    by: Types.ObjectId | null;
  }): Promise<EmployeeActionDoc> {
    return this.recordHire({
      ...params,
      entryStatus: 'active',
      origin: 'recruitment',
      note: 'Synthesized by the registry migration',
    });
  }

  async getForEmployee(employeeId: string, actionId: string): Promise<EmployeeActionEntity> {
    if (!Types.ObjectId.isValid(actionId)) throw new NotFoundError('personnel action not found');
    const doc = await EmployeeActionModel.findOne({
      _id: new Types.ObjectId(actionId),
      employeeId: new Types.ObjectId(employeeId),
      isDeleted: false,
    });
    if (doc === null) throw new NotFoundError('personnel action not found');
    return doc;
  }

  /** The earliest still-scheduled exit for the pending-exit rule (frozen design §3). */
  async findScheduledExit(employeeId: string): Promise<EmployeeActionDoc | null> {
    return EmployeeActionModel.findOne({
      employeeId: new Types.ObjectId(employeeId),
      status: 'scheduled',
      type: { $in: [...EMPLOYEE_EXIT_TYPES] },
      isDeleted: false,
    })
      .sort({ effectiveDate: 1 })
      .exec();
  }

  /** Pending scheduled actions (any type) — powers the UI's overlap warning (C1). */
  async findScheduled(employeeId: string): Promise<EmployeeActionDoc[]> {
    return EmployeeActionModel.find({
      employeeId: new Types.ObjectId(employeeId),
      status: 'scheduled',
      isDeleted: false,
    })
      .sort({ effectiveDate: 1 })
      .exec();
  }

  /**
   * Due scheduled actions, ordered (effectiveDate, seq) so each employee's history applies in
   * order even when several actions fall due together.
   */
  async findDueScheduled(asOf: Date): Promise<EmployeeActionEntity[]> {
    return EmployeeActionModel.find({
      status: 'scheduled',
      effectiveDate: { $lte: asOf },
      isDeleted: false,
    })
      .sort({ effectiveDate: 1, seq: 1 })
      .exec();
  }

  async listForEmployee(
    employeeId: string,
    query: ListEmployeeActionsQuery,
  ): Promise<Paginated<EmployeeActionDoc>> {
    const filter = {
      employeeId: new Types.ObjectId(employeeId),
      isDeleted: false,
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.status === undefined ? {} : { status: query.status }),
    };
    const page = query.page;
    const pageSize = query.pageSize;
    const [items, totalItems] = await Promise.all([
      EmployeeActionModel.find(filter)
        .sort({ seq: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      EmployeeActionModel.countDocuments(filter).exec(),
    ]);
    return {
      items,
      meta: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) },
    };
  }
}

export const employeeActionRepository = new EmployeeActionRepository();
