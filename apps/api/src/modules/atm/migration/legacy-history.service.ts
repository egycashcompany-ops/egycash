// The legacy history import (docs/12-planning/atm-legacy-history-import.md): a legacy deployment's
// `replenishment` and `maintenance` rows COPIED into the ECMS branch it was, from /atm/settings.
//
// The legacy databases sit on the same cluster as ECMS's own, so they are read through the API's
// connection (`useDb(source)`) — with `find`, `aggregate` and `countDocuments` only; nothing here
// ever writes to them. `source` is one of the contract's five names, never free text, and its
// branch is the one its code names, never the request's.
//
// The rows are written insert-only, keyed by their legacy `_id` (`$setOnInsert` upserts): a row
// already in ECMS — an earlier run's, perhaps reopened or edited since — is never changed. Each row
// carries its run's id (`legacyImportRunId`), which is what the source's undo removes.
import mongoose, { Types, type Collection, type Model } from 'mongoose';
import {
  ATM_LEGACY_KINDS,
  ATM_LEGACY_SOURCES,
  ATM_LEGACY_UNDO_ROWS,
  ATM_LEGACY_UNRESOLVED_LISTED,
  ErrorCodes,
  emptyAtmLegacySkipCounts,
  type AtmLegacyImportBody,
  type AtmLegacyImportPreviewDto,
  type AtmLegacyImportRunDto,
  type AtmLegacyKind,
  type AtmLegacyKindPreviewDto,
  type AtmLegacySkipReason,
  type AtmLegacyCutoverDto,
  type AtmLegacySource,
  type AtmLegacySourceDto,
  type AtmLegacyTimeEvidenceDto,
  type AtmLegacyTimeMode,
  type AtmLegacyUndoResultDto,
  type AuditChange,
  type LocalizedString,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { branchRepository } from '../../../platform/organization';
import { AppError, BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { assertNoBranchMoveRunning } from '../branch-links/move-fence';
import { AtmMachineModel } from '../machines/machine.model';
import { AtmMaintenanceModel } from '../maintenances/maintenance.model';
import { AtmReplenishmentModel } from '../replenishments/replenishment.model';
import { actorName, loadAtmBranchLinks } from '../shared/atm-context';
import { assertAtmSettingsManager } from '../shared/settings-authority';
import {
  LEGACY_AS_WRITTEN_MINUTES,
  LEGACY_CAIRO_SHIFT_MINUTES,
  chooseLegacyTimeMode,
  classifyLegacyRow,
  legacyMachineIndex,
  legacyTimeModeClear,
  resolveLegacyMachine,
  suggestLegacyCutoverAt,
  type LegacyResolvableMachine,
} from './legacy-history';
import {
  atmLegacyImportRunRepository,
  emptyLegacyKindCounts,
  LEGACY_STEP_LEASE_MS,
} from './legacy-history-run.repository';
import { STALE_RUN_MS } from '../register/import/plan-import';
import {
  legacyImportAuditRef,
  type AtmLegacyImportRunDoc,
  type AtmLegacyKindCounts,
} from './legacy-history-run.model';
import {
  linkedSourceRefusal,
  maintenanceFromLegacy,
  repairLegacyInstant,
  replenishmentFromLegacy,
  type LegacyOperation,
  type LegacyTimeMode,
} from './legacy-transform';

/** Legacy rows one step reads (design §4.7). */
export const LEGACY_STEP_ROWS = 2_000;

let stepRows = LEGACY_STEP_ROWS;
/** For the tests: a smaller step, so a few legacy rows still take several steps. Null restores it. */
export const setLegacyStepRowsForTests = (rows: number | null): void => {
  stepRows = rows ?? LEGACY_STEP_ROWS;
};

let undoRows = ATM_LEGACY_UNDO_ROWS;
/** For the tests: a smaller undo batch, so a few copies still take several calls. */
export const setLegacyUndoRowsForTests = (rows: number | null): void => {
  undoRows = rows ?? ATM_LEGACY_UNDO_ROWS;
};

/** The contract's mode names → the transform's. */
const transformMode = (mode: AtmLegacyTimeMode): LegacyTimeMode =>
  mode === 'cairoLabelled' ? 'cairo-labelled' : 'utc';

const TARGETS: Record<AtmLegacyKind, Model<never>> = {
  replenishment: AtmReplenishmentModel as unknown as Model<never>,
  maintenance: AtmMaintenanceModel as unknown as Model<never>,
};

/**
 * A legacy collection, read through the API's own connection. Refused for ECMS's own database: a
 * deployment named like it would otherwise read ECMS as a legacy source.
 */
const legacyCollection = (source: AtmLegacySource, kind: AtmLegacyKind): Collection => {
  if (source === mongoose.connection.name) {
    throw new BusinessRuleError('لا يمكن القراءة من قاعدة بيانات النظام نفسه كمصدر قديم.');
  }
  return mongoose.connection.useDb(source, { useCache: true }).collection(kind);
};

const isUnauthorized = (error: unknown): boolean => {
  const { code, codeName } = (error ?? {}) as { code?: unknown; codeName?: unknown };
  return code === 13 || codeName === 'Unauthorized';
};

/**
 * Runs a read of the legacy database. A refusal for lack of rights is said as such (design §4.9):
 * an API whose database user may not read the source must not look like a source with no rows.
 */
const readLegacy = async <T>(source: AtmLegacySource, read: () => Promise<T>): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    throw new AppError(
      ErrorCodes.ATM_LEGACY_IMPORT_UNREADABLE,
      422,
      `لا يملك اتصال النظام بقاعدة البيانات صلاحية قراءة قاعدة البيانات القديمة «${source}».`,
      { expected: true },
    );
  }
};

