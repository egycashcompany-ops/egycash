// The branches' custody — five sheets, one per branch — added to the register, once, by the deploy.
// «هبعتلك عهده الأفرع وعايزك تضيفهم مره واحده كل فرع فى فرعه فى الـ IT».
//
// What the file says (`branch-custody-import.ts`, reviewed with the owner) is what happens:
//   · a `new` line — one the review found nowhere on the register — whose device the register
//     still does not hold is a NEW asset in the sheet's branch, in stock, its tag its serial
//     number as the October inventory registered every Dell. Only a `new` line registers: a
//     fill or move line whose device the register no longer holds is reported (`notFound`) and
//     registers nothing — it carries no name or category;
//   · a line is found by its serial, its tag and the review's match against every live device's
//     serial number and printed tag, without case — and an October all-in-one's serial
//     («MP30EP…», eight characters) also against the serial number its barcode reads, with the
//     leading «S» that is not part of the serial: the October step takes the two for one device
//     (`aio-october.ts`), so one the IT team scanned in by its barcode is found, not `notFound`.
//     Only that shape: no other serial grows an «S» twin;
//   · the line's OTHER label — a Dell screen's «CN-0…» beside its service tag — becomes the
//     asset's printed tag (`externalTag`). That is NEW in this step: the October inventory left
//     every device's `externalTag` empty, so only «the tag is the serial number» has its precedent;
//   · «أكمّل الناقص بس» — a device the register holds gets what it has no value for: rows of the
//     specifications' table, accessories, the printed label, maker and model. A value already on
//     the register is kept, and reported where the sheet disagrees; nothing is overwritten;
//   · «كل فرع فى فرعه» / «انقلهم لفرع الملف» — a device in stock in another branch is moved to the
//     sheet's. A device somebody holds is NOT moved — custody moves a held device, with its paper,
//     never this step — and is reported; what it lacks is still filled, and with nothing to fill
//     it is not written at all;
//   · a moved device leaves its `location` behind: a location names a place inside the branch it
//     has left — two head-office screens moved in stock sat in the head office's «مخزن IT», which
//     is no place in Tanta or Shorouk — so the same conditional write that sets the branch clears
//     it, and the `transferred` entry, the `transfer` audit row and the report's `moved` line say
//     which place was cleared. A device not moved keeps its location: a fill never touches it;
//   · a line the review left out writes nothing and is reported with its reason — every reason
//     alike:
//       `noSerialOrTag`  — nothing identifies it: «لو مفيش تاجات فخلاص متضيفهمش»;
//       `repeatedSerial` — it repeats another line's serial;
//       `serialDisputed` — the inventory found its serial twice, gave it to one device and
//                          registered the other without it: which one is the sheet's waits for
//                          somebody to read the label;
//       `nearSerial`     — two characters off the serial of a device its sheet does not list;
//       `notASerial`     — its only label is HP's product number («…AV»), not the unit's serial.
//
// ASKED OF THE LIVE SYSTEM, NOT ASSUMED. Branches are found by name in the organisation's list and
// never created; a new device's category is its own kind's live one, by any of the inventory's
// names for it — never created, and never another kind's (a phone with no «هاتف IP» category is
// not filed as a desktop). Anything missing refuses the whole run before anything is written, and
// the next boot tries again.
//
// ONE TRANSACTION, like the steps before it: the new assets, their codes, every fill and move,
// their history and the run row commit together or not at all. Each write is conditional on the
// version read inside the same transaction — and a move on the device still being in stock with
// nobody holding it — so an edit or a hand-over saved in between is never overwritten: the run
// fails, nothing is written, and the next boot decides again. The audit rows and the platform
// events follow the commit, as every registration's, edit's and transfer's do.
//
// NO HISTORY ENTRY FOR A NEW ASSET, like every registration — FR-5's window stays open, so a device
// registered here in error can still be deleted. A fill writes an `updated` entry and a move a
// `transferred` one, as the asset-specs step and the custody transfer write theirs.
//
// AFTER THE INVENTORY, THE OCTOBER ALL-IN-ONES AND THE SPECIFICATIONS. The devices the sheets name
// are theirs — the moved «MP30EP…» devices are the October batch, and the specifications step
// fills from its own sheet first — so until all three run rows are there this refuses, writing
// nothing, and the next boot tries again.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types, type ClientSession } from 'mongoose';
import { ItEvents } from '@ecms/contracts';
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { branchRepository } from '../../../platform/organization';
import { ItAssetModel, type ItAssetDoc, type ItAssetSpecsSub } from '../assets/asset.model';
import { ItAssetEventModel } from '../assets/asset-event.model';
import { ASSET_SEQUENCE_KEY, formatAssetCode } from '../assets/asset-number';
import { ItCatalogItemModel } from '../catalog-items/catalog-item.model';
import { reserveSequenceBlock } from '../shared/sequence';
import { IT_AIO_OCTOBER_MARK } from './aio-october';
import { IT_ASSET_SPECS_MARK } from './asset-specs';
import {
  custodyCategoriesFor,
  custodySet,
  custodyValueOf,
  newAssetNotes,
  newAssetSpecs,
  parseBranchCustody,
  planBranchCustody,
  reportBranchCustody,
  transferredHistoryNote,
  updatedHistoryNote,
  writesAsset,
  type BranchCustodyFile,
  type BranchCustodyReport,
  type CustodyAsset,
  type CustodySet,
  type FoundCustodyDecision,
} from './branch-custody-import';
import {
  ensureItGoLiveRunIndexes,
  isItGoLiveRunDone,
  recordItGoLiveRun,
} from './go-live-run.model';
import { IT_INVENTORY_MARK } from './inventory';
import { matchBranches, type InventoryBranch } from './inventory-import';

