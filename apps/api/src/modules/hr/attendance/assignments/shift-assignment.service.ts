// Shift-assignment service, including `resolveShiftIdForDate` — the one rule the derivation
// engine calls to answer "which shift was this employee meant to work on this date?".
//
// Resolution (D2): among assignments whose interval covers the date, a BOUNDED interval wins
// over the open one (an override is more specific than the standing assignment), and among
// bounded ones the later `fromDate` wins (the most recently anchored override). Pure and
// exported so the engine's tests exercise it without a database.
import { Types } from 'mongoose';
import {
  type CreateShiftAssignment,
  type JobValueSource,
  type ListShiftAssignmentsQuery,
  type Paginated,
  type ShiftAssignmentDto,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { jobTitleService } from '../../../../platform/organization';
import { employeeRepository } from '../../employee-management/employees';
import { shiftService } from '../shifts';
import { ShiftAssignmentModel, type ShiftAssignmentDoc } from './shift-assignment.model';
import { shiftAssignmentRepository } from './shift-assignment.repository';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'attendanceShiftAssignment',
  entityId: id,
});

export const toShiftAssignmentDto = (doc: ShiftAssignmentDoc): ShiftAssignmentDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  shiftId: String(doc.shiftId),
  fromDate: doc.fromDate.toISOString().slice(0, 10),
  toDate: doc.toDate === null ? null : doc.toDate.toISOString().slice(0, 10),
  note: doc.note,
  branchId: doc.branchId === null ? null : String(doc.branchId),
  source: doc.source ?? 'manual',
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

/**
 * Does this shift follow the employee's job, or depart from it? (P-HR-22 — D-JOB-5 option A.)
 *
 * DERIVED, never accepted from the caller: a client that could declare its own provenance could
 * declare a departure to be compliance, and the whole value of the field is that a future
 * re-apply can trust it.
 *
 * A job that lists no candidates yields `manual` for everyone — correct rather than convenient,
 * because there is no default to be following. The job is read leniently for the same reason the
 * salary default is: assignment must not start failing over a catalog row it never needed before.
 */
const sourceOfChoice = async (jobTitleId: string, shiftId: string): Promise<JobValueSource> => {
  const title = await jobTitleService.getById(jobTitleId).catch(() => null);
  const candidates = title?.defaultShiftIds ?? [];
  return candidates.some((id) => String(id) === shiftId) ? 'jobDefault' : 'manual';
};

/** Interval covers the date-only value (inclusive on both ends; open end = forever). */
const covers = (a: Pick<ShiftAssignmentDoc, 'fromDate' | 'toDate'>, date: Date): boolean =>
  a.fromDate.getTime() <= date.getTime() &&
  (a.toDate === null || a.toDate.getTime() >= date.getTime());

/**
 * The winner among covering assignments — bounded beats open, later anchor beats earlier.
 * Exported pure for the engine's tests.
 */
export const pickAssignmentForDate = <T extends Pick<ShiftAssignmentDoc, 'fromDate' | 'toDate'>>(
  assignments: readonly T[],
  date: Date,
): T | null => {
  const covering = assignments.filter((a) => covers(a, date));
  if (covering.length === 0) return null;
  const bounded = covering.filter((a) => a.toDate !== null);
  const pool = bounded.length > 0 ? bounded : covering;
  return pool.reduce((best, a) => (a.fromDate.getTime() > best.fromDate.getTime() ? a : best));
};

class ShiftAssignmentService {
  async list(query: ListShiftAssignmentsQuery): Promise<Paginated<ShiftAssignmentDoc>> {
    return shiftAssignmentRepository.listAssignments(query);
  }

  async create(ctx: AuthContext, input: CreateShiftAssignment): Promise<ShiftAssignmentDoc> {
    const employee = await employeeRepository.findById(input.employeeId);
    if (employee === null) throw new NotFoundError('employee not found');
    await shiftService.getActiveById(input.shiftId);

    if (input.toDate == null) {
      const open = await shiftAssignmentRepository.findOpenForEmployee(input.employeeId);
      if (open !== null) {
        throw new BusinessRuleError(
          'this employee already has a current assignment — end it (or record a bounded override) first',
        );
      }
    }

    const doc = await shiftAssignmentRepository.create(
      {
        employeeId: new Types.ObjectId(input.employeeId),
        shiftId: new Types.ObjectId(input.shiftId),
        fromDate: input.fromDate,
        toDate: input.toDate ?? null,
        note: input.note ?? null,
        branchId: employee.employment.branchId,
        source: await sourceOfChoice(String(employee.employment.jobTitleId), input.shiftId),
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'employeeId', old: null, new: String(doc.employeeId) },
        { field: 'shiftId', old: null, new: String(doc.shiftId) },
        { field: 'fromDate', old: null, new: doc.fromDate.toISOString().slice(0, 10) },
        {
          field: 'toDate',
          old: null,
          new: doc.toDate === null ? null : doc.toDate.toISOString().slice(0, 10),
        },
      ],
    });
    return doc;
  }

  /** Soft delete (the standard base-repository delete) — history keeps the row. */
  async remove(ctx: AuthContext, id: string): Promise<void> {
    const doc = await shiftAssignmentRepository.findById(id);
    if (doc === null) throw new NotFoundError('shift assignment not found');
    await shiftAssignmentRepository.softDeleteById(id, { by: ctx.userId });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: [{ field: 'employeeId', old: String(doc.employeeId), new: null }],
    });
  }

  /** The engine's question. Reads every non-deleted assignment covering the date. */
  async resolveShiftIdForDate(employeeId: string, date: Date): Promise<string | null> {
    const rows = await ShiftAssignmentModel.find({
      employeeId: new Types.ObjectId(employeeId),
      isDeleted: false,
      fromDate: { $lte: date },
    })
      .lean<ShiftAssignmentDoc[]>()
      .exec();
    const winner = pickAssignmentForDate(rows, date);
    return winner === null ? null : String(winner.shiftId);
  }
}

export const shiftAssignmentService = new ShiftAssignmentService();
