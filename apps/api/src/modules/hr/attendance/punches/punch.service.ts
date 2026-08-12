// Punch service (D1/D9). Records and imports only — there is deliberately NO update and NO
// delete on this collection: a punch is evidence, and a wrong one is superseded by a new record
// that points back at it. The import is idempotent through the unique {deviceId, at, employeeId}
// key, and rows outside the sanity window are QUARANTINED in the response rather than silently
// dropped (§13) — an import that ate rows without saying so would be indistinguishable from a
// device that never recorded them.
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  HrAttendanceEvents,
  HrAttendanceSettingKeys,
  type AttendancePunchDto,
  type ImportPunches,
  type ImportPunchesResultDto,
  type ListPunchesQuery,
  type Paginated,
  type RecordPunch,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { settingsService } from '../../../../platform/settings';
import { employeeRepository } from '../../employee-management/employees';
import { AttendancePunchModel, type AttendancePunchDoc } from './punch.model';
import { punchRepository } from './punch.repository';

const ORG_SUBJECT = { userId: null, branchId: null };
const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'attendancePunch', entityId: id });

/**
 * Sanity window for punch instants (§13 clock-drift mitigation): nothing older than 90 days,
 * nothing more than an hour in the future. A constant rather than a setting — the v1.1 settings
 * list is closed at four, and a window nobody has asked to move does not earn a fifth.
 */
export const PUNCH_MAX_AGE_DAYS = 90;
export const PUNCH_MAX_FUTURE_MS = 60 * 60 * 1000;

/** null when acceptable; the quarantine reason otherwise. Pure, tested directly. */
export const punchWindowProblem = (at: Date, now: Date): string | null => {
  if (Number.isNaN(at.getTime())) return 'invalid timestamp';
  if (at.getTime() > now.getTime() + PUNCH_MAX_FUTURE_MS) return 'timestamp is in the future';
  if (at.getTime() < now.getTime() - PUNCH_MAX_AGE_DAYS * 86_400_000) {
    return `timestamp is older than ${String(PUNCH_MAX_AGE_DAYS)} days`;
  }
  return null;
};

export const toPunchDto = (doc: AttendancePunchDoc): AttendancePunchDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  at: doc.at.toISOString(),
  direction: doc.direction,
  source: doc.source,
  deviceId: doc.deviceId,
  branchIdAtPunch: doc.branchIdAtPunch === null ? null : String(doc.branchIdAtPunch),
  importBatchId: doc.importBatchId,
  supersededBy: doc.supersededBy === null ? null : String(doc.supersededBy),
  note: doc.note,
  recordedBy: doc.recordedBy === null ? null : String(doc.recordedBy),
  createdAt: doc.createdAt.toISOString(),
});

class PunchService {
  async list(query: ListPunchesQuery): Promise<Paginated<AttendancePunchDoc>> {
    return punchRepository.listPunches(query);
  }