/** Design §4.3 — the creation-time signature of a kind's rows. */
const evidenceOf = async (collection: Collection): Promise<AtmLegacyTimeEvidenceDto> => {
  const within = (from: number, to: number) => ({
    $cond: [{ $and: [{ $gte: ['$minutes', from] }, { $lte: ['$minutes', to] }] }, 1, 0],
  });
  const [row] = await collection
    .aggregate<AtmLegacyTimeEvidenceDto>([
      { $match: { _id: { $type: 'objectId' }, open_time: { $type: 'date' } } },
      {
        $project: {
          minutes: { $divide: [{ $subtract: ['$open_time', { $toDate: '$_id' }] }, 60_000] },
        },
      },
      {
        $group: {
          _id: null,
          rows: { $sum: 1 },
          asWritten: { $sum: within(-LEGACY_AS_WRITTEN_MINUTES, LEGACY_AS_WRITTEN_MINUTES) },
          cairoShifted: {
            $sum: within(LEGACY_CAIRO_SHIFT_MINUTES.from, LEGACY_CAIRO_SHIFT_MINUTES.to),
          },
        },
      },
    ])
    .toArray();
  return {
    rows: row?.rows ?? 0,
    asWritten: row?.asWritten ?? 0,
    cairoShifted: row?.cairoShifted ?? 0,
  };
};

/** Both kinds' modes, their evidence, and each kind's row count. */
const readModes = async (
  source: AtmLegacySource,
): Promise<{
  modes: Record<AtmLegacyKind, AtmLegacyTimeMode>;
  evidence: Record<AtmLegacyKind, AtmLegacyTimeEvidenceDto>;
  totals: Record<AtmLegacyKind, number>;
}> => {
  const out = {
    modes: {} as Record<AtmLegacyKind, AtmLegacyTimeMode>,
    evidence: {} as Record<AtmLegacyKind, AtmLegacyTimeEvidenceDto>,
    totals: {} as Record<AtmLegacyKind, number>,
  };
  for (const kind of ATM_LEGACY_KINDS) {
    const collection = legacyCollection(source, kind);
    const [evidence, total] = await readLegacy(source, () =>
      Promise.all([evidenceOf(collection), collection.countDocuments({})]),
    );
    out.evidence[kind] = evidence;
    out.modes[kind] = chooseLegacyTimeMode(evidence) === 'cairo-labelled' ? 'cairoLabelled' : 'utc';
    out.totals[kind] = total;
  }
  return out;
};

