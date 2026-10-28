// Applying an approved import (spec §6.6). The caller has already re-read and re-planned the same
// bytes and refused while any blocker stood; this file writes.
//
// The shape is the run-record one (DEC-15): ONE `running` run at a time (the unique partial index
// is the lock), rows written in batches of 200 per transaction — a 6,000-write transaction would
// risk the 60 s limit — and every batch's per-row outcome appended to the run as soon as it
// commits. A crash therefore leaves the committed batches in place and the run `failed`; re-running
// the same file skips what is in (the unique `importRow` index) and carries on.
//
// Audit (DEC-15): ONE `atmRegisterImport` row per apply, through `importAuditRef` (the literal
// pair lives in the run model, §5.10). Masters created, reactivated or relabelled ARE audited one
// by one — those are Operations facts somebody will look up on the machine — but the thousands of
// entries the import writes are not; their outcomes are the run's rows.
//
// Secrets: AO is sealed per entry BEFORE its batch's transaction (the id is minted first so the
// sealing context can name it) and the plaintext never reaches the run, the audit or a log line.
//
// Area labels (DEC-38): once the run has completed, every area its open or pending rows carry
// becomes a data-edit label of its branch — one pass after the run, outside every batch, best
// effort (`ensureAreaLabels` never throws), so the 118 raw workbook areas reach Operations' lists.
import {
  ATM_NBE_FOREX_LABEL,
  ATM_REGISTER_IMPORT_OUTCOMES,
  ErrorCodes,
  type AtmRegisterImportCategory,
  type AtmRegisterImportOutcome,
  type SecretRef,
} from '@ecms/contracts';
import { Types, type ClientSession } from 'mongoose';
import { logger } from '../../../../infrastructure/logging/logger';
import { auditService } from '../../../../platform/audit';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { AppError, ConflictError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { ensureAreaLabels } from '../../catalogs/area-labels';
import { AtmRefLabelModel } from '../../catalogs/ref-label.model';
import { AtmMachineModel, type AtmMachineDoc } from '../../machines/machine.model';
import {
  isCouplingRefusal,
  isPlaceholderMachineCode,
  linkUncoupled,
  syncEntryToMaster,
  uncoupledPrecondition,
  type CouplingRefusal,
  type PendingAudit,
} from '../register-coupling';
import { AtmRegisterEntryModel, type AtmRegisterEntryDoc } from '../register.model';
import { atmRegisterEntryRepository } from '../register.repository';
import { sealCombination } from '../register-secrets';
import { type RegisterSettings } from '../register-settings';
import { AtmRegisterImportRunModel, importAuditRef } from './register-import-run.model';
import { type ParsedRegisterFile, type ParsedRow } from './parse-rows';
import { STALE_RUN_MS, isNbeForexCandidate, type ImportPlan } from './plan-import';

/** Rows per transaction (DEC-15). */
export const IMPORT_BATCH_SIZE = 200;

export interface ApplyImportRequest {
  categories: readonly AtmRegisterImportCategory[];
  reportOverride: boolean;
  fileName: string;
  fileSha256: string;
}

export interface ApplyImportResult {
  runId: string;
  counts: Record<AtmRegisterImportOutcome, number>;
}

type RunRow = { importRow: number; entryId: Types.ObjectId | null; outcome: string };

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const businessDate = (day: string | null): Date | null =>
  day === null ? null : new Date(`${day}T00:00:00.000Z`);

const realCode = (code: string | null): code is string =>
  code !== null && !isPlaceholderMachineCode(code);

const recordAll = async (audits: readonly PendingAudit[]): Promise<void> => {
  for (const audit of audits) await auditService.record(audit);
};

/** The importer's display name, as the run list shows it. */
const actorNameOf = (ctx: AuthContext): string | null => {
  const name = ctx.identity?.displayName?.[ctx.locale === 'ar' ? 'ar' : 'en'] ?? '';
  return name === '' ? null : name;
};

/** One parsed row as the entry the import writes. Open rows start unlinked (DEC-30). */
const entryDoc = (
  row: ParsedRow,
  id: Types.ObjectId,
  branchId: string | null,
  combination: SecretRef | null,
  machineId: Types.ObjectId | null,
  runId: Types.ObjectId,
  actor: Types.ObjectId | null,
): Record<string, unknown> => ({
  _id: id,
  branchId: branchId === null ? null : new Types.ObjectId(branchId),
  area: row.values.area,
  bankCode: row.values.bankCode,
  opsBankLabel: null,
  machineCode: row.values.machineCode,
  machineId,
  name: row.values.name,
  operationType: row.values.operationType,
  vendor: row.values.vendor,
  model: row.values.model,
  serial: row.values.serial,
  keys: row.values.keys,
  cassettes: row.values.cassettes,
  openTime: row.values.openTime,
  closeTime: row.values.closeTime,
  accessHoursNotes: row.values.accessHoursNotes,
  receiptNotes: row.values.receiptNotes,
  safeCombination: combination,
  locationPlusCode: row.values.locationPlusCode,
  locationUrl: row.values.locationUrl,
  hub: row.values.hub,
  startDate: businessDate(row.values.startDate),
  endDate: businessDate(row.values.endDate),
  receivedByName: row.values.receivedByName,
  handoverName: row.values.handoverName,
  handoverNotes: row.values.handoverNotes,
  status: row.status,
  openPeriodExempt: row.openPeriodExempt,
  source: 'import',
  importRunId: runId,
  importRow: row.importRow,
  importIssues: row.issues,
  legacyMarks: row.legacyMarks,
  createdBy: actor,
  updatedBy: actor,
});

type LiveDecision = 'link' | 'reactivate' | 'create' | CouplingRefusal;

/**
 * The category of an unlinked open entry RIGHT NOW, inside the batch's transaction — the same
 * order `coupleReceipt` decides in, so what is approved is what then happens.
 */
const decideLive = async (
  entry: Pick<AtmRegisterEntryDoc, 'branchId' | 'machineCode' | 'name' | 'area'>,
  session: ClientSession,
): Promise<LiveDecision> => {
  const elsewhere = await AtmMachineModel.findOne({
    isDeleted: false,
    isActive: true,
    machineCode: entry.machineCode,
    branchId: { $ne: entry.branchId },
  })
    .session(session)
    .lean<Pick<AtmMachineDoc, 'branchId'>>()
    .exec();
  if (elsewhere !== null)
    return { refused: 'activeElsewhere', otherBranchId: String(elsewhere.branchId) };
  const master = await AtmMachineModel.findOne({
    isDeleted: false,
    branchId: entry.branchId,
    machineCode: entry.machineCode,
  })
    .session(session)
    .lean<Pick<AtmMachineDoc, 'isActive'>>()
    .exec();
  if (master?.isActive === true) return 'link';
  if (entry.area === null) return { refused: 'blankArea' };
  if (entry.name === null) return { refused: 'noName' };
  return master === null ? 'create' : 'reactivate';
};

const OUTCOME_OF = { link: 'linked', reactivate: 'reactivated', create: 'created' } as const;

const hasForexLabel = async (branchId: Types.ObjectId, session: ClientSession): Promise<boolean> =>
  (await AtmRefLabelModel.exists({
    branchId,
    kind: 'bank',
    name: ATM_NBE_FOREX_LABEL,
    isActive: true,
    isDeleted: false,
  })
    .session(session)
    .exec()) !== null;

/**
 * DEC-38, once the run has completed: a data-edit label for every area the run's open or pending
 * rows carry. Never fails the run it follows — a miss is logged and the next boot's backfill
 * repairs it.
 */
const labelRunAreas = async (runId: Types.ObjectId, actorId: string): Promise<void> => {
  try {
    const written = await AtmRegisterEntryModel.aggregate<{
      _id: { branchId: Types.ObjectId; area: string };
    }>([
      {
        $match: {
          importRunId: runId,
          isDeleted: false,
          status: { $in: ['open', 'pending'] },
          branchId: { $ne: null },
          area: { $type: 'string' },
        },
      },
      { $group: { _id: { branchId: '$branchId', area: '$area' } } },
    ]).exec();
    await ensureAreaLabels(
      written.map((row) => row._id),
      { actorId, origin: 'import' },
    );
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.name : 'Error' },
      'atm: the import run’s area labels were not written — the next boot repairs them',
    );
  }
};

