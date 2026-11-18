// The history backfill (Task 2 §3) — recompute at scale, as worker jobs.
//
// THE PROBLEM. `days/recompute` is capped at 92 days and runs inside the request, because the
// branch servers call it every few seconds all morning and it has to answer in milliseconds. The
// backfill is the opposite shape of work: 655 people × ~23 months, roughly 450,000 employee-days,
// once. Done inside a request it would time out; done as one queue job it would be a single
// multi-hour task with no way to see into it and nothing to resume from.
//
// THE SHAPE. A run is PLANNED into chunks (one employee, up to a month), and workers claim chunks
// one at a time. That buys three things at once:
//
//   * **Resumable.** A claim is a conditional update, so a worker that dies leaves its chunk
//     `running` with a stale `claimedAt` and the next claim re-offers it. Recomputing a day is
//     idempotent — `computeDay` derives from the punches, the leave, the holiday and the live
//     decision every time — so re-running a chunk costs time and changes nothing.
//   * **Progress.** «x of y days recomputed» is one grouped read over that run's chunks.
//   * **Honest about the freeze.** A chunk counts the days Payroll had frozen instead of touching
//     them, so a backfill that landed in a closed month says so.
//
// WHAT IT DOES NOT DO. It does not import anything, does not write a punch, and has no opinion
// about a day: it calls the same `computeDay` every other derivation calls, under the same freeze
// guard, with the same manager decisions as inputs. A decision therefore survives a backfill for
// the same reason it survives a branch re-send — it is an input to the derivation, not a field on
// the row.
import { Types } from 'mongoose';
import {
  type AttendanceBackfillDto,
  type ListAttendanceBackfillsQuery,
  type StartAttendanceBackfill,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { logger } from '../../../../infrastructure/logging/logger';
import { enqueueMany } from '../../../../infrastructure/queue/jobs';
import { addDays, dateOnlyIso, toDateOnly } from '../../shared/business-date';
import { employeeRepository } from '../../employee-management/employees';
import { cairoInstant } from '../day-records/derive-day';
import { dayRecordService } from '../day-records/day-record.service';
import { AttendancePunchModel } from '../punches/punch.model';
import {
  AttendanceBackfillChunkModel,
  AttendanceBackfillModel,
  type AttendanceBackfillDoc,
} from './attendance-backfill.model';

/** The job every worker runs. Prefixed with the module id — the manifest refuses anything else. */
export const BACKFILL_CHUNK_JOB = 'hr.attendance.backfillChunk';

/**
 * How many chunk workers a start or a resume puts on the queue.
 *
 * FOUR, and the number is a database decision rather than a CPU one: each chunk is a few reads
 * and a write per day against the same cluster the branch servers are using all morning. Four
 * claims at a time finishes ~450,000 days in a long evening without the backfill becoming the
 * reason a scan takes two seconds to show up.
 */
const BACKFILL_WORKERS = 4;

/** At most a month per chunk: small enough to lose on a crash, big enough to amortize the claim. */
const CHUNK_DAYS = 31;

/** A claim this old belongs to a worker that is not coming back, so the chunk is re-offered. */
const CLAIM_STALE_MS = 15 * 60 * 1000;

/**
 * A planned run is refused above this many chunks. ~655 people × 23 months is about 15,000, so
 * this is an order of magnitude of headroom and still catches «from 1970» typed into the picker.
 */
const MAX_CHUNKS = 200_000;

interface PlannedChunk {
  employeeId: Types.ObjectId;
  from: Date;
  to: Date;
  dates: string[] | null;
  days: number;
}

const daysBetween = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;

/** Every `YYYY-MM-DD` from `from` to `to`, inclusive. */
const spanDates = (from: Date, to: Date): string[] => {
  const out: string[] = [];
  for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) out.push(dateOnlyIso(d));
  return out;
};

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

