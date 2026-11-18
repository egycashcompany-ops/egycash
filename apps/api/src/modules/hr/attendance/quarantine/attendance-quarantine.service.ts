// The quarantine's read, retry and report (Task 2 §4).
//
// THE RETRY IS AN IMPORT. It rebuilds the stored rows exactly as the device sent them and hands
// them to `punchService.import`, which is the only thing in this module that knows how a device row
// becomes a punch. Reimplementing that resolution here would give the history a second set of
// rules — one that could accept a row the live path refuses, or attribute it differently — and
// nobody would find out until a payslip disagreed with a day sheet.
//
// A DUPLICATE COUNTS AS RESOLVED. If the punch already exists, the row this note is about is in
// the database; leaving it pending would keep offering HR a job that is already done.
import { Types } from 'mongoose';
import {
  type AttendanceQuarantineRetryResultDto,
  type AttendanceQuarantineRowDto,
  type AttendanceUnmatchedIdDto,
  normalizeDeviceCode,
  normalizeEnrollmentNo,
  type DiscardAttendanceQuarantine,
  type ImportPunchRow,
  type ListAttendanceQuarantineQuery,
  type RetryAttendanceQuarantine,
} from '@ecms/contracts';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { logger } from '../../../../infrastructure/logging/logger';
import { enqueueMany } from '../../../../infrastructure/queue/jobs';
import { punchService } from '../punches/punch.service';
import {
  AttendanceQuarantineModel,
  type AttendanceQuarantineDoc,
} from './attendance-quarantine.model';

/** Fired when somebody links an enrolment: the scans waiting on that link are tried at once. */
export const RETRY_QUARANTINE_JOB = 'hr.attendance.retryQuarantine';

export const toQuarantineRowDto = (
  doc: AttendanceQuarantineDoc,
): AttendanceQuarantineRowDto => ({
  id: String(doc._id),
  batchId: doc.batchId,
  deviceId: doc.deviceId,
  enrollmentNo: doc.enrollmentNo,
  employeeNumber: doc.employeeNumber,
  at: doc.at.toISOString(),
  direction: doc.direction,
  reason: doc.reason,
  status: doc.status,
  retries: doc.retries,
  firstSeenAt: doc.firstSeenAt.toISOString(),
  lastTriedAt: doc.lastTriedAt === null ? null : doc.lastTriedAt.toISOString(),
  resolvedAt: doc.resolvedAt === null ? null : doc.resolvedAt.toISOString(),
});

const toImportRow = (doc: AttendanceQuarantineDoc): ImportPunchRow =>
  ({
    at: doc.at,
    direction: doc.direction,
    deviceId: doc.deviceId,
    ...(doc.enrollmentNo === null ? {} : { enrollmentNo: doc.enrollmentNo }),
    ...(doc.employeeNumber === null ? {} : { employeeNumber: doc.employeeNumber }),
  }) as ImportPunchRow;

class AttendanceQuarantineService {
  async list(query: ListAttendanceQuarantineQuery): Promise<AttendanceQuarantineRowDto[]> {
    const docs = await AttendanceQuarantineModel.find({
      status: query.status,
      isDeleted: false,
      ...(query.deviceId === undefined
        ? {}
        : { deviceId: normalizeDeviceCode(query.deviceId) }),
    })
      .sort({ at: 1 })
      .limit(query.limit)
      .exec();
    return docs.map(toQuarantineRowDto);
  }