/** The target branch's machines, live and deleted (design §4.2). */
const machineIndexOf = async (branchId: Types.ObjectId) =>
  legacyMachineIndex(
    await AtmMachineModel.find({ branchId })
      .select({ machineCode: 1, isDeleted: 1, updatedAt: 1 })
      .lean<LegacyResolvableMachine[]>()
      .exec(),
  );

/**
 * The code each copied row carries: its machine's, as the register writes it — and for a machine
 * deleted since (stored `<code>-D`, machine.service.ts), the code its rows were written under, as
 * every row ECMS itself wrote before that delete still reads.
 */
const machineCodesOf = async (ids: readonly Types.ObjectId[]): Promise<Map<string, string>> => {
  if (ids.length === 0) return new Map();
  const machines = await AtmMachineModel.find({ _id: { $in: ids } })
    .select({ machineCode: 1, isDeleted: 1 })
    .lean<{ _id: Types.ObjectId; machineCode: string; isDeleted: boolean }[]>()
    .exec();
  return new Map(
    machines.map((machine) => [
      String(machine._id),
      machine.isDeleted && machine.machineCode.endsWith('-D')
        ? machine.machineCode.slice(0, -2)
        : machine.machineCode,
    ]),
  );
};

/** The live, active branch the source's code names (`ATM_LEGACY_SOURCES`), or null. */
const branchOfSource = async (
  source: AtmLegacySource,
): Promise<{ id: Types.ObjectId; name: LocalizedString } | null> => {
  const code = ATM_LEGACY_SOURCES.find((entry) => entry.source === source)?.branchCode;
  if (code === undefined) return null;
  const branch = await branchRepository.findOne({ code, status: 'active' } as never);
  return branch === null ? null : { id: branch._id, name: branch.name };
};

/** The source's branch, or 422: every row is filed under it. */
const requireBranch = async (
  source: AtmLegacySource,
): Promise<{ id: Types.ObjectId; name: LocalizedString }> => {
  const branch = await branchOfSource(source);
  if (branch === null) {
    throw new BusinessRuleError('لا يوجد فرع نشط بكود هذا المصدر القديم.');
  }
  return branch;
};

/** Refused for a branch linked to work as another: its rows would show only under «كل الشركة». */
const assertNotLinkedSource = async (branchId: Types.ObjectId): Promise<void> => {
  if (linkedSourceRefusal(String(branchId), await loadAtmBranchLinks()) !== null) {
    throw new BusinessRuleError(
      'هذا الفرع مربوط ليعمل باسم فرع آخر في الصراف الآلي؛ استورد إلى الفرع الذي يعمل باسمه.',
    );
  }
};

/** The ECMS row a legacy row becomes (design §4.6). */
const ecmsRow = (
  kind: AtmLegacyKind,
  doc: LegacyOperation,
  branchId: Types.ObjectId,
  machineId: Types.ObjectId,
  machineCode: string,
  mode: AtmLegacyTimeMode,
  runId: Types.ObjectId,
  now: Date,
): Record<string, unknown> | null => {
  const build = kind === 'replenishment' ? replenishmentFromLegacy : maintenanceFromLegacy;
  const row = build(doc, branchId, machineId, transformMode(mode), now);
  if (row === null) return null;
  return {
    ...row,
    // Filed under the register's machine, by its code (`machineCodesOf`): a zero-padded or renamed
    // (`-D`) legacy code reads as the code the boards and the done pages filter on.
    machineCode,
    openedById: null,
    closedById: null,
    legacyImportRunId: runId,
    deletedBy: null,
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  };
};