/** The run key — versioned, so a second import is a decision and never a redeploy's accident. */
export const IT_BRANCH_CUSTODY_MARK = 'go-live:it-branch-custody-2026-11:v1';

export const BRANCH_CUSTODY_FILE = 'branch-custody-2026-11.json';

/** The steps whose devices the sheets name — every one done before this one runs. */
export const BRANCH_CUSTODY_AFTER = [
  IT_INVENTORY_MARK,
  IT_AIO_OCTOBER_MARK,
  IT_ASSET_SPECS_MARK,
] as const;

/**
 * Where the committed file sits at run time: beside the bundle in the deployed image (`tsup`'s
 * `publicDir` copies `assets/` into `dist/`), four levels up under `tsx` — the inventory's two
 * places, each checked before it is used.
 */
const DATA_DIR_CANDIDATES = ['it-go-live', '../../../../assets/it-go-live'];

export const resolveBranchCustodyFile = (): string | null => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of DATA_DIR_CANDIDATES) {
    const file = join(here, candidate, BRANCH_CUSTODY_FILE);
    if (existsSync(file)) return file;
  }
  return null;
};

export type BranchCustodyOutcome =
  | { status: 'alreadyDone' }
  | { status: 'refused'; reason: string }
  | ({ status: 'done' } & BranchCustodyReport);

// ── The write path — this step's, and the asset register's bulk upload's ─────────────────────
//
// «في الأصول عايز زرار Bulk Upload للأصول بنفس شكل عهدة الأفرع» (2026-11-16): the upload decides
// the same sheets by the same planner and writes what it decided through THESE functions, not a
// second copy of them — the version-conditional write, the move that clears the place, the history
// entries, the codes reserved in one block, then the audit rows and the events after the commit.
// What differs is who writes (`CustodyActor`: nobody for a deploy, the caller for an upload), the
// words each history entry says, and the `source` the audit rows name.

/** What is read of a device on the register. */
export type CustodyRegisterRow = Pick<
  ItAssetDoc,
  | '_id'
  | 'assetCode'
  | 'serialNumber'
  | 'externalTag'
  | 'branchId'
  | 'status'
  | 'currentAssignmentId'
  | 'categoryId'
  | 'specs'
  | 'accessories'
  | 'manufacturer'
  | 'model'
  | 'location'
> & { __v?: number };