  /**
   * THE «LINK OR IGNORE» REPORT. One grouped pass over the pending rows, keyed on the identity the
   * device sent, so 62,000 unplaceable scans read as a list of machine ids with a row count and a
   * span beside each — which is a morning's work for HR, where the rows themselves are not.
   */
  async unmatched(): Promise<AttendanceUnmatchedIdDto[]> {
    const rows = await AttendanceQuarantineModel.aggregate<{
      _id: {
        deviceId: string;
        enrollmentNo: string | null;
        employeeNumber: string | null;
        reason: string;
      };
      rows: number;
      firstAt: Date;
      lastAt: Date;
    }>([
      { $match: { status: 'pending', isDeleted: false } },
      {
        $group: {
          _id: {
            deviceId: '$deviceId',
            enrollmentNo: '$enrollmentNo',
            employeeNumber: '$employeeNumber',
            // The reason is part of the key: «this id is not mapped» and «this device is not
            // registered» are two different jobs, and merging them would hide one behind the other.
            reason: '$reason',
          },
          rows: { $sum: 1 },
          firstAt: { $min: '$at' },
          lastAt: { $max: '$at' },
        },
      },
      { $sort: { rows: -1 } },
      { $limit: 1_000 },
    ]).exec();
    return rows.map((row) => ({
      deviceId: row._id.deviceId,
      enrollmentNo: row._id.enrollmentNo,
      employeeNumber: row._id.employeeNumber,
      reason: row._id.reason,
      rows: row.rows,
      firstAt: row.firstAt.toISOString(),
      lastAt: row.lastAt.toISOString(),
    }));
  }

  /** Hand the pending rows back to the import. Rows that now resolve become punches. */
  async retry(
    ctx: AuthContext,
    input: RetryAttendanceQuarantine,
  ): Promise<AttendanceQuarantineRetryResultDto> {
    const pending = await AttendanceQuarantineModel.find({
      status: 'pending',
      isDeleted: false,
      ...(input.deviceId === undefined
        ? {}
        : { deviceId: normalizeDeviceCode(input.deviceId) }),
      ...(input.enrollmentNo === undefined
        ? {}
        : { enrollmentNo: normalizeEnrollmentNo(input.enrollmentNo) }),
    })
      .sort({ at: 1 })
      .limit(input.limit)
      .exec();
    if (pending.length === 0) {
      return {
        tried: 0,
        imported: 0,
        duplicates: 0,
        stillQuarantined: 0,
        onFrozenDays: 0,
        batchId: null,
      };
    }

    const result = await punchService.import(ctx, { rows: pending.map(toImportRow) });
    const stillBad = new Map(result.quarantined.map((q) => [q.index, q.reason]));
    const now = new Date();
    const resolved: Types.ObjectId[] = [];
    for (const [index, doc] of pending.entries()) {
      if (stillBad.has(index)) continue;
      resolved.push(doc._id);
    }
    if (resolved.length > 0) {
      await AttendanceQuarantineModel.updateMany(
        { _id: { $in: resolved } },
        { $set: { status: 'imported', resolvedAt: now, lastTriedAt: now }, $inc: { retries: 1 } },
      ).exec();
    }
    const stillIds = pending
      .filter((_, index) => stillBad.has(index))
      .map((doc) => doc._id);
    if (stillIds.length > 0) {
      await AttendanceQuarantineModel.updateMany(
        { _id: { $in: stillIds } },
        { $set: { lastTriedAt: now }, $inc: { retries: 1 } },
      ).exec();
    }

    await auditService.record({
      entityRef: {
        moduleId: 'hr',
        entityType: 'attendancePunchBatch',
        entityId: result.batchId,
      },
      action: 'attendancePunchImport',
      changes: [
        { field: 'source', old: null, new: 'quarantineRetry' },
        { field: 'tried', old: null, new: String(pending.length) },
        { field: 'imported', old: null, new: String(result.imported) },
        { field: 'duplicates', old: null, new: String(result.duplicates) },
        { field: 'stillQuarantined', old: null, new: String(stillBad.size) },
      ],
    });

    return {
      tried: pending.length,
      imported: result.imported,
      duplicates: result.duplicates,
      stillQuarantined: stillBad.size,
      onFrozenDays: result.onFrozenDays,
      batchId: result.batchId,
    };
  }