const runAuditChanges = (run: AtmLegacyImportRunDoc): AuditChange[] => [
  { field: 'source', old: null, new: run.source },
  { field: 'branchId', old: null, new: String(run.branchId) },
  { field: 'cutoverAt', old: null, new: run.cutoverAt?.toISOString() ?? null },
  { field: 'state', old: null, new: run.state },
  { field: 'modes', old: null, new: run.modes },
  { field: 'counts', old: null, new: run.counts },
];

/** One audit row per state a run enters — started, done, failed (taken over), undone. */
const recordRun = async (run: AtmLegacyImportRunDoc): Promise<void> => {
  await auditService.record({
    entityRef: legacyImportAuditRef(String(run._id)),
    action: 'atmLegacyImport',
    changes: runAuditChanges(run),
  });
};

/** Ends runs left 30 minutes without a step, each with its audit row. */
const endStaleRuns = async (now: Date): Promise<void> => {
  for (const ended of await atmLegacyImportRunRepository.failStale(now)) await recordRun(ended);
};

const kindRunDto = (counts: AtmLegacyKindCounts, mode: AtmLegacyTimeMode) => ({
  read: counts.read,
  written: counts.written,
  existing: counts.existing,
  skipped: { ...emptyAtmLegacySkipCounts(), ...counts.skipped },
  timeMode: mode,
});

const runDto = (
  run: AtmLegacyImportRunDoc,
  branchName: LocalizedString | null,
  now: Date = new Date(),
): AtmLegacyImportRunDto => ({
  id: String(run._id),
  source: run.source,
  branchId: String(run.branchId),
  branchName,
  cutoverAt: run.cutoverAt === null ? null : run.cutoverAt.toISOString(),
  state: run.state,
  nextKind: run.state === 'running' ? run.cursor.kind : null,
  replenishment: kindRunDto(run.counts.replenishment, run.modes.replenishment),
  maintenance: kindRunDto(run.counts.maintenance, run.modes.maintenance),
  totals: run.totals,
  actorName: run.actorName,
  startedAt: run.startedAt.toISOString(),
  lastStepAt: run.lastStepAt.toISOString(),
  finishedAt: run.finishedAt === null ? null : run.finishedAt.toISOString(),
  error: run.error,
  // On the server's clock, so a window's own clock never decides who may drive a run.
  active:
    run.state === 'running' && now.getTime() - run.lastStepAt.getTime() < LEGACY_STEP_LEASE_MS,
  stale: run.state === 'running' && now.getTime() - run.lastStepAt.getTime() >= STALE_RUN_MS,
});

const branchNameOf = async (branchId: Types.ObjectId): Promise<LocalizedString | null> => {
  const [branch] = await branchRepository.findByIdsSystem([String(branchId)]);
  return branch?.name ?? null;
};

/**
 * Design §4.4 — the branch's own ECMS rows (not deleted, not copied) per Cairo day they were
 * WRITTEN, both kinds together, with the first moment of each day.
 */
const cairoDayOf = (field: string) => ({
  $dateToString: { format: '%Y-%m-%d', date: field, timezone: 'Africa/Cairo' },
});

/**
 * The branch's own rows (not deleted, not copied) per Cairo day they were WRITTEN — counting only
 * the day's own work: a row opened for the day it was written. A plan entered the evening before
 * for the next day is not work in ECMS yet (review finding, 2026-11-25): Alexandria's 33 rows of
 * the 23rd were all the 24th's plan, and a cut at the first of them would have left out 14 legacy
 * operations of the 23rd, closed in the legacy system that evening, that ECMS never recorded.
 * `openedAt` rather than `openDay`, which older rows do not carry.
 */
