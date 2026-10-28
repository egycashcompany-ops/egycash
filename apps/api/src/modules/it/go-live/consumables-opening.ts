// The consumables the IT team holds — the owner's count, approved («دخّل الأرصدة») — entered in its
// store, once, by the deploy.
//
// What the file says (`consumables-opening-import.ts`, reviewed with the owner) is what happens:
//   · every item is added to the store of the branch the file names, filed under its type, its code
//     the next of the register's series;
//   · each comes in by ONE `received` movement of the counted quantity, noted with the file's
//     source, and its counters are what that movement makes of an empty item — so the opening
//     balance, like every quantity in the store, has a movement behind it (ADR-024: there is no
//     «set on hand to N»);
//   · an item the store already keeps under that name IS that item: the count is received into it,
//     never a second stock beside it, and the outcome names it.
//
// ASKED OF THE LIVE SYSTEM, NOT ASSUMED. The branch is found by name in the organisation's list and
// never created; the types are the catalog's own rows, by code or Arabic name
// (`consumable-type-defaults.ts`). A missing or retired one refuses the whole run before anything
// is written, and the next boot tries again.
//
// AFTER THE TYPES. Every item is filed under a type, and the types are the other step's to write
// (`consumable-types.ts`): this one waits for its run row, refusing until it is there — and,
// started beside it in the same boot, lets it land first (`itConsumableTypesSettled`).
//
// ONE TRANSACTION, like the mobile lines: the items, their codes (one block), the movements, the
// counters and the run row commit together or not at all — a process killed half-way leaves
// nothing, and a second process racing the first conflicts and finds the run row on its retry. The
// audit rows follow the commit, as every stock movement's do.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { branchRepository } from '../../../platform/organization';
import { ItConsumableModel, type ItConsumableDoc } from '../consumables/consumable.model';
import {
  ItConsumableMovementModel,
  type ItConsumableMovementDoc,
} from '../consumables/consumable-movement.model';
import { itConsumableRepository } from '../consumables/consumable.repository';
import { CONSUMABLE_SEQUENCE_KEY, formatConsumableCode } from '../consumables/consumable-number';
import {
  NO_STOCK,
  beforeStockEffect,
  stockEffect,
  type ConsumableCounters,
} from '../consumables/consumable-stock';
import {
  auditConsumableCreated,
  auditStockMovement,
  change,
  consumableItemRow,
  consumableMovementRow,
  ensureItConsumableCollections,
} from '../consumables/consumable-history';
import { reserveSequenceBlock } from '../shared/sequence';
import { matchConsumableTypes, type ItConsumableTypeCode } from './consumable-type-defaults';
import {
  IT_CONSUMABLE_TYPES_MARK,
  itConsumableTypesSettled,
  readConsumableTypes,
} from './consumable-types';
import {
  matchStoreItems,
  parseConsumablesOpening,
  type ConsumableOpeningItem,
  type ConsumablesOpeningFile,
} from './consumables-opening-import';
import {
  ensureItGoLiveRunIndexes,
  isItGoLiveRunDone,
  recordItGoLiveRun,
} from './go-live-run.model';
import { matchBranches } from './inventory-import';

/** The run key — versioned, so a second count is a decision and never a redeploy's accident. */
export const IT_CONSUMABLES_OPENING_MARK = 'go-live:it-consumables-opening-2026-10:v1';

export const CONSUMABLES_OPENING_FILE = 'consumables-opening-2026-10.json';

/**
 * Where the committed file sits at run time: beside the bundle in the deployed image (`tsup`'s
 * `publicDir` copies `assets/` into `dist/`), four levels up under `tsx` — the inventory's two
 * places, each checked before it is used.
 */
const DATA_DIR_CANDIDATES = ['it-go-live', '../../../../assets/it-go-live'];

export const resolveConsumablesOpeningFile = (): string | null => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of DATA_DIR_CANDIDATES) {
    const file = join(here, candidate, CONSUMABLES_OPENING_FILE);
    if (existsSync(file)) return file;
  }
  return null;
};

/** An item the store already kept under a row's name, which the count was received into. */
export interface ReusedItem {
  key: string;
  code: string;
  name: string;
  /** Retired by the IT team: it holds the count now, and stays retired until they say otherwise. */
  retired: boolean;
}