class AttendanceBackfillService {
  /**
   * Plan and start a run. Returns as soon as the plan is stored — the work happens on the queue.
   *
   * The employee list is RESOLVED NOW and stored as chunks, so somebody hired tomorrow does not
   * change this run's denominator half way through and make the progress figure go backwards.
   */
  async start(ctx: AuthContext, input: StartAttendanceBackfill): Promise<AttendanceBackfillDto> {
    const from = toDateOnly(input.from);
    const to = toDateOnly(input.to);
    const employeeIds =
      input.employeeIds ?? (await employeeRepository.listIdsForAttendance());
    if (employeeIds.length === 0) {
      throw new BusinessRuleError('there are no employees to recompute');
    }
    const planned =
      input.scope === 'all'
        ? this.planWholeSpan(employeeIds, from, to)
        : await this.planFromPunches(employeeIds, from, to);
    if (planned.length === 0) {
      throw new BusinessRuleError(
        'nothing to recompute in that window — no scans landed in it (use scope=all to walk every day)',
      );
    }
    if (planned.length > MAX_CHUNKS) {
      throw new BusinessRuleError(
        `that window plans ${String(planned.length)} chunks, above the ${String(MAX_CHUNKS)} limit — narrow it`,
      );
    }

    const employees = new Set(planned.map((chunk) => String(chunk.employeeId))).size;
    const totalDays = planned.reduce((sum, chunk) => sum + chunk.days, 0);
    const run = await AttendanceBackfillModel.create({
      from,
      to,
      scope: input.scope,
      status: 'running',
      employees,
      totalChunks: planned.length,
      totalDays,
      startedBy: ctx.userId === null ? null : new Types.ObjectId(ctx.userId),
      startedAt: new Date(),
      createdBy: ctx.userId === null ? null : new Types.ObjectId(ctx.userId),
    });

    // Inserted in batches so one `insertMany` never carries tens of thousands of documents.
    const BATCH = 1_000;
    for (let i = 0; i < planned.length; i += BATCH) {
      await AttendanceBackfillChunkModel.insertMany(
        planned.slice(i, i + BATCH).map((chunk) => ({
          runId: run._id,
          employeeId: chunk.employeeId,
          from: chunk.from,
          to: chunk.to,
          dates: chunk.dates,
          days: chunk.days,
          status: 'pending' as const,
        })),
      );
    }

    await auditService.record({
      entityRef: {
        moduleId: 'hr',
        entityType: 'attendanceBackfill',
        entityId: String(run._id),
      },
      action: 'attendanceBackfill',
      changes: [
        { field: 'act', old: null, new: 'start' },
        { field: 'from', old: null, new: dateOnlyIso(from) },
        { field: 'to', old: null, new: dateOnlyIso(to) },
        { field: 'scope', old: null, new: input.scope },
        { field: 'employees', old: null, new: String(employees) },
        { field: 'chunks', old: null, new: String(planned.length) },
        { field: 'days', old: null, new: String(totalDays) },
      ],
    });
    await this.dispatchWorkers(String(run._id));
    return this.progress(String(run._id));
  }

  /** `all` — every day of the window for every employee, whether or not anybody scanned. */
  private planWholeSpan(
    employeeIds: readonly string[],
    from: Date,
    to: Date,
  ): PlannedChunk[] {
    const chunks: PlannedChunk[] = [];
    for (const employeeId of employeeIds) {
      for (let start = from; start.getTime() <= to.getTime(); start = addDays(start, CHUNK_DAYS)) {
        const end = addDays(start, CHUNK_DAYS - 1);
        const last = end.getTime() > to.getTime() ? to : end;
        chunks.push({
          employeeId: new Types.ObjectId(employeeId),
          from: start,
          to: last,
          dates: null,
          days: daysBetween(start, last),
        });
      }
    }
    return chunks;
  }