/** Write the approved categories. Throws (after marking the run `failed`) on any error. */
export const applyRegisterImport = async (
  plan: ImportPlan,
  settings: Pick<RegisterSettings, 'branchIdByCode' | 'opsLabel'>,
  request: ApplyImportRequest,
  headerFills: ParsedRegisterFile['headerFills'],
  ctx: AuthContext,
): Promise<ApplyImportResult> => {
  const approved = new Set(request.categories);
  const actor = new Types.ObjectId(ctx.userId);
  const now = new Date();

  // One running import at a time; a run that has said nothing for 30 minutes is abandoned.
  await AtmRegisterImportRunModel.updateMany(
    { state: 'running', startedAt: { $lt: new Date(now.getTime() - STALE_RUN_MS) } },
    { $set: { state: 'abandoned', finishedAt: now } },
  ).exec();
  let runId: Types.ObjectId;
  try {
    const run = await AtmRegisterImportRunModel.create({
      fileName: request.fileName,
      fileSha256: request.fileSha256,
      state: 'running',
      actorUserId: actor,
      actorName: actorNameOf(ctx),
      startedAt: now,
      categories: [...approved],
      reportOverride: request.reportOverride,
      counts: {},
      rows: [],
      headerFills,
      error: null,
    });
    runId = run._id;
  } catch (error) {
    if ((error as { code?: unknown }).code === 11000) {
      throw new ConflictError(
        'another register import is running',
        ErrorCodes.ATM_REGISTER_IMPORT_RUNNING,
      );
    }
    throw error;
  }

  const counts = Object.fromEntries(ATM_REGISTER_IMPORT_OUTCOMES.map((o) => [o, 0])) as Record<
    AtmRegisterImportOutcome,
    number
  >;
  counts.alreadyImported = plan.counts.alreadyImported;
  const progress = async (rows: RunRow[]): Promise<void> => {
    for (const row of rows) {
      const outcome = (
        row.outcome.startsWith('cannotCouple') ? 'cannotCouple' : row.outcome
      ) as AtmRegisterImportOutcome;
      if (outcome in counts) counts[outcome] += 1;
    }
    await AtmRegisterImportRunModel.updateOne(
      { _id: runId },
      { $push: { rows: { $each: rows } }, $set: { counts } },
    ).exec();
  };
  const branchIdOf = (row: ParsedRow): string | null =>
    row.values.branchCode === null
      ? null
      : (settings.branchIdByCode.get(row.values.branchCode) ?? null);

  try {
    // ── entries ──────────────────────────────────────────────────────────────────────────────
    if (approved.has('entries')) {
      for (const batch of chunks(plan.rowsToImport, IMPORT_BATCH_SIZE)) {
        const prepared: { row: ParsedRow; id: Types.ObjectId; combination: SecretRef | null }[] =
          [];
        for (const row of batch) {
          const id = new Types.ObjectId();
          const combination =
            row.plaintextCombination === null
              ? null
              : await sealCombination(String(id), row.plaintextCombination);
          prepared.push({ row, id, combination });
        }
        const outcomes = await unitOfWork(async (session) => {
          // History link for ended/pending rows: the live master of (branch, code), no change to it.
          const lookups = prepared.filter(
            ({ row }) =>
              row.status !== 'open' && realCode(row.values.machineCode) && branchIdOf(row) !== null,
          );
          const masters =
            lookups.length === 0
              ? []
              : await AtmMachineModel.find(
                  {
                    isDeleted: false,
                    branchId: {
                      $in: [...new Set(lookups.map(({ row }) => branchIdOf(row) ?? ''))].map(
                        (id) => new Types.ObjectId(id),
                      ),
                    },
                    machineCode: {
                      $in: [...new Set(lookups.map(({ row }) => row.values.machineCode ?? ''))],
                    },
                  },
                  { branchId: 1, machineCode: 1 },
                )
                  .session(session)
                  .lean<Pick<AtmMachineDoc, '_id' | 'branchId' | 'machineCode'>[]>()
                  .exec();
          const masterOf = new Map(
            masters.map((m) => [`${String(m.branchId)}|${m.machineCode}`, m._id]),
          );

          const docs: Record<string, unknown>[] = [];
          const rows: RunRow[] = [];
          for (const { row, id, combination } of prepared) {
            const code = row.values.machineCode;
            if (row.status === 'open' && realCode(code)) {
              // Race guard: a receipt made while this import ran. Anything older was a blocker.
              const open = await atmRegisterEntryRepository.findOpenByCode(code, session);
              if (open.some((e) => e.importRow === null || !plan.fileRows.has(e.importRow))) {
                rows.push({ importRow: row.importRow, entryId: null, outcome: 'openInRegister' });
                continue;
              }
            }
            const branchId = branchIdOf(row);
            const machineId =
              row.status === 'open' || branchId === null || code === null
                ? null
                : (masterOf.get(`${branchId}|${code}`) ?? null);
            docs.push(entryDoc(row, id, branchId, combination, machineId, runId, actor));
            rows.push({ importRow: row.importRow, entryId: id, outcome: 'imported' });
          }
          if (docs.length > 0)
            await AtmRegisterEntryModel.insertMany(docs, { session, ordered: true });
          return rows;
        });
        await progress(outcomes);
      }
    }

    // ── link / reactivate / create (+ nbeForex on the masters they activate) ─────────────────
    const coupling = (['link', 'reactivate', 'create'] as const).filter((c) => approved.has(c));
    const branchIds = plan.couplingBranchIds.map((id) => new Types.ObjectId(id));
    if (coupling.length > 0 && branchIds.length > 0) {
      const candidates = await AtmRegisterEntryModel.find(
        {
          isDeleted: false,
          source: 'import',
          status: 'open',
          machineId: null,
          branchId: { $in: branchIds },
        },
        { _id: 1 },
      )
        .sort({ importRow: 1 })
        .lean<{ _id: Types.ObjectId }[]>()
        .exec();
      for (const batch of chunks(candidates, IMPORT_BATCH_SIZE)) {
        const { rows, audits } = await unitOfWork(async (session) => {
          const out: RunRow[] = [];
          const pending: PendingAudit[] = [];
          for (const { _id } of batch) {
            const entry = await AtmRegisterEntryModel.findOne({
              _id,
              isDeleted: false,
              status: 'open',
              machineId: null,
            })
              .session(session)
              .lean<AtmRegisterEntryDoc>()
              .exec();
            if (entry === null) continue;
            const importRow = entry.importRow ?? 0;
            const precondition = uncoupledPrecondition(entry);
            if (precondition !== null || entry.bankCode === null) {
              const reason =
                precondition === 'noCode' && entry.machineCode !== null
                  ? 'placeholderCode'
                  : (precondition ?? 'noBank');
              out.push({ importRow, entryId: _id, outcome: `cannotCouple:${reason}` });
              continue;
            }
            const decision = await decideLive(entry, session);
            if (typeof decision !== 'string') {
              out.push({ importRow, entryId: _id, outcome: `cannotCouple:${decision.refused}` });
              continue;
            }
            if (!approved.has(decision)) {
              out.push({ importRow, entryId: _id, outcome: 'notApproved' });
              continue;
            }
            const forex =
              decision !== 'link' &&
              approved.has('nbeForex') &&
              isNbeForexCandidate(entry.bankCode, entry.area) &&
              entry.branchId !== null &&
              (await hasForexLabel(entry.branchId, session));
            const opsLabel = forex ? ATM_NBE_FOREX_LABEL : settings.opsLabel(entry.bankCode);
            const result = await linkUncoupled(entry, opsLabel, ctx.userId, session);
            if (isCouplingRefusal(result)) {
              out.push({ importRow, entryId: _id, outcome: `cannotCouple:${result.refused}` });
              continue;
            }
            await atmRegisterEntryRepository.updateById(
              String(_id),
              {
                machineId: result.machineId,
                opsBankLabel:
                  result.action === 'link'
                    ? result.adoptedBankLabel
                    : forex
                      ? ATM_NBE_FOREX_LABEL
                      : entry.opsBankLabel,
              },
              { by: ctx.userId, version: entry.__v, session },
            );
            pending.push(...result.audits);
            out.push({ importRow, entryId: _id, outcome: OUTCOME_OF[result.action] });
            if (forex) out.push({ importRow, entryId: _id, outcome: 'nbeForex' });
          }
          return { rows: out, audits: pending };
        });
        await recordAll(audits);
        await progress(rows);
      }
    }

    // ── nbeForex on entries already coupled under the default label (D2 edit sync) ───────────
    if (approved.has('nbeForex') && branchIds.length > 0) {
      const candidates = await AtmRegisterEntryModel.find(
        {
          isDeleted: false,
          source: 'import',
          status: 'open',
          bankCode: 'NBE',
          opsBankLabel: null,
          machineId: { $ne: null },
          branchId: { $in: branchIds },
        },
        { _id: 1, area: 1 },
      )
        .sort({ importRow: 1 })
        .lean<{ _id: Types.ObjectId; area: string | null }[]>()
        .exec();
      const fx = candidates.filter((c) => isNbeForexCandidate('NBE', c.area));
      for (const batch of chunks(fx, IMPORT_BATCH_SIZE)) {
        const { rows, audits } = await unitOfWork(async (session) => {
          const out: RunRow[] = [];
          const pending: PendingAudit[] = [];
          for (const { _id } of batch) {
            const before = await AtmRegisterEntryModel.findOne({
              _id,
              isDeleted: false,
              status: 'open',
              opsBankLabel: null,
            })
              .session(session)
              .lean<AtmRegisterEntryDoc>()
              .exec();
            if (before === null || before.branchId === null || before.machineId === null) continue;
            if (!(await hasForexLabel(before.branchId, session))) continue;
            const after = await atmRegisterEntryRepository.updateById(
              String(_id),
              { opsBankLabel: ATM_NBE_FOREX_LABEL },
              { by: ctx.userId, version: before.__v, session },
            );
            pending.push(
              ...(await syncEntryToMaster(
                before,
                after,
                settings.opsLabel('NBE'),
                ATM_NBE_FOREX_LABEL,
                ctx.userId,
                session,
              )),
            );
            out.push({ importRow: before.importRow ?? 0, entryId: _id, outcome: 'nbeForex' });
          }
          return { rows: out, audits: pending };
        });
        await recordAll(audits);
        await progress(rows);
      }
    }

    await AtmRegisterImportRunModel.updateOne(
      { _id: runId },
      { $set: { state: 'completed', finishedAt: new Date(), counts } },
    ).exec();
    await auditService.record({
      entityRef: importAuditRef(String(runId)),
      action: 'atmRegisterImport',
      changes: [
        { field: 'categories', old: null, new: [...approved] },
        { field: 'reportOverride', old: null, new: request.reportOverride },
        { field: 'fileSha256', old: null, new: request.fileSha256 },
        { field: 'counts', old: null, new: { ...counts } },
      ],
    });
    await labelRunAreas(runId, ctx.userId);
    return { runId: String(runId), counts };
  } catch (error) {
    // Never a cell value: an error code, or the error's class name.
    const reason =
      error instanceof AppError ? error.code : error instanceof Error ? error.name : 'Error';
    await AtmRegisterImportRunModel.updateOne(
      { _id: runId },
      { $set: { state: 'failed', finishedAt: new Date(), counts, error: reason } },
    ).exec();
    throw error;
  }
};