export type ConsumablesOpeningOutcome =
  | { status: 'alreadyDone' }
  | { status: 'refused'; reason: string }
  | {
      status: 'done';
      branch: string;
      items: number;
      created: number;
      reused: ReusedItem[];
      /** Every unit received, all items together. */
      units: number;
      firstCode: string | null;
      lastCode: string | null;
      byType: Record<string, number>;
    };

type Entry = {
  row: ConsumableOpeningItem;
  /** The new item as written, or the kept one as it stands after the count. */
  item: ItConsumableDoc;
  created: boolean;
  movementId: Types.ObjectId;
  before: ConsumableCounters;
};

/**
 * Run the import. Exported so a test can drive it against a real database with a file of its own;
 * the boot reads the committed one (`runItConsumablesOpeningGoLive`).
 */
export const importItConsumablesOpening = async (
  file: ConsumablesOpeningFile,
  at: Date = new Date(),
): Promise<ConsumablesOpeningOutcome> => {
  // 0. A run that is done is asked first, outside any transaction: it must not read the
  //    organisation again on every boot, nor report «not entered» because the branch was renamed
  //    since. The check inside the transaction still settles two processes racing.
  if (await isItGoLiveRunDone(IT_CONSUMABLES_OPENING_MARK)) return { status: 'alreadyDone' };

  // 1. The branch, before anything is written: matched, never created.
  const match = matchBranches(
    (await branchRepository.listAll()).map((branch) => ({
      id: String(branch._id),
      name: branch.name,
      status: branch.status,
    })),
  ).get(file.branch) ?? { kind: 'missing' as const };
  if (match.kind !== 'found') {
    return {
      status: 'refused',
      reason: `branch not found in the organisation: ${file.branch}: ${match.kind}`,
    };
  }
  const branchId = new Types.ObjectId(match.branch.id);

  // 2. Every collection exists with its indexes before the transaction inserts into it — `autoIndex`
  //    is off in production, and an insert inside a transaction must not be what creates one.
  await Promise.all([ensureItConsumableCollections(), ensureItGoLiveRunIndexes()]);

  const run = await unitOfWork(async (session) => {
    if (await isItGoLiveRunDone(IT_CONSUMABLES_OPENING_MARK, session)) {
      return { kind: 'alreadyDone' as const };
    }
    if (!(await isItGoLiveRunDone(IT_CONSUMABLE_TYPES_MARK, session))) {
      return { kind: 'refused' as const, reason: 'the consumable types have not been seeded yet' };
    }

    // The types the file names, as the catalog holds them now — read inside the transaction, like
    // everything this decides on.
    const types = matchConsumableTypes(await readConsumableTypes(session));
    const typeIds = new Map<ItConsumableTypeCode, Types.ObjectId>();
    const unusable: string[] = [];
    for (const code of new Set(file.items.map((row) => row.type))) {
      const type = types.get(code) ?? { kind: 'missing' as const };
      if (type.kind === 'found') typeIds.set(code, new Types.ObjectId(type.type.id));
      else unusable.push(`${code}: ${type.kind}`);
    }
    if (unusable.length > 0) {
      return {
        kind: 'refused' as const,
        reason: `consumable types not usable: ${unusable.join('; ')}`,
      };
    }

    // What the store keeps already — read inside the transaction, so an item added a moment ago is
    // seen too, and received into rather than doubled.
    const kept = await ItConsumableModel.find({ branchId, isDeleted: false })
      .select({ code: 1, name: 1, active: 1 })
      .sort({ _id: 1 })
      .session(session)
      .lean<Pick<ItConsumableDoc, '_id' | 'code' | 'name' | 'active'>[]>()
      .exec();
    const existing = matchStoreItems(
      file.items,
      kept.map((item) => ({
        id: String(item._id),
        code: item.code,
        name: item.name,
        active: item.active,
      })),
    );

    // The new items' codes, as ONE block taken inside the transaction: in the file's order — the
    // owner's sheet, which the register reads in by default — and given back whole on a rollback.
    const fresh = file.items.filter((row) => existing.get(row.key) == null);
    const firstSeq =
      fresh.length === 0
        ? 0
        : await reserveSequenceBlock(CONSUMABLE_SEQUENCE_KEY, fresh.length, session);
    const createdByKey = new Map(
      fresh.map((row, index) => [
        row.key,
        {
          _id: new Types.ObjectId(),
          ...consumableItemRow({
            code: formatConsumableCode(firstSeq + index),
            name: row.name,
            typeId: typeIds.get(row.type) as Types.ObjectId,
            unit: row.unit,
            branchId,
            openingQty: row.qty,
          }),
        } as ItConsumableDoc,
      ]),
    );
    const created = [...createdByKey.values()];
    if (created.length > 0) await ItConsumableModel.insertMany(created, { session });

    // The rest into the items the store keeps — through the store's one write that moves a
    // counter. Even a retired item takes its count: the count is what is on the shelf, and the
    // name is that item's (a store keeps one per name, so there is no room for a second).
    const entries: Entry[] = [];
    const reused: ReusedItem[] = [];
    for (const row of file.items) {
      const effect = stockEffect('received', row.qty);
      const live = existing.get(row.key) ?? null;
      const item =
        live === null
          ? (createdByKey.get(row.key) as ItConsumableDoc)
          : await itConsumableRepository.moveStock(live.id, effect, { session, by: null });
      if (live !== null) {
        reused.push({ key: row.key, code: item.code, name: item.name, retired: !item.active });
      }
      entries.push({
        row,
        item,
        created: live === null,
        movementId: new Types.ObjectId(),
        before: live === null ? NO_STOCK : beforeStockEffect(item, effect),
      });
    }

    // ONE delivery per item — the go-live is nobody's hand, so no user.
    const movements = entries.map(
      (entry) =>
        ({
          _id: entry.movementId,
          ...consumableMovementRow({
            item: entry.item,
            kind: 'received',
            qty: entry.row.qty,
            at,
            byUserId: null,
            notes: file.source,
          }),
        }) as ItConsumableMovementDoc,
    );
    await ItConsumableMovementModel.insertMany(movements, { session });

    const byType: Record<string, number> = {};
    for (const { row } of entries) byType[row.type] = (byType[row.type] ?? 0) + 1;
    const outcome = {
      branch: file.branch,
      items: entries.length,
      created: created.length,
      reused,
      units: entries.reduce((sum, { row }) => sum + row.qty, 0),
      firstCode: created[0]?.code ?? null,
      lastCode: created.at(-1)?.code ?? null,
      byType,
    };
    await recordItGoLiveRun(IT_CONSUMABLES_OPENING_MARK, outcome, session);
    return { kind: 'done' as const, outcome, entries };
  });

  if (run.kind === 'alreadyDone') return { status: 'alreadyDone' };
  if (run.kind === 'refused') return { status: 'refused', reason: run.reason };

  // After the commit, as every stock movement: the audit trail — and through it the realtime
  // refresh of anybody looking at the store.
  for (const { item, created, movementId, before } of run.entries) {
    if (created) await auditConsumableCreated(item);
    await auditStockMovement({
      consumableId: String(item._id),
      kind: 'received',
      before,
      after: item,
      extra: [
        change('movementId', null, String(movementId)),
        change('source', null, IT_CONSUMABLES_OPENING_MARK),
      ],
    });
  }
  return { status: 'done', ...run.outcome };
};

/** Read the committed file and run it once; say what happened. Exported so a test can await it. */
export const runItConsumablesOpeningGoLive = async (): Promise<void> => {
  // Started in the same boot as the types it files under: let them land first.
  await itConsumableTypesSettled();
  const path = resolveConsumablesOpeningFile();
  if (path === null) {
    logger.error(
      `it go-live: ${CONSUMABLES_OPENING_FILE} is not in the build — the consumables opening stock was not entered`,
    );
    return;
  }
  const file = parseConsumablesOpening(JSON.parse(await readFile(path, 'utf8')));
  const outcome = await importItConsumablesOpening(file);
  if (outcome.status === 'refused') {
    logger.warn(
      { reason: outcome.reason },
      'it go-live: the consumables opening stock was NOT entered — nothing was written; the next boot tries again',
    );
  } else if (outcome.status === 'done') {
    logger.warn(
      outcome,
      'it go-live: the consumables opening stock was entered — done, and never again',
    );
  }
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — the inventory's terms.
 */
export const startItConsumablesOpeningGoLive = (): void => {
  if (isTest) return;
  void runItConsumablesOpeningGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'it go-live: entering the consumables opening stock failed — no boot was harmed',
    );
  });
};