  /** Manual entry (HR) or — once the D1 setting is on — a web self-punch. */
  async record(ctx: AuthContext, input: RecordPunch): Promise<AttendancePunchDoc> {
    const employee = await employeeRepository.findById(input.employeeId);
    if (employee === null) throw new NotFoundError('employee not found');

    if (input.source === 'web') {
      const enabled = await settingsService.resolve<boolean>(
        HrAttendanceSettingKeys.SelfPunchEnabled,
        ORG_SUBJECT,
      );
      if (!enabled) {
        throw new BusinessRuleError('web self-punch is disabled (hr.attendance.selfPunchEnabled)');
      }
    }

    const problem = punchWindowProblem(input.at, new Date());
    if (problem !== null) throw new BusinessRuleError(`punch refused: ${problem}`);

    let superseded: AttendancePunchDoc | null = null;
    if (input.supersedesId !== undefined) {
      superseded = await punchRepository.findById(input.supersedesId);
      if (superseded === null) throw new NotFoundError('punch to supersede not found');
      if (superseded.supersededBy !== null) {
        throw new BusinessRuleError('that punch has already been superseded');
      }
      if (String(superseded.employeeId) !== input.employeeId) {
        throw new BusinessRuleError('a punch may only be superseded for the same employee');
      }
    }

    const doc = await punchRepository.create(
      {
        employeeId: new Types.ObjectId(input.employeeId),
        at: input.at,
        direction: input.direction,
        source: input.source,
        deviceId: null,
        branchIdAtPunch:
          input.branchIdAtPunch !== undefined
            ? new Types.ObjectId(input.branchIdAtPunch)
            : employee.employment.branchId,
        importBatchId: null,
        note: input.note ?? null,
        recordedBy: ctx.userId === null ? null : new Types.ObjectId(ctx.userId),
      },
      { by: ctx.userId },
    );

    if (superseded !== null) {
      // The one write this collection permits: stamping the supersession pointer, once.
      await AttendancePunchModel.updateOne(
        { _id: superseded._id, supersededBy: null },
        { $set: { supersededBy: doc._id } },
      ).exec();
    }

    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'at', old: null, new: doc.at.toISOString() },
        { field: 'source', old: null, new: doc.source },
        ...(superseded === null
          ? []
          : [{ field: 'supersedes', old: null, new: String(superseded._id) }]),
      ],
    });
    await emit(HrAttendanceEvents.PunchRecorded, {
      punchId: String(doc._id),
      employeeId: String(doc.employeeId),
      at: doc.at.toISOString(),
      direction: doc.direction,
      source: doc.source,
    });
    return doc;
  }

  /**
   * Device import. Row outcomes are disjoint: imported, duplicate (unique key hit — idempotent
   * re-import) or quarantined with a reason. One audit record carries the batch totals.
   */
  async import(ctx: AuthContext, input: ImportPunches): Promise<ImportPunchesResultDto> {
    const batchId = randomUUID();
    const now = new Date();
    let imported = 0;
    let duplicates = 0;
    const quarantined: { index: number; reason: string }[] = [];

    // Employee lookup once per distinct number — device exports repeat the same person all day.
    const byNumber = new Map<string, { id: Types.ObjectId; branchId: Types.ObjectId } | null>();
    for (const [index, row] of input.rows.entries()) {
      const windowProblem = punchWindowProblem(row.at, now);
      if (windowProblem !== null) {
        quarantined.push({ index, reason: windowProblem });
        continue;
      }
      if (!byNumber.has(row.employeeNumber)) {
        const employee = await employeeRepository.findByEmployeeNumberSystem(row.employeeNumber);
        byNumber.set(
          row.employeeNumber,
          employee === null
            ? null
            : { id: employee._id as Types.ObjectId, branchId: employee.employment.branchId },
        );
      }
      const employee = byNumber.get(row.employeeNumber) ?? null;
      if (employee === null) {
        quarantined.push({ index, reason: `unknown employeeNumber ${row.employeeNumber}` });
        continue;
      }
      try {
        await punchRepository.create(
          {
            employeeId: employee.id,
            at: row.at,
            direction: row.direction,
            source: 'device',
            deviceId: row.deviceId,
            branchIdAtPunch: employee.branchId,
            importBatchId: batchId,
            note: null,
            recordedBy: ctx.userId === null ? null : new Types.ObjectId(ctx.userId),
          },
          { by: ctx.userId },
        );
        imported += 1;
      } catch (error) {
        // ConflictError from the unique {deviceId, at, employeeId} key = an idempotent re-import.
        if (error instanceof ConflictError) duplicates += 1;
        else throw error;
      }
    }

    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'attendancePunchBatch', entityId: batchId },
      action: 'attendancePunchImport',
      changes: [
        { field: 'rows', old: null, new: String(input.rows.length) },
        { field: 'imported', old: null, new: String(imported) },
        { field: 'duplicates', old: null, new: String(duplicates) },
        { field: 'quarantined', old: null, new: String(quarantined.length) },
        ...(input.fileId === undefined
          ? []
          : [{ field: 'fileId', old: null, new: input.fileId }]),
      ],
    });
    await emit(HrAttendanceEvents.PunchesImported, {
      batchId,
      imported,
      duplicates,
      quarantined: quarantined.length,
    });
    return { batchId, imported, duplicates, quarantined };
  }
}

export const punchService = new PunchService();