  /**
   * `withPunches` — only the employee-days that carry a scan.
   *
   * One grouped pass over the punches in the window, keyed on the CAIRO calendar date of each
   * scan, because that is the date a day row is filed under. Superseded punches are excluded: a
   * corrected scan's replacement carries its own date, and the original would otherwise plan a day
   * nobody worked.
   */
  private async planFromPunches(
    employeeIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<PlannedChunk[]> {
    const wanted = new Set(employeeIds.map(String));
    const rows = await AttendancePunchModel.aggregate<{
      _id: { employeeId: Types.ObjectId; date: string };
    }>([
      {
        $match: {
          at: { $gte: cairoInstant(from, '00:00'), $lt: cairoInstant(addDays(to, 1), '00:00') },
          supersededBy: null,
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: {
            employeeId: '$employeeId',
            date: {
              $dateToString: { date: '$at', format: '%Y-%m-%d', timezone: 'Africa/Cairo' },
            },
          },
        },
      },
    ]).exec();

    const byEmployee = new Map<string, string[]>();
    for (const row of rows) {
      const employeeId = String(row._id.employeeId);
      if (!wanted.has(employeeId)) continue;
      const dates = byEmployee.get(employeeId);
      if (dates === undefined) byEmployee.set(employeeId, [row._id.date]);
      else dates.push(row._id.date);
    }

    const chunks: PlannedChunk[] = [];
    for (const [employeeId, dates] of byEmployee) {
      dates.sort();
      for (let i = 0; i < dates.length; i += CHUNK_DAYS) {
        const slice = dates.slice(i, i + CHUNK_DAYS);
        chunks.push({
          employeeId: new Types.ObjectId(employeeId),
          from: new Date(`${String(slice[0])}T00:00:00.000Z`),
          to: new Date(`${String(slice[slice.length - 1])}T00:00:00.000Z`),
          dates: slice,
          days: slice.length,
        });
      }
    }
    return chunks;
  }

  /** Put `BACKFILL_WORKERS` claim-one-chunk jobs on the queue for this run. */
  private async dispatchWorkers(runId: string): Promise<void> {
    await enqueueMany(
      'scheduled',
      Array.from({ length: BACKFILL_WORKERS }, () => ({
        name: BACKFILL_CHUNK_JOB,
        data: { runId },
      })),
    );
  }

  /**
   * One worker's turn: claim a chunk, recompute its days, then hand the queue back a job if there
   * is still work. Self-chaining rather than one long job, so a worker holds a queue slot for a
   * month of one person's days and no longer.
   */
  async runChunk(runId: string): Promise<void> {
    const run = await AttendanceBackfillModel.findById(runId).exec();
    if (run === null || run.status !== 'running') return;

    const chunk = await AttendanceBackfillChunkModel.findOneAndUpdate(
      {
        runId: run._id,
        $or: [
          { status: 'pending' },
          // A worker that died mid-chunk. Re-offering it is safe because the work is idempotent.
          { status: 'running', claimedAt: { $lt: new Date(Date.now() - CLAIM_STALE_MS) } },
        ],
      },
      { $set: { status: 'running', claimedAt: new Date() }, $inc: { attempts: 1 } },
      { new: true, sort: { _id: 1 } },
    ).exec();
    if (chunk === null) {
      await this.finishIfDone(run);
      return;
    }

    let computed = 0;
    let skippedFrozen = 0;
    let failedDays = 0;
    let error: string | null = null;
    for (const iso of chunk.dates ?? spanDates(chunk.from, chunk.to)) {
      try {
        const outcome = await dayRecordService.computeDay(
          String(chunk.employeeId),
          new Date(`${iso}T00:00:00.000Z`),
        );
        if (outcome === 'frozen') skippedFrozen += 1;
        else if (outcome !== null) computed += 1;
        // `null` is a day the person was not employed on: handled, no row, nothing to count.
      } catch (caught) {
        // ONE BAD DAY MUST NOT STARVE THE REST. The chunk is marked failed and carries its reason,
        // so a resume re-offers exactly those days and the run's own total stays honest.
        failedDays += 1;
        error = message(caught);
        logger.error(
          { err: caught, runId, employeeId: String(chunk.employeeId), workDate: iso },
          'attendance: backfill day failed',
        );
      }
    }

    await AttendanceBackfillChunkModel.updateOne(
      { _id: chunk._id },
      {
        $set: {
          status: failedDays > 0 ? 'failed' : 'done',
          computed,
          skippedFrozen,
          failedDays,
          finishedAt: new Date(),
          error,
        },
      },
    ).exec();
    if (error !== null) {
      await AttendanceBackfillModel.updateOne({ _id: run._id }, { $set: { lastError: error } }).exec();
    }

    const remaining = await AttendanceBackfillChunkModel.countDocuments({
      runId: run._id,
      status: 'pending',
    }).exec();
    if (remaining > 0) {
      await enqueueMany('scheduled', [{ name: BACKFILL_CHUNK_JOB, data: { runId } }]);
      return;
    }
    await this.finishIfDone(run);
  }

  /**
   * Mark the run finished once no chunk is pending or claimable.
   *
   * Filtered on `status: 'running'`, which is the idempotency: four workers arriving here together
   * produce one transition and one audit row, not four.
   */
  private async finishIfDone(run: AttendanceBackfillDoc): Promise<void> {
    const open = await AttendanceBackfillChunkModel.countDocuments({
      runId: run._id,
      status: { $in: ['pending', 'running'] },
    }).exec();
    if (open > 0) return;
    const res = await AttendanceBackfillModel.updateOne(
      { _id: run._id, status: 'running' },
      { $set: { status: 'completed', finishedAt: new Date() } },
    ).exec();
    if (res.modifiedCount === 0) return;
    const dto = await this.progress(String(run._id));
    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'attendanceBackfill', entityId: String(run._id) },
      action: 'attendanceBackfill',
      changes: [
        { field: 'act', old: null, new: 'finish' },
        { field: 'computed', old: null, new: String(dto.computed) },
        { field: 'skippedFrozen', old: null, new: String(dto.skippedFrozen) },
        { field: 'failedDays', old: null, new: String(dto.failedDays) },
        { field: 'days', old: null, new: `${String(dto.doneDays)}/${String(dto.totalDays)}` },
      ],
    });
    logger.info(
      { runId: String(run._id), computed: dto.computed, days: dto.doneDays },
      'attendance: backfill finished',
    );
  }

  /** Stop a run. The chunk being worked on finishes; nothing new is claimed. */
  async cancel(ctx: AuthContext, id: string): Promise<AttendanceBackfillDto> {
    const run = await AttendanceBackfillModel.findById(id).exec();
    if (run === null) throw new NotFoundError('backfill not found');
    if (run.status !== 'running') {
      throw new BusinessRuleError(`this backfill is already ${run.status}`);
    }
    await AttendanceBackfillModel.updateOne(
      { _id: run._id, status: 'running' },
      {
        $set: {
          status: 'cancelled',
          finishedAt: new Date(),
          updatedBy: ctx.userId === null ? null : new Types.ObjectId(ctx.userId),
        },
      },
    ).exec();
    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'attendanceBackfill', entityId: String(run._id) },
      action: 'attendanceBackfill',
      changes: [
        { field: 'act', old: null, new: 'cancel' },
        { field: 'status', old: 'running', new: 'cancelled' },
      ],
    });
    return this.progress(String(run._id));
  }

  /**
   * Pick a run back up: the days that failed, and the chunks whose worker never came back, go back
   * on the queue. Everything already done stays done — THIS is what «resumable» means here, and it
   * is also what makes a cancelled run safe to cancel: nothing is lost, only paused.
   */
  async resume(ctx: AuthContext, id: string): Promise<AttendanceBackfillDto> {
    const run = await AttendanceBackfillModel.findById(id).exec();
    if (run === null) throw new NotFoundError('backfill not found');
    const reopened = await AttendanceBackfillChunkModel.updateMany(
      {
        runId: run._id,
        $or: [
          { status: 'failed' },
          { status: 'running', claimedAt: { $lt: new Date(Date.now() - CLAIM_STALE_MS) } },
        ],
      },
      { $set: { status: 'pending', claimedAt: null, error: null, failedDays: 0 } },
    ).exec();
    const left = await AttendanceBackfillChunkModel.countDocuments({
      runId: run._id,
      status: { $in: ['pending', 'running'] },
    }).exec();
    if (left === 0) throw new BusinessRuleError('this backfill has nothing left to do');

    await AttendanceBackfillModel.updateOne(
      { _id: run._id },
      {
        $set: {
          status: 'running',
          finishedAt: null,
          lastError: null,
          updatedBy: ctx.userId === null ? null : new Types.ObjectId(ctx.userId),
        },
      },
    ).exec();
    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'attendanceBackfill', entityId: String(run._id) },
      action: 'attendanceBackfill',
      changes: [
        { field: 'act', old: null, new: 'resume' },
        { field: 'status', old: run.status, new: 'running' },
        { field: 'reopenedChunks', old: null, new: String(reopened.modifiedCount) },
      ],
    });
    await this.dispatchWorkers(String(run._id));
    return this.progress(String(run._id));
  }

  /**
   * «x of y days recomputed», counted FROM THE CHUNKS.
   *
   * Deliberately not a tally kept on the run document: a worker killed between finishing a chunk
   * and incrementing that tally would leave it permanently short, and a progress figure that
   * quietly drifts is worse than no figure at all. One grouped read on `{runId, status}`, which is
   * the same index the claim uses.
   */
  async progress(id: string): Promise<AttendanceBackfillDto> {
    const run = await AttendanceBackfillModel.findById(id).exec();
    if (run === null) throw new NotFoundError('backfill not found');
    return this.toDto(run);
  }

  async list(query: ListAttendanceBackfillsQuery): Promise<AttendanceBackfillDto[]> {
    const runs = await AttendanceBackfillModel.find({ isDeleted: false })
      .sort({ startedAt: -1 })
      .limit(query.limit)
      .exec();
    return Promise.all(runs.map((run) => this.toDto(run)));
  }

  private async toDto(run: AttendanceBackfillDoc): Promise<AttendanceBackfillDto> {
    const grouped = await AttendanceBackfillChunkModel.aggregate<{
      _id: string;
      chunks: number;
      days: number;
      computed: number;
      skippedFrozen: number;
      failedDays: number;
    }>([
      { $match: { runId: run._id } },
      {
        $group: {
          _id: '$status',
          chunks: { $sum: 1 },
          days: { $sum: '$days' },
          computed: { $sum: '$computed' },
          skippedFrozen: { $sum: '$skippedFrozen' },
          failedDays: { $sum: '$failedDays' },
        },
      },
    ]).exec();

    let doneChunks = 0;
    let failedChunks = 0;
    let doneDays = 0;
    let computed = 0;
    let skippedFrozen = 0;
    let failedDays = 0;
    for (const row of grouped) {
      computed += row.computed;
      skippedFrozen += row.skippedFrozen;
      failedDays += row.failedDays;
      // A FAILED CHUNK IS ACCOUNTED FOR, not pending: its days were looked at and some of them
      // threw. Counting it as outstanding would leave a finished run showing 97% for ever.
      if (row._id === 'done' || row._id === 'failed') {
        doneChunks += row.chunks;
        doneDays += row.days;
      }
      if (row._id === 'failed') failedChunks += row.chunks;
    }

    return {
      id: String(run._id),
      from: dateOnlyIso(run.from),
      to: dateOnlyIso(run.to),
      scope: run.scope,
      status: run.status,
      employees: run.employees,
      totalChunks: run.totalChunks,
      doneChunks,
      failedChunks,
      totalDays: run.totalDays,
      doneDays,
      computed,
      skippedFrozen,
      failedDays,
      percent: run.totalDays === 0 ? 100 : Math.round((doneDays / run.totalDays) * 100),
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt === null ? null : run.finishedAt.toISOString(),
      lastError: run.lastError,
    };
  }
}

export const attendanceBackfillService = new AttendanceBackfillService();

/**
 * The manifest's job-handler declaration. One job name; its payload is `{ runId }` and nothing
 * else, so a message enqueued by an older deploy still means the same thing on a newer worker.
 */
export const attendanceBackfillJobHandlers = [
  {
    queue: 'scheduled' as const,
    jobName: BACKFILL_CHUNK_JOB,
    handler: async (data: unknown): Promise<void> => {
      const runId = (data as { runId?: unknown }).runId;
      if (typeof runId !== 'string') {
        logger.error({ data }, 'attendance: backfill job without a runId');
        return;
      }
      await attendanceBackfillService.runChunk(runId);
    },
  },
];