const ownRowsPerDay = async (
  branchId: Types.ObjectId,
): Promise<{ day: string; rows: number; firstAt: Date }[]> => {
  const perKind = await Promise.all(
    Object.values(TARGETS).map((model) =>
      model
        .aggregate<{ _id: string; rows: number; firstAt: Date }>([
          { $match: { branchId, isDeleted: false, legacyImportRunId: null } },
          { $set: { writtenDay: cairoDayOf('$createdAt'), workDay: cairoDayOf('$openedAt') } },
          { $match: { $expr: { $eq: ['$writtenDay', '$workDay'] } } },
          { $group: { _id: '$writtenDay', rows: { $sum: 1 }, firstAt: { $min: '$createdAt' } } },
        ])
        .exec(),
    ),
  );
  const days = new Map<string, { rows: number; firstAt: Date }>();
  for (const entry of perKind.flat()) {
    const seen = days.get(entry._id);
    days.set(entry._id, {
      rows: (seen?.rows ?? 0) + entry.rows,
      firstAt: seen === undefined || entry.firstAt < seen.firstAt ? entry.firstAt : seen.firstAt,
    });
  }
  return [...days].map(([day, value]) => ({ day, ...value }));
};

/**
 * The copies some runs made, as `ix_legacy_import_run` holds them. The filter restates the index's
 * own `$type: 'objectId'`: the planner does not take an equality (or `$in`) on ObjectIds as
 * implying it (measured on MongoDB 7 — `maintenanceFromTicketFilter`), so without it the undo's
 * batches and the card's counts walked the whole collection (review finding, 2026-11-25). A fresh
 * object per call — Mongoose keeps the filters it is handed.
 */
export const legacyCopiesFilter = (runIds: readonly Types.ObjectId[]): Record<string, unknown> => ({
  legacyImportRunId: { $in: [...runIds], $type: 'objectId' },
});

/**
 * Rows of the source now in ECMS — everything its runs copied — or, with `changedOnly`, those
 * written to since (a copy is written at version 0; every ECMS write raises it).
 */
const copiesOf = async (
  runIds: readonly Types.ObjectId[],
  changedOnly = false,
): Promise<number> => {
  if (runIds.length === 0) return 0;
  const filter = { ...legacyCopiesFilter(runIds), ...(changedOnly ? { __v: { $gt: 0 } } : {}) };
  const counts = await Promise.all(
    Object.values(TARGETS).map((model) => model.countDocuments(filter as never).exec()),
  );
  return counts.reduce((sum, count) => sum + count, 0);
};

/** Whether a legacy history run holds the lock now — the branch move refuses while one does. */
export const legacyImportRunning = async (now: Date = new Date()): Promise<boolean> =>
  (await atmLegacyImportRunRepository.running(now)) !== null;

const cutoverOf = (input: AtmLegacyImportBody): Date | null =>
  input.cutoverAt === null ? null : new Date(input.cutoverAt);