  /**
   * «Ignore them» — an id that will never be a person here stops being offered.
   *
   * It deletes nothing and writes no punch: the rows stay, marked, so a later «why is there no
   * attendance for this machine id» has an answer. A device re-sending the same scan creates a
   * fresh pending row, because the unique key is partial on `pending` — which is right: somebody
   * discarding last year's rows was not promising anything about next year's.
   */
  async discard(ctx: AuthContext, input: DiscardAttendanceQuarantine): Promise<number> {
    const filter = {
      status: 'pending' as const,
      isDeleted: false,
      ...(input.ids === undefined
        ? {}
        : { _id: { $in: input.ids.map((id) => new Types.ObjectId(id)) } }),
      ...(input.deviceId === undefined
        ? {}
        : { deviceId: normalizeDeviceCode(input.deviceId) }),
      ...(input.enrollmentNo === undefined
        ? {}
        : { enrollmentNo: normalizeEnrollmentNo(input.enrollmentNo) }),
      ...(input.employeeNumber === undefined ? {} : { employeeNumber: input.employeeNumber }),
    };
    const res = await AttendanceQuarantineModel.updateMany(filter, {
      $set: {
        status: 'discarded',
        resolvedAt: new Date(),
        updatedBy: ctx.userId === null ? null : new Types.ObjectId(ctx.userId),
      },
    }).exec();
    if (res.modifiedCount > 0) {
      await auditService.record({
        entityRef: { moduleId: 'hr', entityType: 'attendanceQuarantine', entityId: 'batch' },
        action: 'update',
        changes: [
          { field: 'status', old: 'pending', new: 'discarded' },
          { field: 'rows', old: null, new: String(res.modifiedCount) },
          { field: 'deviceId', old: null, new: input.deviceId ?? 'any' },
          { field: 'enrollmentNo', old: null, new: input.enrollmentNo ?? 'any' },
        ],
      });
    }
    return res.modifiedCount;
  }

  /** Are there rows waiting on this enrolment? Asked before queueing a retry for it. */
  async pendingFor(deviceId: Types.ObjectId | string, enrollmentNo: string): Promise<number> {
    return AttendanceQuarantineModel.countDocuments({
      status: 'pending',
      isDeleted: false,
      deviceId: normalizeDeviceCode(String(deviceId)),
      enrollmentNo: normalizeEnrollmentNo(enrollmentNo),
    }).exec();
  }
}

export const attendanceQuarantineService = new AttendanceQuarantineService();

/**
 * Queue a retry for one newly-linked enrolment. Called by the enrolment service AFTER the link is
 * written, and deliberately on the queue rather than inline: linking a finger must not wait on
 * two years of that person's scans being imported, and a retry that fails must not fail the link.
 */
export const queueQuarantineRetry = async (
  deviceCode: string,
  enrollmentNo: string,
  byUserId: string,
): Promise<void> => {
  try {
    await enqueueMany('scheduled', [
      { name: RETRY_QUARANTINE_JOB, data: { deviceId: deviceCode, enrollmentNo, byUserId } },
    ]);
  } catch (error) {
    // The link is the act; recovering the history is a courtesy on top of it, and the manual
    // `POST /quarantine/retry` is always there.
    logger.error({ err: error, deviceCode, enrollmentNo }, 'attendance: quarantine retry not queued');
  }
};

export const attendanceQuarantineJobHandlers = [
  {
    queue: 'scheduled' as const,
    jobName: RETRY_QUARANTINE_JOB,
    handler: async (data: unknown): Promise<void> => {
      const payload = data as {
        deviceId?: unknown;
        enrollmentNo?: unknown;
        byUserId?: unknown;
      };
      if (
        typeof payload.deviceId !== 'string' ||
        typeof payload.enrollmentNo !== 'string' ||
        typeof payload.byUserId !== 'string'
      ) {
        logger.error({ data }, 'attendance: quarantine retry job without a device and enrolment');
        return;
      }
      // UNDER THE LINKER'S AUTHORITY, carried in the payload rather than invented here. The person
      // who said «this machine id is this employee» is the person whose assertion recovers those
      // scans, and the import's audit row should carry their name, not a system placeholder.
      await attendanceQuarantineService.retry(
        {
          userId: payload.byUserId,
          sessionId: 'job',
          branchId: null,
          departmentId: null,
          sectionId: null,
          locale: 'en',
          permissions: {},
          permissionVersion: 1,
          isPrivileged: true,
        },
        { deviceId: payload.deviceId, enrollmentNo: payload.enrollmentNo, limit: 5_000 },
      );
    },
  },
];
