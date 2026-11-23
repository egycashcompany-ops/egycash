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
  type ImportPunchRow,
  type ListPunchesQuery,
  type Paginated,
  type RecordPunch,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { settingsService } from '../../../../platform/settings';
import {
  addDays,
  cairoCalendarDate,
  cairoToday,
  dateOnlyIso,
  toDateOnly,
} from '../../shared/business-date';
import { logger } from '../../../../infrastructure/logging/logger';
// The direct file, NOT the `../day-records` barrel: the barrel re-exports the engine and the
// models, and reaching it from here would close an import cycle through this module's own barrel.
import { dayRecordService } from '../day-records/day-record.service';
import { AttendanceDayModel } from '../day-records/day-record.model';
import { employeeRepository } from '../../employee-management/employees';
import { attendanceDeviceRepository } from '../devices/attendance-device.repository';
import { attendanceEnrollmentRepository } from '../enrollments/attendance-enrollment.repository';
import { AttendancePunchModel, type AttendancePunchDoc } from './punch.model';
import { punchRepository } from './punch.repository';
import { holdQuarantinedRows, type HeldRow } from '../quarantine/attendance-quarantine.store';

/**
 * How far back an import derives the days it touched, in days before today.
 *
 * Three days: today and the two either side of it. A supervisor reads today and yesterday, and a
 * device that was offline overnight sends the day before. Everything older is history, and history
 * is the backfill's — resumable, with progress, and not holding a branch server's request open.
 */
const RECOMPUTE_WINDOW_DAYS = 3;

const ORG_SUBJECT = { userId: null, branchId: null };
const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'attendancePunch', entityId: id });

/**
 * Sanity window for punch instants (§13 clock-drift mitigation).
 *
 * THE FUTURE GUARD IS A CONSTANT AND STAYS ONE. A scan dated an hour from now is a device whose
 * clock is wrong, in every case anyone has ever had; no import of real history needs one.
 *
 * THE AGE GUARD IS NOT. It was 90 days, written as the same kind of sanity check — and it was
 * doing something else entirely. The branch machines hold 67,839 scans going back to December
 * 2024, and 62,505 of them had never reached ECMS: the branch app refuses to offer anything the
 * limit would reject, so two years of attendance was invisible here and nothing said why. It is
 * now `hr.attendance.importMaxAgeDays`, and it defaults to NO LIMIT.
 */
export const PUNCH_MAX_FUTURE_MS = 60 * 60 * 1000;

/**
 * null when acceptable; the quarantine reason otherwise. Pure, tested directly.
 *
 * `maxAgeDays` is the resolved setting: `null` or 0 means no limit. It is passed in rather than
 * read here so this stays a pure function of its inputs — one import batch reads the setting once
 * and holds every one of its thousands of rows to the same answer, which is also what keeps a
 * batch from being judged by two different limits if somebody changes it mid-import.
 */
export const punchWindowProblem = (
  at: Date,
  now: Date,
  maxAgeDays: number | null = null,
): string | null => {
  if (Number.isNaN(at.getTime())) return 'invalid timestamp';
  if (at.getTime() > now.getTime() + PUNCH_MAX_FUTURE_MS) return 'timestamp is in the future';
  if (
    maxAgeDays !== null &&
    maxAgeDays > 0 &&
    at.getTime() < now.getTime() - maxAgeDays * 86_400_000
  ) {
    return `timestamp is older than ${String(maxAgeDays)} days`;
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
  employeeBranchId: doc.employeeBranchId === null ? null : String(doc.employeeBranchId),
  importBatchId: doc.importBatchId,
  supersededBy: doc.supersededBy === null ? null : String(doc.supersededBy),
  note: doc.note,
  recordedBy: doc.recordedBy === null ? null : String(doc.recordedBy),
  createdAt: doc.createdAt.toISOString(),
});