/** The version the decision was taken against — absent only on a row no write ever touched. */
const versionOf = (row: CustodyRegisterRow): { __v: number } | { __v: { $exists: false } } =>
  typeof row.__v === 'number' ? { __v: row.__v } : { __v: { $exists: false } };

/**
 * The register as it stands — read inside the caller's transaction, with the versions the writes
 * are conditional on. Every live device, whatever its branch: a serial is unique across the whole
 * register, so a line is matched against all of it, by its serial AND its printed tag. With no
 * session (an upload's preview, which writes nothing) it is the register as committed.
 */
export const readCustodyRegister = (session: ClientSession | null): Promise<CustodyRegisterRow[]> =>
  ItAssetModel.find({ isDeleted: false })
    .select({
      assetCode: 1,
      serialNumber: 1,
      externalTag: 1,
      branchId: 1,
      status: 1,
      currentAssignmentId: 1,
      categoryId: 1,
      specs: 1,
      accessories: 1,
      manufacturer: 1,
      model: 1,
      location: 1,
      __v: 1,
    })
    .session(session)
    .lean<CustodyRegisterRow[]>()
    .exec();

/** A device of the register as the planner reads it. */
export const custodyAssetOf = (row: CustodyRegisterRow): CustodyAsset => ({
  id: String(row._id),
  assetCode: row.assetCode,
  serialNumber: row.serialNumber ?? null,
  externalTag: row.externalTag ?? null,
  branchId: String(row.branchId),
  status: row.status,
  currentAssignmentId: row.currentAssignmentId == null ? null : String(row.currentAssignmentId),
  specs: row.specs ?? null,
  accessories: row.accessories ?? [],
  manufacturer: row.manufacturer ?? null,
  model: row.model ?? null,
  location: row.location ?? null,
});

/** Who writes: nobody for the go-live — a deploy is nobody's hand — and the caller for an upload. */
export interface CustodyActor {
  userId: string;
  /** As the history shows it, the way custody's own entries name their actor. */
  name: string;
}

/** A device the plan writes — something to fill or a move (`writesAsset`) — and its history's words. */
export interface CustodyUpdate {
  decision: Pick<FoundCustodyDecision, 'asset' | 'fill' | 'fields' | 'move'>;
  /** The `updated` entry's notes — written only when `decision.fields` names something. */
  updatedNote: string;
  /** The `transferred` entry's notes — written only when `decision.move` is set. */
  transferredNote: string;
}

/** A device the plan registers, with everything it is filed with. */
export interface CustodyNewAsset {
  name: string;
  categoryId: Types.ObjectId;
  serialNumber: string;
  externalTag: string | null;
  branchId: string;
  manufacturer: string | null;
  model: string | null;
  specs: ItAssetSpecsSub | null;
  accessories: string[];
  notes: string;
}

export interface CustodyWritten {
  updates: { row: CustodyRegisterRow; update: CustodyUpdate; set: CustodySet }[];
  /** The new assets, in the order they were given — their codes one reserved block. */
  assets: ItAssetDoc[];
}

/**
 * Write a plan inside the caller's transaction. Each device only exactly as it was read (`register`,
 * read in the SAME transaction) — and, to move it, still in stock with nobody holding it. Anything
 * else means somebody saved it or handed it over meanwhile: `changed` names the error that rolls
 * the whole transaction back. A move clears the device's place in the branch it leaves, in the
 * same write; nothing else ever touches its location. A device filled AND moved gets both entries.
 * No history entry for a new asset, like every registration (FR-5's window stays open).
 */
