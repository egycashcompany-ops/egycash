// Applying a Full list import (docs/12-planning/atm-settlements-phase1.md §5.4, S-1, DS-7).
//
// The caller re-read the file and re-planned it against the database as it is NOW; this writes
// what the mode allows of that plan:
//
//   1. THE LOCK. Runs of this branch × bank left `running` past `STALE_RUN_MS` are abandoned (the
//      register's takeover), then this run's row is inserted `running`; `ux_one_running` refuses a
//      second one (409 `ATM_LAYOUT_IMPORT_RUNNING`).
//   2. ROWS, ONE SMALL TRANSACTION EACH, in file order. A row whose revision moved since the
//      preview (or that the preview did not list) is a conflict and is never written (SEC-8). A
//      `new` row inserts its layout and version row; a `changed` / `changedManual` row moves the
//      layout by compare-and-set on `__v` and `revision`, then appends its version row. An E11000
//      or a missed CAS aborts THAT row's transaction and is counted OUTSIDE it, in `conflicts` — in
//      MongoDB a duplicate key aborts the transaction it happens in (the map batch's shape). Each
//      row's audit is recorded as soon as it commits.
//   3. STANDARD LOADS AND THE RUN ROW, one transaction: each `new` standard row becomes a profile
//      (`label: null`, the next `order`), the default only when the branch × bank has none and the
//      row is row 1; `ux_default` is the race guard — on its E11000 the transaction is run again
//      with no default. In the same transaction the run gets its counts and `state: 'done'`.
//   4. FAILURE. Anything else marks the run `failed`, with the counts so far, and is rethrown;
//      committed rows stay, and re-running the same file finds them `same`.
//   5. AUDITS after the run commits: one `atmLayoutImport` row with the counts, one `create` per
//      standard load. The run row and the audits hold counts only — no code, no cell.
import {
  ErrorCodes,
  type AtmBankCode,
  type AtmCassetteSlot,
  type AtmLayoutImportMode,
  type AtmLayoutImportOutcome,
  type AtmLayoutImportPreviewRevision,
  type AtmLayoutImportRowDto,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../../platform/audit';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { ConflictError, StaleDocumentError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { diffChanges } from '../../../../shared/utils/diff';
import { redactedErrorText } from '../../atm-indexes';
import { STALE_RUN_MS } from '../../register/import/plan-import';
import { actorName } from '../../shared/atm-context';
import {
  AtmCassetteLayoutModel,
  type AtmCassetteLayoutDoc,
} from '../layouts/cassette-layout.model';
import { AtmCassetteLayoutVersionModel } from '../layouts/cassette-layout-version.model';
import { isDuplicateKey } from '../shared/settlement-context';
import { runSettlementHook } from '../shared/test-hooks';
import {
  AtmStandardLoadModel,
  type AtmStandardLoadDoc,
} from '../standard-loads/standard-load.model';
import { liveStandardLoads } from '../standard-loads/standard-load.service';
import { AtmLayoutImportRunModel } from './layout-import-run.model';
import { type LayoutImportPlan } from './plan-layout-import';

export interface ApplyLayoutImportRequest {
  branchId: string;
  bankCode: AtmBankCode;
  fileName: string;
  fileSha256: string;
  mode: AtmLayoutImportMode;
  standardLoads: boolean;
  previewRevisions: readonly AtmLayoutImportPreviewRevision[];
}

export interface ApplyLayoutImportCounts {
  created: number;
  updated: number;
  standardLoadsCreated: number;
  conflicts: number;
}

/** Which outcomes each mode writes (DS-7). */
const APPLIED: Readonly<Record<AtmLayoutImportMode, ReadonlySet<AtmLayoutImportOutcome>>> = {
  newOnly: new Set(['new']),
  newAndChanged: new Set(['new', 'changed']),
  overwriteManual: new Set(['new', 'changed', 'changedManual']),
};

const layoutRef = (machineId: string) => ({
  moduleId: 'atm',
  entityType: 'cassetteLayout',
  entityId: machineId,
});

const standardLoadRef = (id: string) => ({
  moduleId: 'atm',
  entityType: 'standardLoad',
  entityId: id,
});

const plain = (slots: readonly AtmCassetteSlot[]): AtmCassetteSlot[] =>
  slots.map((s) => ({
    slot: s.slot,
    kind: s.kind,
    denomination: s.denomination ?? null,
    currency: s.currency ?? null,
  }));

const labelsOf = (row: AtmLayoutImportRowDto) => ({
  typeLabel: row.typeLabel.after,
  featuresLabel: row.featuresLabel.after,
  hubLabel: row.hubLabel.after,
});

/** Write the plan's applicable rows, the standard loads and the run. Throws after marking `failed`. */
export const applyLayoutImport = async (
  plan: LayoutImportPlan,
  layouts: ReadonlyMap<string, AtmCassetteLayoutDoc>,
  request: ApplyLayoutImportRequest,
  ctx: AuthContext,
): Promise<{ runId: string; counts: ApplyLayoutImportCounts }> => {
  const branchId = new Types.ObjectId(request.branchId);
  const by = new Types.ObjectId(ctx.userId);
  const name = actorName(ctx);
  const startedAt = new Date();

  // 1. The lock.
  await AtmLayoutImportRunModel.updateMany(
    {
      branchId,
      bankCode: request.bankCode,
      state: 'running',
      startedAt: { $lt: new Date(startedAt.getTime() - STALE_RUN_MS) },
    },
    { $set: { state: 'abandoned', finishedAt: startedAt } },
  ).exec();
  let runId: Types.ObjectId;
  try {
    const [run] = await AtmLayoutImportRunModel.create([
      {
        branchId,
        bankCode: request.bankCode,
        fileName: request.fileName.slice(0, 200),
        fileSha256: request.fileSha256,
        state: 'running',
        startedAt,
        finishedAt: null,
        mode: request.mode,
        standardLoads: request.standardLoads,
        counts: {},
        actorName: name,
        error: null,
        createdBy: by,
        updatedBy: by,
      },
    ]);
    runId = (run as { _id: Types.ObjectId })._id;
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new ConflictError(
        'another import of this bank is running in this branch',
        ErrorCodes.ATM_LAYOUT_IMPORT_RUNNING,
      );
    }
    throw error;
  }
  await runSettlementHook('layoutImport.afterRunInsert');

  const counts: ApplyLayoutImportCounts = {
    created: 0,
    updated: 0,
    standardLoadsCreated: 0,
    conflicts: 0,
  };
  const runCounts = (): Record<string, number> => ({ ...plan.counts, ...counts });
  const previewed = new Map(request.previewRevisions.map((p) => [p.machineId, p.revision]));
  const applies = APPLIED[request.mode];
  let done = false;
  let failure: unknown;
  let createdLoads: AtmStandardLoadDoc[] = [];

  try {
    // 2. Rows, one transaction each.
    for (const row of plan.rows) {
      if (!applies.has(row.outcome) || row.machineId === null || row.after === null) continue;
      const machineId = row.machineId;
      if (!previewed.has(machineId) || previewed.get(machineId) !== row.revision) {
        counts.conflicts += 1;
        continue;
      }
      await runSettlementHook('layoutImport.beforeRow');
      const after = plain(row.after);
      const labels = labelsOf(row);
      const current = layouts.get(machineId) ?? null;
      try {
        await unitOfWork(async (session) => {
          const now = new Date();
          let doc: AtmCassetteLayoutDoc | null;
          if (row.outcome === 'new') {
            const [created] = await AtmCassetteLayoutModel.create(
              [
                {
                  machineId: new Types.ObjectId(machineId),
                  branchId,
                  slots: after,
                  ...labels,
                  standardLoadId: null,
                  revision: 1,
                  source: 'import',
                  changedByName: name,
                  changedAt: now,
                  createdBy: by,
                  updatedBy: by,
                },
              ],
              { session },
            );
            doc = (created?.toObject() as AtmCassetteLayoutDoc | undefined) ?? null;
          } else {
            if (current === null) throw new StaleDocumentError();
            doc = await AtmCassetteLayoutModel.findOneAndUpdate(
              {
                _id: current._id,
                __v: current.__v,
                revision: current.revision,
                isDeleted: false,
              },
              {
                $set: {
                  slots: after,
                  ...labels,
                  revision: current.revision + 1,
                  source: 'import',
                  changedByName: name,
                  changedAt: now,
                  updatedBy: by,
                },
                $inc: { __v: 1 },
              },
              { new: true, session },
            )
              .lean<AtmCassetteLayoutDoc>()
              .exec();
          }
          if (doc === null) throw new StaleDocumentError();
          await AtmCassetteLayoutVersionModel.create(
            [
              {
                layoutId: doc._id,
                machineId: doc.machineId,
                branchId,
                revision: doc.revision,
                slots: after,
                ...labels,
                standardLoadId: doc.standardLoadId,
                source: 'import',
                reason: null,
                importRunId: runId,
                changedBy: by,
                changedByName: name,
                changedAt: now,
                createdBy: by,
                updatedBy: by,
              },
            ],
            { session },
          );
        });
      } catch (error) {
        if (isDuplicateKey(error) || error instanceof StaleDocumentError) {
          counts.conflicts += 1;
          continue;
        }
        throw error;
      }
      if (row.outcome === 'new') counts.created += 1;
      else counts.updated += 1;
      await auditService.record({
        entityRef: layoutRef(machineId),
        action: row.outcome === 'new' ? 'create' : 'update',
        changes: diffChanges(
          current === null
            ? {}
            : {
                slots: plain(current.slots),
                typeLabel: current.typeLabel,
                featuresLabel: current.featuresLabel,
                hubLabel: current.hubLabel,
              },
          { slots: after, ...labels },
        ),
      });
    }

    // 3. Standard loads and the run row, one transaction.
    const finish = async (noDefault: boolean): Promise<AtmStandardLoadDoc[]> =>
      unitOfWork(async (session) => {
        const created: AtmStandardLoadDoc[] = [];
        if (request.standardLoads) {
          const existing = await liveStandardLoads(branchId, request.bankCode, session);
          let hasDefault = existing.some((load) => load.isDefault);
          const last = await AtmStandardLoadModel.findOne({ branchId, bankCode: request.bankCode })
            .sort({ order: -1 })
            .session(session)
            .lean<AtmStandardLoadDoc>()
            .exec();
          let order = last === null ? 0 : last.order + 1;
          for (const standard of plan.standardLoads) {
            if (standard.outcome !== 'new') continue;
            const isDefault = !noDefault && !hasDefault && standard.row === 1;
            const [doc] = await AtmStandardLoadModel.create(
              [
                {
                  branchId,
                  bankCode: request.bankCode,
                  label: null,
                  isDefault,
                  order,
                  notes: standard.notes,
                  createdBy: by,
                  updatedBy: by,
                },
              ],
              { session },
            );
            if (doc !== undefined) created.push(doc.toObject() as AtmStandardLoadDoc);
            if (isDefault) hasDefault = true;
            order += 1;
          }
        }
        await AtmLayoutImportRunModel.updateOne(
          { _id: runId, state: 'running' },
          {
            $set: {
              state: 'done',
              finishedAt: new Date(),
              counts: { ...runCounts(), standardLoadsCreated: created.length },
            },
          },
          { session },
        ).exec();
        return created;
      });
    try {
      createdLoads = await finish(false);
    } catch (error) {
      // `ux_default`: another writer set a default meanwhile — the profiles are created without one.
      if (!isDuplicateKey(error)) throw error;
      createdLoads = await finish(true);
    }
    counts.standardLoadsCreated = createdLoads.length;
    done = true;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    // 4. Failure: the run keeps the counts so far and the error's name; committed rows stay.
    if (!done) {
      await AtmLayoutImportRunModel.updateOne(
        { _id: runId, state: 'running' },
        {
          $set: {
            state: 'failed',
            finishedAt: new Date(),
            counts: runCounts(),
            error: failure === undefined ? null : redactedErrorText(failure),
          },
        },
      )
        .exec()
        .catch(() => undefined);
    }
  }

  // 5. Audits, after the run committed.
  await auditService.record({
    entityRef: { moduleId: 'atm', entityType: 'layoutImport', entityId: String(runId) },
    action: 'atmLayoutImport',
    changes: [
      { field: 'bankCode', old: null, new: request.bankCode },
      { field: 'branchId', old: null, new: request.branchId },
      { field: 'mode', old: null, new: request.mode },
      { field: 'counts', old: null, new: runCounts() },
    ],
  });
  for (const load of createdLoads) {
    await auditService.record({
      entityRef: standardLoadRef(String(load._id)),
      action: 'create',
      changes: diffChanges(
        {},
        {
          label: load.label,
          isDefault: load.isDefault,
          notes: load.notes.map((n) => ({ denomination: n.denomination, notes: n.notes })),
        },
      ),
    });
  }
  return { runId: String(runId), counts };
};