class PunchService {
  async list(
    query: ListPunchesQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<AttendancePunchDoc>> {
    return punchRepository.listPunches(query, scope);
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
        // The reader's axis, always from the employee — never from the override above, which
        // says where the punch happened and may legitimately be somewhere else entirely.
        employeeBranchId: employee.employment.branchId,
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
    // Read ONCE for the batch: thousands of rows judged by one answer, and a setting changed
    // mid-import cannot split a batch into rows that were allowed and rows that were not.
    const maxAgeDays = await settingsService.resolve<number>(
      HrAttendanceSettingKeys.ImportMaxAgeDays,
      ORG_SUBJECT,
    );
    let imported = 0;
    let duplicates = 0;
    const quarantined: { index: number; reason: string }[] = [];
    /**
     * The rows that could not be placed, held for a retry as well as reported.
     *
     * Task 2 §4: 153 people are no longer on the branch machines and so have no enrolment link, so
     * their whole history quarantines on arrival — in a nightly batch nobody reads the response of.
     * `quarantined` stays exactly what it was (the §13 answer, by row index); `held` is the same
     * rows kept so that linking the enrolment tomorrow recovers the scans instead of needing the
     * device to send them again.
     */
    const held: HeldRow[] = [];
    const hold = (index: number, row: ImportPunchRow, reason: string): void => {
      quarantined.push({ index, reason });
      held.push({ row, reason });
    };
    /** `employeeId|YYYY-MM-DD` of every punch actually stored, for the frozen-day count below. */
    const storedDays: string[] = [];

    // Employee lookup once per distinct number — device exports repeat the same person all day.
    const byNumber = new Map<string, { id: Types.ObjectId; branchId: Types.ObjectId } | null>();
    // D12.5/D12.7 — the same once-per-distinct-value cache for the DEVICE, because a batch is
    // one device repeated thousands of times. Resolving it is what lets the punch record where it
    // physically happened instead of where its owner is filed.
    const byDevice = new Map<
      string,
      { id: Types.ObjectId; branchId: Types.ObjectId; isActive: boolean } | null
    >();
    // AT-D3 — the enrolment map, cached per `{device}:{enrolment}` for the same reason: a
    // device batch is a few hundred people repeated across thousands of rows.
    // `'orphaned'` is a THIRD outcome, not a missing one: a mapping that exists but points at an
    // employee who does not. It earns its own quarantine reason because «unmapped» would send
    // somebody to create a mapping that is already there.
    const byEnrollment = new Map<
      string,
      { id: Types.ObjectId; branchId: Types.ObjectId } | 'orphaned' | null
    >();
    for (const [index, row] of input.rows.entries()) {
      const windowProblem = punchWindowProblem(row.at, now, maxAgeDays);
      if (windowProblem !== null) {
        hold(index, row, windowProblem);
        continue;
      }
      // D12.5 — an unregistered device is QUARANTINED, never guessed at. Accepting it would mean
      // storing a punch whose location we cannot state, and the row would look identical to one
      // from a device somebody had actually placed. The reason travels in the response, so the
      // fix is «register the device», not «work out why rows vanished».
      //
      // AT-D3 moved this AHEAD of resolving the person, because an enrolment number means nothing
      // until the device it belongs to is known: `{deviceId, enrollmentNo}` is the key, so the
      // device has to be resolved first or the lookup has no namespace to look in.
      if (!byDevice.has(row.deviceId)) {
        const found = await attendanceDeviceRepository.findByCodeSystem(row.deviceId);
        byDevice.set(
          row.deviceId,
          found === null
            ? null
            : { id: found._id as Types.ObjectId, branchId: found.branchId, isActive: found.isActive },
        );
      }
      const device = byDevice.get(row.deviceId) ?? null;
      if (device === null) {
        hold(index, row, `unknown deviceId ${row.deviceId}`);
        continue;
      }
      if (!device.isActive) {
        hold(index, row, `device ${row.deviceId} is deactivated`);
        continue;
      }

      // WHO THIS ROW IS ABOUT. Exactly one of the two identities is present — the contract refuses
      // a row carrying both or neither — so this is a choice between two lookups, never a fallback
      // from one to the other. A fallback is what would let a mistyped enrolment quietly resolve
      // as an employee number that happens to exist.
      let employee: { id: Types.ObjectId; branchId: Types.ObjectId } | null;
      if (row.enrollmentNo !== undefined) {
        const key = `${String(device.id)}:${row.enrollmentNo}`;
        if (!byEnrollment.has(key)) {
          const mapped = await attendanceEnrollmentRepository.findByEnrollmentSystem(
            device.id,
            row.enrollmentNo,
          );
          // Resolved ONCE per distinct enrolment, current branch included. A mapping made before
          // the employee transferred carries the branch of that moment, and `employeeBranchId` on
          // a punch is the READER's axis — stamping it from a stale copy would hide the punch from
          // the branch that now owns the person. So the employee is re-read here rather than
          // trusted from the mapping, and cached with the mapping so a batch of thousands of rows
          // costs one read per person and not one per row.
          const current =
            mapped === null ? null : await employeeRepository.findById(String(mapped.employeeId));
          byEnrollment.set(
            key,
            mapped === null
              ? null
              : current === null
                ? 'orphaned'
                : { id: mapped.employeeId, branchId: current.employment.branchId },
          );
        }
        const resolved = byEnrollment.get(key) ?? null;
        if (resolved === null) {
          // Named, not silent, and named PRECISELY: the fix is «map this enrolment on this
          // device», which is a job somebody can do, unlike «some rows did not import».
          hold(index, row, `unmapped enrollmentNo ${row.enrollmentNo} on device ${row.deviceId}`);
          continue;
        }
        if (resolved === 'orphaned') {
          hold(
            index,
            row,
            `enrollmentNo ${row.enrollmentNo} maps to an employee that no longer exists`,
          );
          continue;
        }
        employee = resolved;
      } else {
        const employeeNumber = row.employeeNumber as string;
        if (!byNumber.has(employeeNumber)) {
          const found = await employeeRepository.findByEmployeeNumberSystem(employeeNumber);
          byNumber.set(
            employeeNumber,
            found === null
              ? null
              : { id: found._id as Types.ObjectId, branchId: found.employment.branchId },
          );
        }
        employee = byNumber.get(employeeNumber) ?? null;
        if (employee === null) {
          hold(index, row, `unknown employeeNumber ${employeeNumber}`);
          continue;
        }
      }
      try {
        await punchRepository.create(
          {
            employeeId: employee.id,
            at: row.at,
            direction: row.direction,
            source: 'device',
            deviceId: row.deviceId,
            // D12.7 — THE DEVICE'S branch, not the employee's. The field is documented as «where
            // the punch physically happened — evidence», and stamping the employee's own branch
            // made `crossBranchPunch` unable to fire on a device punch at all: the comparison was
            // a value against itself. This is the fix that gives that flag its meaning back.
            branchIdAtPunch: device.branchId,
            employeeBranchId: employee.branchId,
            importBatchId: batchId,
            note: null,
            recordedBy: ctx.userId === null ? null : new Types.ObjectId(ctx.userId),
          },
          { by: ctx.userId },
        );
        imported += 1;
        storedDays.push(`${String(employee.id)}|${dateOnlyIso(cairoCalendarDate(row.at))}`);
      } catch (error) {
        // ConflictError from the unique {deviceId, at, employeeId} key = an idempotent re-import.
        if (error instanceof ConflictError) duplicates += 1;
        else throw error;
      }
    }

    await holdQuarantinedRows(batchId, held);

    // HOW MUCH OF THIS LANDED IN A CLOSED MONTH. The punches are stored either way — they are
    // evidence — but no recompute will rewrite those day records, so a backfill that says
    // «12,000 imported» and nothing else would look complete while a season of it changed nothing.
    const onFrozenDays = await this.countOnFrozenDays(storedDays);

    // RE-DERIVE WHAT THIS BATCH TOUCHED, before answering.
    //
    // The import used to store punches and stop, leaving the derivation to whoever called
    // `days/recompute` next. The branch app does call it — but only for the employees in the
    // batch it just sent, and a check-out arriving in a later batch than its check-in therefore
    // depended on a second call that may not name the same person. That is the «حضر فقط» the owner
    // is looking at: a day concluded from the check-in alone and never revisited.
    //
    // It is BOUNDED BY RECENCY, which is the whole design. A history send of 26,000 rows spans two
    // years and would mean 26,000 derivations inside one request; the days a person is looking at
    // today are the ones that must be right within the second, and the rest is exactly what the
    // backfill exists for. So recent days are derived here and older ones are left to it — and the
    // batch reports how many it left, so «imported 12,000» can never again read as «done».
    const recomputed = await this.recomputeRecentDays(storedDays);

    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'attendancePunchBatch', entityId: batchId },
      action: 'attendancePunchImport',
      changes: [
        { field: 'rows', old: null, new: String(input.rows.length) },
        { field: 'imported', old: null, new: String(imported) },
        { field: 'duplicates', old: null, new: String(duplicates) },
        { field: 'quarantined', old: null, new: String(quarantined.length) },
        { field: 'onFrozenDays', old: null, new: String(onFrozenDays) },
        { field: 'daysRecomputed', old: null, new: String(recomputed.recomputed) },
        { field: 'daysLeftToBackfill', old: null, new: String(recomputed.leftToBackfill) },
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
    return {
      batchId,
      imported,
      duplicates,
      quarantined,
      onFrozenDays,
      daysRecomputed: recomputed.recomputed,
      daysLeftToBackfill: recomputed.leftToBackfill,
    };
  }

  /**
   * Derive the employee-days this batch touched that are RECENT ENOUGH to matter now, and count
   * the rest for the backfill.
   *
   * `RECOMPUTE_WINDOW_DAYS` is the line, and it is drawn by what a screen is read for rather than
   * by a performance guess: a supervisor looks at today and the days either side of it, and those
   * have to be exact the moment a scan lands. Anything older is history, and history is the
   * backfill's job — it is resumable, it reports progress, and it does not hold a branch server's
   * request open while it walks two years.
   *
   * A failure on one day never fails the import. The punches are already stored, which is the part
   * that must not be lost; a day that could not be derived is left for the backfill, and that is
   * exactly the state the backfill is built to recover from.
   */
  private async recomputeRecentDays(
    storedDays: readonly string[],
  ): Promise<{ recomputed: number; leftToBackfill: number }> {
    if (storedDays.length === 0) return { recomputed: 0, leftToBackfill: 0 };
    const today = cairoToday();
    const floor = addDays(today, -RECOMPUTE_WINDOW_DAYS);
    const distinct = [...new Set(storedDays)];
    let recomputed = 0;
    let leftToBackfill = 0;
    for (const key of distinct) {
      const [employeeId, dateIso] = key.split('|') as [string, string];
      const workDate = toDateOnly(new Date(`${dateIso}T00:00:00.000Z`));
      if (workDate.getTime() < floor.getTime()) {
        leftToBackfill += 1;
        continue;
      }
      try {
        // `computeDay` refuses a frozen day itself and answers 'frozen', so a closed month is
        // skipped here without a second rule deciding it.
        const outcome = await dayRecordService.computeDay(employeeId, workDate);
        if (outcome !== null && outcome !== 'frozen') recomputed += 1;
      } catch (error) {
        logger.error(
          { err: error, employeeId, workDate: dateIso },
          'attendance: import-time recompute failed for a day; left for the backfill',
        );
        leftToBackfill += 1;
      }
    }
    return { recomputed, leftToBackfill };
  }

  /**
   * How many of the stored punches fall on a day record payroll has frozen.
   *
   * One query for the whole batch: the distinct employee-days are looked up together, and each
   * stored punch is then counted against that set. A batch is one device repeated for thousands of
   * rows over a handful of dates, so the distinct set is small even when the batch is not.
   */
  private async countOnFrozenDays(storedDays: readonly string[]): Promise<number> {
    if (storedDays.length === 0) return 0;
    const distinct = [...new Set(storedDays)];
    const employeeIds = new Set<string>();
    const dates = new Set<string>();
    for (const key of distinct) {
      const [employeeId, date] = key.split('|') as [string, string];
      employeeIds.add(employeeId);
      dates.add(date);
    }
    const frozen = await AttendanceDayModel.find({
      employeeId: { $in: [...employeeIds].map((id) => new Types.ObjectId(id)) },
      workDate: { $in: [...dates].map((date) => new Date(`${date}T00:00:00.000Z`)) },
      frozenAt: { $ne: null },
      isDeleted: false,
    })
      .select({ employeeId: 1, workDate: 1 })
      .lean<{ employeeId: Types.ObjectId; workDate: Date }[]>()
      .exec();
    if (frozen.length === 0) return 0;
    const frozenKeys = new Set(
      frozen.map((row) => `${String(row.employeeId)}|${dateOnlyIso(row.workDate)}`),
    );
    return storedDays.filter((key) => frozenKeys.has(key)).length;
  }
}

export const punchService = new PunchService();