export const writeCustody = async (
  plan: {
    register: ReadonlyMap<string, CustodyRegisterRow>;
    updates: readonly CustodyUpdate[];
    creates: readonly CustodyNewAsset[];
    at: Date;
    actor: CustodyActor | null;
    changed: (assetCode: string) => Error;
  },
  session: ClientSession,
): Promise<CustodyWritten> => {
  const by = plan.actor === null ? null : new Types.ObjectId(plan.actor.userId);
  // The go-live's rows carry no stamp at all, as they always have; an upload's carry its caller.
  const stamp = by === null ? {} : { createdBy: by, updatedBy: by };

  const updates: CustodyWritten['updates'] = [];
  for (const update of plan.updates) {
    const row = plan.register.get(update.decision.asset.id);
    if (row === undefined) continue;
    const set = custodySet(update.decision.asset, update.decision.fill);
    const move = update.decision.move;
    const result = await ItAssetModel.updateOne(
      {
        _id: row._id,
        isDeleted: false,
        ...versionOf(row),
        ...(move === null ? {} : { status: 'inStock', currentAssignmentId: null }),
      },
      {
        $set: {
          ...set,
          ...(move === null
            ? {}
            : { branchId: new Types.ObjectId(move.toBranchId), location: null }),
          updatedBy: by,
        },
        $inc: { __v: 1 },
      },
      { session },
    ).exec();
    if (result.matchedCount !== 1) throw plan.changed(row.assetCode);
    updates.push({ row, update, set });
  }

  const actor = { actorUserId: by, actorName: plan.actor?.name ?? '' };
  const events = updates.flatMap(({ row, update: { decision, updatedNote, transferredNote } }) => [
    ...(decision.fields.length === 0
      ? []
      : [
          {
            subjectId: row._id,
            type: 'updated',
            at: plan.at,
            ...actor,
            metadata: { fields: decision.fields },
            notes: updatedNote,
            ...stamp,
          },
        ]),
    ...(decision.move === null
      ? []
      : [
          {
            subjectId: row._id,
            type: 'transferred',
            at: plan.at,
            ...actor,
            metadata: {
              fromBranchId: decision.move.fromBranchId,
              toBranchId: decision.move.toBranchId,
            },
            notes: transferredNote,
            ...stamp,
          },
        ]),
  ]);
  if (events.length > 0) await ItAssetEventModel.insertMany(events, { session });

  // The new devices, in the order given. Their codes are taken inside the transaction: a rollback
  // gives every one of them back.
  const firstCode =
    plan.creates.length === 0
      ? 0
      : await reserveSequenceBlock(ASSET_SEQUENCE_KEY, plan.creates.length, session);
  const assets = plan.creates.map(
    (create, index) =>
      ({
        _id: new Types.ObjectId(),
        assetCode: formatAssetCode(firstCode + index),
        name: create.name,
        description: null,
        categoryId: create.categoryId,
        status: 'inStock',
        serialNumber: create.serialNumber,
        model: create.model,
        manufacturer: create.manufacturer,
        externalTag: create.externalTag,
        branchId: new Types.ObjectId(create.branchId),
        location: null,
        purchase: null,
        warranty: null,
        currentAssignmentId: null,
        disposal: null,
        notes: create.notes,
        specs: create.specs,
        accessories: [...create.accessories],
        ...stamp,
      }) as unknown as ItAssetDoc,
  );
  if (assets.length > 0) await ItAssetModel.insertMany(assets, { session });
  return { updates, assets };
};

/**
 * After the commit, as every registration, edit and transfer: the audit trail — and through it the
 * realtime refresh of anybody looking at the register — and the platform's events. `source` is
 * what each audit row says the change came from. The actor is the request's, when there is one.
 */
export const recordCustodyWritten = async (
  written: CustodyWritten,
  source: string,
): Promise<void> => {
  for (const asset of written.assets) {
    await auditService.record({
      entityRef: { moduleId: 'it', entityType: 'asset', entityId: String(asset._id) },
      action: 'create',
      changes: [
        { field: 'assetCode', old: null, new: asset.assetCode },
        { field: 'serialNumber', old: null, new: asset.serialNumber },
        { field: 'status', old: null, new: asset.status },
        { field: 'source', old: null, new: source },
      ],
    });
    await emit(ItEvents.AssetRegistered, {
      assetId: String(asset._id),
      assetCode: asset.assetCode,
      categoryId: String(asset.categoryId),
    });
  }
  for (const {
    row,
    update: { decision },
    set,
  } of written.updates) {
    const entityRef = { moduleId: 'it', entityType: 'asset', entityId: String(row._id) };
    if (decision.fields.length > 0) {
      await auditService.record({
        entityRef,
        action: 'update',
        changes: [
          ...decision.fields.map((field) => ({
            field,
            old: custodyValueOf(decision.asset, field),
            new: custodyValueOf(set, field),
          })),
          { field: 'source', old: null, new: source },
        ],
      });
      await emit(ItEvents.AssetUpdated, {
        assetId: String(row._id),
        assetCode: row.assetCode,
        categoryId: String(row.categoryId),
      });
    }
    if (decision.move !== null) {
      await auditService.record({
        entityRef,
        action: 'transfer',
        changes: [
          { field: 'branchId', old: decision.move.fromBranchId, new: decision.move.toBranchId },
          // The place it had in the branch it left — cleared with the move.
          ...(decision.move.location === null
            ? []
            : [{ field: 'location', old: decision.move.location, new: null }]),
          { field: 'source', old: null, new: source },
        ],
      });
      await emit(ItEvents.AssetTransferred, {
        assetId: String(row._id),
        assetCode: row.assetCode,
        fromEmployeeId: null,
        toEmployeeId: null,
        fromBranchId: decision.move.fromBranchId,
        toBranchId: decision.move.toBranchId,
      });
    }
  }
};