/** One step's work: the next rows of `kind` after the cursor, classified and copied. */
const copyNext = async (
  run: AtmLegacyImportRunDoc,
  kind: AtmLegacyKind,
  now: Date,
): Promise<void> => {
  const filter = run.cursor.after === null ? {} : { _id: { $gt: run.cursor.after } };
  const docs = await readLegacy(
    run.source,
    async () =>
      (await legacyCollection(run.source, kind)
        .find(filter)
        .sort({ _id: 1 })
        .limit(stepRows)
        .toArray()) as unknown as LegacyOperation[],
  );
  const index = await machineIndexOf(run.branchId);
  const delta = emptyLegacyKindCounts();
  delta.read = docs.length;
  const picked: { doc: LegacyOperation; machineId: Types.ObjectId }[] = [];
  for (const doc of docs) {
    const outcome = classifyLegacyRow(doc, {
      cutoverAt: run.cutoverAt,
      resolve: (code) => resolveLegacyMachine(index, code),
    });
    if (outcome.verdict === 'import') picked.push({ doc, machineId: outcome.machineId });
    else delta.skipped[outcome.verdict] += 1;
  }
  const codes = await machineCodesOf(
    [...new Set(picked.map((entry) => String(entry.machineId)))].map(
      (id) => new Types.ObjectId(id),
    ),
  );
  const rows = picked
    .map(({ doc, machineId }) =>
      ecmsRow(
        kind,
        doc,
        run.branchId,
        machineId,
        codes.get(String(machineId)) ?? '',
        run.modes[kind],
        run._id,
        now,
      ),
    )
    .filter((row): row is Record<string, unknown> => row !== null);
  if (rows.length > 0) {
    const result = await TARGETS[kind].collection.bulkWrite(
      rows.map((row) => ({
        updateOne: {
          filter: { _id: row._id as Types.ObjectId },
          update: { $setOnInsert: row as never },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    delta.written = result.upsertedCount;
    delta.existing = result.matchedCount;
  }
  const last = docs[docs.length - 1];
  const kindDone = docs.length < stepRows;
  const nextKind: AtmLegacyKind | null = kindDone
    ? kind === 'replenishment'
      ? 'maintenance'
      : null
    : kind;
  const next = {
    kind: nextKind,
    after: kindDone ? null : ((last?._id as Types.ObjectId | undefined) ?? null),
  };
  await atmLegacyImportRunRepository.saveStep(
    run._id,
    run.step,
    kind,
    delta,
    next,
    nextKind === null ? now : null,
  );
};

export const atmLegacyHistoryService = {
  /** `GET /atm/legacy-import` — the five sources, each with its branch, cutover and last run. */
  async sources(ctx: AuthContext): Promise<AtmLegacySourceDto[]> {
    assertAtmSettingsManager(ctx);
    const latest = await atmLegacyImportRunRepository.latestPerSource();
    const now = new Date();
    return Promise.all(
      ATM_LEGACY_SOURCES.map(async ({ source }) => {
        const branch = await branchOfSource(source);
        const last = latest.get(source) ?? null;
        const runIds = await atmLegacyImportRunRepository.idsOfSource(source);
        return {
          source,
          branchId: branch === null ? null : String(branch.id),
          branchName: branch === null ? null : branch.name,
          lastRun: last === null ? null : runDto(last, await branchNameOf(last.branchId), now),
          copiedRows: await copiesOf(runIds),
          changedRows: await copiesOf(runIds, true),
        };
      }),
    );
  },

  /**
   * `GET /atm/legacy-import/sources/:source/cutover` — the moment the source's branch began working
   * in ECMS (design §4.4), asked when the screen opens that source.
   */
  async cutover(source: AtmLegacySource, ctx: AuthContext): Promise<AtmLegacyCutoverDto> {
    assertAtmSettingsManager(ctx);
    const branch = await requireBranch(source);
    const suggested = suggestLegacyCutoverAt(await ownRowsPerDay(branch.id));
    return { source, suggestedCutoverAt: suggested === null ? null : suggested.toISOString() };
  },

  /**
   * `POST /atm/legacy-import/preview` — read-only: what a run with this body would do now, counted
   * by the very rules a run applies (`classifyLegacyRow`), row by row.
   */
  async preview(input: AtmLegacyImportBody, ctx: AuthContext): Promise<AtmLegacyImportPreviewDto> {
    assertAtmSettingsManager(ctx);
    const branch = await requireBranch(input.source);
    const { modes, evidence, totals } = await readModes(input.source);
    const index = await machineIndexOf(branch.id);
    const cutoverAt = cutoverOf(input);
    const kinds = {} as Record<AtmLegacyKind, AtmLegacyKindPreviewDto>;
    for (const kind of ATM_LEGACY_KINDS) {
      const mode = transformMode(modes[kind]);
      const skipped = emptyAtmLegacySkipCounts();
      const unresolved = new Map<string, number>();
      let toImport = 0;
      let first: Date | null = null;
      let last: Date | null = null;
      await readLegacy(input.source, async () => {
        const cursor = legacyCollection(input.source, kind)
          // `end` with `close_time` is «Done» (legacyRowDone) — the rule needs both.
          .find({}, { projection: { mach_id: 1, open_time: 1, close_time: 1, end: 1, deleted: 1 } })
          .batchSize(5_000);
        for await (const raw of cursor) {
          const doc = raw as unknown as LegacyOperation;
          const outcome = classifyLegacyRow(doc, {
            cutoverAt,
            resolve: (code) => resolveLegacyMachine(index, code),
          });
          if (outcome.verdict === 'import') {
            toImport += 1;
            const openedAt = repairLegacyInstant(doc.open_time as Date, mode);
            if (openedAt !== null) {
              if (first === null || openedAt < first) first = openedAt;
              if (last === null || openedAt > last) last = openedAt;
            }
            continue;
          }
          skipped[outcome.verdict as AtmLegacySkipReason] += 1;
          if (outcome.verdict === 'unresolved') {
            unresolved.set(outcome.code, (unresolved.get(outcome.code) ?? 0) + 1);
          }
        }
      });
      kinds[kind] = {
        total: totals[kind],
        skipped,
        toImport,
        unresolvedCodes: [...unresolved]
          .map(([code, rows]) => ({ code, rows }))
          .sort((a, b) => b.rows - a.rows || a.code.localeCompare(b.code))
          .slice(0, ATM_LEGACY_UNRESOLVED_LISTED),
        timeMode: modes[kind],
        evidence: evidence[kind],
        timeModeClear: legacyTimeModeClear(evidence[kind]),
        firstOpenedAt: first === null ? null : (first as Date).toISOString(),
        lastOpenedAt: last === null ? null : (last as Date).toISOString(),
      };
    }
    return {
      source: input.source,
      branchId: String(branch.id),
      branchName: branch.name,
      cutoverAt: cutoverAt === null ? null : cutoverAt.toISOString(),
      sourceFound: totals.replenishment + totals.maintenance > 0,
      replenishment: kinds.replenishment,
      maintenance: kinds.maintenance,
    };
  },

  /** `POST /atm/legacy-import/runs` — starts a run; its steps do the work. */
  async start(input: AtmLegacyImportBody, ctx: AuthContext): Promise<AtmLegacyImportRunDto> {
    assertAtmSettingsManager(ctx);
    await assertNoBranchMoveRunning();
    const branch = await requireBranch(input.source);
    await assertNotLinkedSource(branch.id);
    const now = new Date();
    await endStaleRuns(now);
    const { modes, evidence, totals } = await readModes(input.source);
    const unclear = ATM_LEGACY_KINDS.filter((kind) => !legacyTimeModeClear(evidence[kind]));
    if (unclear.length > 0) {
      throw new AppError(
        ErrorCodes.BUSINESS_RULE_VIOLATION,
        422,
        'لا يمكن تحديد طريقة تسجيل الأوقات في المصدر القديم بثقة؛ لن يُستورد شيء حتى تتضح.',
        {
          details: unclear.map((kind) => ({
            field: kind,
            code: 'TIME_MODE_UNCLEAR',
            message: kind,
          })),
          expected: true,
        },
      );
    }
    const run = await atmLegacyImportRunRepository.start({
      source: input.source,
      branchId: branch.id,
      cutoverAt: cutoverOf(input),
      modes,
      evidence,
      totals,
      actorUserId: Types.ObjectId.isValid(ctx.userId) ? new Types.ObjectId(ctx.userId) : null,
      actorName: actorName(ctx),
      startedAt: now,
      lastStepAt: now,
    });
    if (run === null) {
      throw new AppError(
        ErrorCodes.ATM_LEGACY_IMPORT_RUNNING,
        409,
        'يجري الآن استيراد آخر للسجل القديم. أكمله أو انتظر انتهاءه.',
        { expected: true },
      );
    }
    await recordRun(run);
    return runDto(run, branch.name);
  },

  /**
   * `POST /atm/legacy-import/runs/:runId/step` — the next `LEGACY_STEP_ROWS` legacy rows of the
   * run's current kind, copied insert-only, under the step's lease. A step that fails part-way
   * gives the lease back and leaves the cursor where it was: the next one reads the same rows
   * again, and the inserts already made are counted as `existing`.
   */
  async step(runId: string, ctx: AuthContext): Promise<AtmLegacyImportRunDto> {
    assertAtmSettingsManager(ctx);
    await assertNoBranchMoveRunning();
    const before = await atmLegacyImportRunRepository.findById(runId);
    if (before === null) throw new NotFoundError();
    await assertNotLinkedSource(before.branchId);
    const now = new Date();
    const run = await atmLegacyImportRunRepository.claimStep(before._id, now);
    if (run === null) {
      const current = (await atmLegacyImportRunRepository.findById(before._id)) ?? before;
      if (current.state === 'running') {
        throw new AppError(
          ErrorCodes.ATM_LEGACY_IMPORT_STEP_BUSY,
          409,
          'خطوة أخرى من هذا الاستيراد تعمل الآن. أعد المحاولة بعد لحظات.',
          { expected: true },
        );
      }
      throw new AppError(ErrorCodes.ATM_LEGACY_IMPORT_STATE, 409, 'هذا الاستيراد لم يعد جارياً.', {
        details: [{ field: 'state', code: current.state, message: current.state }],
        expected: true,
      });
    }
    try {
      const kind = run.cursor.kind;
      if (kind === null) {
        // Both kinds read by an earlier step whose save was overtaken: nothing left but the end.
        await atmLegacyImportRunRepository.saveStep(
          run._id,
          run.step,
          'maintenance',
          emptyLegacyKindCounts(),
          run.cursor,
          now,
        );
      } else {
        await copyNext(run, kind, now);
      }
    } catch (error) {
      await atmLegacyImportRunRepository.releaseStep(run._id, run.step);
      throw error;
    }
    const after = (await atmLegacyImportRunRepository.findById(run._id)) ?? run;
    if (after.state === 'done' && after.finishedAt?.getTime() === now.getTime()) {
      await recordRun(after);
    }
    return runDto(after, await branchNameOf(after.branchId));
  },

  /**
   * `POST /atm/legacy-import/sources/:source/undo` — removes up to `ATM_LEGACY_UNDO_ROWS` of the
   * rows the source's runs copied (design §4.8); the screen calls it until `remaining` is 0, and
   * then the source's runs read `undone`. Copies, so deleted rather than soft-deleted — the legacy
   * database is still the source. Refused while a run runs.
   */
  async undoSource(source: AtmLegacySource, ctx: AuthContext): Promise<AtmLegacyUndoResultDto> {
    assertAtmSettingsManager(ctx);
    await assertNoBranchMoveRunning();
    const now = new Date();
    await endStaleRuns(now);
    if (await legacyImportRunning(now)) {
      throw new AppError(
        ErrorCodes.ATM_LEGACY_IMPORT_RUNNING,
        409,
        'يجري الآن استيراد للسجل القديم. انتظر انتهاءه ثم تراجع.',
        { expected: true },
      );
    }
    const runIds = await atmLegacyImportRunRepository.idsOfSource(source);
    let removed = 0;
    for (const model of Object.values(TARGETS)) {
      while (removed < undoRows && runIds.length > 0) {
        const batch = await model
          .find(legacyCopiesFilter(runIds) as never)
          .select({ _id: 1 })
          .limit(undoRows - removed)
          .lean<{ _id: Types.ObjectId }[]>()
          .exec();
        if (batch.length === 0) break;
        const result = await model.collection.deleteMany({
          _id: { $in: batch.map((row) => row._id) },
          ...legacyCopiesFilter(runIds),
        });
        removed += result.deletedCount;
      }
    }
    const remaining = await copiesOf(runIds);
    if (remaining === 0) {
      for (const run of await atmLegacyImportRunRepository.markSourceUndone(source, now)) {
        await recordRun(run);
      }
    }
    return { source, removed, remaining };
  },
};
