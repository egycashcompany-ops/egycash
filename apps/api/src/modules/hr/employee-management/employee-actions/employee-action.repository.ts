// Personnel Actions data access. Actions inherit their visibility from the employee (callers
// scope the employee first); the due-work scan is deliberately unscoped (scheduler flow).
import { Types } from 'mongoose';
import {
  EMPLOYEE_EXIT_TYPES,
  SALARY_BEARING_ACTION_TYPES,
  type ListEmployeeActionsQuery,
  type Paginated,
} from '@ecms/contracts';
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

  /**
   * Every APPLIED change this employee's basic salary has been through (PY-8).
   *
   * The action log is the only place a salary change is recorded with a date, and — since the
   * engine is the only thing that writes `employment.salary` after hire — it is a complete
   * history rather than a partial one. `from` is captured at APPLICATION time (see the model
   * header), which is what makes walking it backwards give the value that really was in force.
   *
   * Scheduled actions are excluded on purpose: they have not happened, and a future raise must
   * not change what a past month was worth. Cancelled and failed ones never touched the employee.
   */
  async listAppliedSalaryChanges(
    employeeId: string,
  ): Promise<{ effectiveDate: Date; from: unknown; to: unknown }[]> {
    const rows = await EmployeeActionModel.find({
      employeeId: new Types.ObjectId(employeeId),
      type: { $in: [...SALARY_BEARING_ACTION_TYPES] },
      status: 'applied',
      isDeleted: false,
      'changes.field': 'employment.salary',
    })
      .sort({ effectiveDate: 1, seq: 1 })
      .lean<{ effectiveDate: Date; changes: { field: string; from: unknown; to: unknown }[] }[]>()
      .exec();

    return rows.flatMap((row) => {
      const change = row.changes.find((c) => c.field === 'employment.salary');
      return change === undefined
        ? []
        : [{ effectiveDate: row.effectiveDate, from: change.from, to: change.to }];
    });
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