/**
 * Run the step. Exported so a test can drive it against a real database with lines of its own;
 * the boot reads the committed file (`runItBranchCustodyGoLive`).
 */
export const importItBranchCustody = async (
  file: Pick<BranchCustodyFile, 'devices'>,
  at: Date = new Date(),
): Promise<BranchCustodyOutcome> => {
  // 0. A run that is done is asked first, outside any transaction: it must not read the
  //    organisation again on every boot. The check inside the transaction still settles two
  //    processes racing.
  if (await isItGoLiveRunDone(IT_BRANCH_CUSTODY_MARK)) return { status: 'alreadyDone' };

  // 1. After the steps whose devices these are — a run row, once written, is never taken back, so
  //    asking once is enough.
  const waiting: string[] = [];
  for (const mark of BRANCH_CUSTODY_AFTER) {
    if (!(await isItGoLiveRunDone(mark))) waiting.push(mark);
  }
  if (waiting.length > 0) {
    return { status: 'refused', reason: `not imported yet: ${waiting.join(', ')}` };
  }

  // 2. Every branch the file names — where a line is, and where a moved device was — before
  //    anything is written: matched, never created.
  const live = await branchRepository.listAll();
  const matches = matchBranches(
    live.map((branch) => ({ id: String(branch._id), name: branch.name, status: branch.status })),
  );
  const named = new Set<InventoryBranch>(
    file.devices.flatMap((row) =>
      row.action === 'move' ? [row.branch, row.fromBranch] : [row.branch],
    ),
  );
  const branchIds = new Map<InventoryBranch, string>();
  const unmatched: string[] = [];
  for (const name of named) {
    const match = matches.get(name) ?? { kind: 'missing' as const };
    if (match.kind === 'found') branchIds.set(name, match.branch.id);
    else unmatched.push(`${name}: ${match.kind}`);
  }
  if (unmatched.length > 0) {
    return {
      status: 'refused',
      reason: `branches not found in the organisation: ${unmatched.join('; ')}`,
    };
  }
  const branchNames = new Map(live.map((branch) => [String(branch._id), branch.name.ar]));

  // 3. The category each new device is filed under — its OWN kind's live category, by any of the
  //    names the inventory accepts for it; never created, and never another kind's. A kind with
  //    none (no «هاتف IP», «شاشة», «طابعة» or «لابتوب» category) refuses the run, nothing written:
  //    the all-in-ones' fallback to the desktops is not this step's.
  const { categories, missing } = custodyCategoriesFor(
    (await ItCatalogItemModel.find({ kind: 'assetCategory', isDeleted: false }).lean().exec()).map(
      (item) => ({ id: String(item._id), name: item.name, isActive: item.isActive }),
    ),
    file.devices.flatMap((row) => (row.action === 'new' ? [row.category] : [])),
  );
  if (missing.length > 0) {
    return { status: 'refused', reason: `no asset category to file ${missing.join(', ')} under` };
  }
  const categoryIds = new Map(
    [...categories].map(([key, category]) => [key, new Types.ObjectId(category.id)] as const),
  );

  // 4. Every collection exists with its indexes before the transaction writes to it — `autoIndex`
  //    is off in production, and an insert inside a transaction must not be what creates one.
  await Promise.all([
    ItAssetModel.createIndexes(),
    ItAssetEventModel.createIndexes(),
    ensureItGoLiveRunIndexes(),
  ]);

  const run = await unitOfWork(async (session) => {
    if (await isItGoLiveRunDone(IT_BRANCH_CUSTODY_MARK, session)) {
      return { kind: 'alreadyDone' as const };
    }

    // The register as it stands — read inside the transaction, with the versions the writes below
    // are conditional on (`readCustodyRegister`).
    const registered = await readCustodyRegister(session);
    const decisions = planBranchCustody(file.devices, registered.map(custodyAssetOf), branchIds);

    const written = await writeCustody(
      {
        register: new Map(registered.map((row) => [String(row._id), row])),
        // Only a device with something to fill or a move is written: a held device in another
        // branch with nothing it lacks is only reported (`writesAsset`).
        updates: decisions.flatMap((decision) =>
          writesAsset(decision)
            ? [
                {
                  decision,
                  updatedNote: updatedHistoryNote(decision.row, decision.fields),
                  transferredNote:
                    decision.move === null
                      ? ''
                      : transferredHistoryNote(decision.row, decision.move.location),
                },
              ]
            : [],
        ),
        // The new devices, in the file's order.
        creates: decisions.flatMap((decision) =>
          decision.kind === 'create'
            ? [
                {
                  name: decision.row.name,
                  categoryId: categoryIds.get(decision.row.category) as Types.ObjectId,
                  serialNumber: decision.serialNumber,
                  externalTag: decision.externalTag,
                  branchId: decision.branchId,
                  manufacturer: decision.row.manufacturer,
                  model: decision.row.model,
                  specs: newAssetSpecs(decision.row.specs),
                  accessories: [...decision.row.accessories],
                  notes: newAssetNotes(decision.row),
                },
              ]
            : [],
        ),
        at,
        // The go-live is nobody's hand: no actor on the history, none on the rows.
        actor: null,
        // The whole run rolls back and the next boot decides again.
        changed: (assetCode) =>
          new Error(
            `asset ${assetCode} changed while the branches' custody was being added — nothing was written; the next boot decides again`,
          ),
      },
      session,
    );

    const outcome = reportBranchCustody(
      decisions,
      written.assets.map((asset) => asset.assetCode),
      (id) => branchNames.get(id) ?? id,
    );
    await recordItGoLiveRun(IT_BRANCH_CUSTODY_MARK, { ...outcome }, session);
    return { kind: 'done' as const, outcome, written };
  });

  if (run.kind === 'alreadyDone') return { status: 'alreadyDone' };

  // After the commit, as every registration, edit and transfer: the audit trail — and through it
  // the realtime refresh of anybody looking at the register — and the platform's events.
  await recordCustodyWritten(run.written, IT_BRANCH_CUSTODY_MARK);
  return { status: 'done', ...run.outcome };
};

/** Read the committed file and run it once; say what happened. Exported so a test can await it. */
export const runItBranchCustodyGoLive = async (): Promise<void> => {
  const file = resolveBranchCustodyFile();
  if (file === null) {
    logger.error(
      `it go-live: ${BRANCH_CUSTODY_FILE} is not in the build — the branches' custody was not added`,
    );
    return;
  }
  const outcome = await importItBranchCustody(
    parseBranchCustody(JSON.parse(await readFile(file, 'utf8'))),
  );
  if (outcome.status === 'refused') {
    logger.warn(
      { reason: outcome.reason },
      "it go-live: the branches' custody was NOT added — nothing was written; the next boot tries again",
    );
  } else if (outcome.status === 'done') {
    logger.warn(outcome, "it go-live: the branches' custody was added — done, and never again");
  }
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — the inventory's terms.
 */
export const startItBranchCustodyGoLive = (): void => {
  if (isTest) return;
  void runItBranchCustodyGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      "it go-live: adding the branches' custody failed — no boot was harmed",
    );
  });
};
