// The October all-in-ones — 97 Lenovo ThinkCentre neo 50a 24 for the October branch — registered,
// once, by the deploy. «هبعتلك سيريلات أجهزة عايز أرفعها بنفس مواصفات Lenovo ThinkCentre neo 50a 24
// جهاز كمبيوتر AIO بس هيكون فى فرع أكتوبر ومش متسلم لحد».
//
// What the file says (`aio-october-import.ts`, reviewed with the owner) is what happens:
//   · every serial is a NEW asset in the October branch, in stock — «ومش متسلم لحد»: nobody holds
//     it and no receipt is written;
//   · «بنفس مواصفات»: each is a copy of the device the register already holds by that exact name —
//     its category, maker, model, specifications and accessories — and of nothing that belongs to
//     that one machine: its serial, purchase, warranty, place, holder and notes stay its own. When
//     the register holds no such device, the file's maker and model, filed where the inventory files
//     an all-in-one.
//
// ASKED OF THE LIVE SYSTEM, NOT ASSUMED. The branch is found by name in the organisation's list and
// never created; missing or inactive, the run is refused before anything is written, and the next
// boot tries again. A serial the register already holds is a device somebody registered since the
// sheet was sent: it is left alone, and reported.
//
// NO HISTORY ENTRY, like every registration: the register's own form and the inventory write none,
// so FR-5's window stays open — a device registered here in error can still be deleted, as one
// typed in by hand can. The audit row names the run as the source.
//
// ONE TRANSACTION, like the inventory: the assets, their codes and the run row commit together or
// not at all — a process killed half-way leaves nothing, and a second process racing
// the first conflicts and finds the run row on its retry. The audit rows and the platform events
// follow the commit, as every registration's do.
//
// AFTER THE INVENTORY. The device copied is one the inventory registered, and the category an
// all-in-one falls back to is one it made; until its run row is there this refuses, writing
// nothing, and the next boot tries again.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { ItEvents } from '@ecms/contracts';
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { branchRepository } from '../../../platform/organization';
import { ItAssetModel, type ItAssetDoc, type ItAssetSpecsSub } from '../assets/asset.model';
import { ASSET_SEQUENCE_KEY, formatAssetCode } from '../assets/asset-number';
import { ItCatalogItemModel } from '../catalog-items/catalog-item.model';
import { reserveSequenceBlock } from '../shared/sequence';
import {
  ensureItGoLiveRunIndexes,
  isItGoLiveRunDone,
  recordItGoLiveRun,
} from './go-live-run.model';
import { IT_INVENTORY_MARK } from './inventory';
import { matchBranches } from './inventory-import';
import {
  copySpecs,
  inventoryCategoryFor,
  parseAioOctober,
  pickTemplate,
  type AioOctoberFile,
} from './aio-october-import';

/** The run key — versioned, so a second import is a decision and never a redeploy's accident. */
export const IT_AIO_OCTOBER_MARK = 'go-live:it-aio-october-2026-10:v1';

export const AIO_OCTOBER_FILE = 'aio-october-2026-10.json';

/** What the asset says it came from — the owner's own name for the sheet. */
export const AIO_OCTOBER_NOTE =
  'من ملف الأرقام التسلسلية «SN ايجي كاش» لأجهزة فرع أكتوبر — أكتوبر 2026';

/**
 * Where the committed file sits at run time: beside the bundle in the deployed image (`tsup`'s
 * `publicDir` copies `assets/` into `dist/`), four levels up under `tsx` — the inventory's two
 * places, each checked before it is used.
 */
const DATA_DIR_CANDIDATES = ['it-go-live', '../../../../assets/it-go-live'];

export const resolveAioOctoberFile = (): string | null => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of DATA_DIR_CANDIDATES) {
    const file = join(here, candidate, AIO_OCTOBER_FILE);
    if (existsSync(file)) return file;
  }
  return null;
};

export type AioOctoberOutcome =
  | { status: 'alreadyDone' }
  | { status: 'refused'; reason: string }
  | {
      status: 'done';
      assets: number;
      firstCode: string | null;
      lastCode: string | null;
      branch: string;
      /** The register's device the copies were made from; null when the file's fields were used. */
      template: { assetCode: string } | null;
      category: { id: string; name: string | null };
      skippedSerials: { key: string; serial: string; existing: string }[];
    };

/** What is read of a register device that may be the one the owner named. */
type TemplateRow = Pick<
  ItAssetDoc,
  '_id' | 'assetCode' | 'categoryId' | 'manufacturer' | 'model' | 'specs' | 'accessories'
> & { updatedAt?: Date | null };

/** What every copy carries — the template's, or the file's when the register has no template. */
interface Pattern {
  categoryId: Types.ObjectId;
  manufacturer: string | null;
  model: string | null;
  specs: ItAssetSpecsSub | null;
  accessories: string[];
}

/**
 * Run the import. Exported so a test can drive it against a real database with a file of its own;
 * the boot reads the committed one (`runItAioOctoberGoLive`).
 */
export const importItAioOctober = async (
  file: Pick<AioOctoberFile, 'branch' | 'template' | 'devices'>,
): Promise<AioOctoberOutcome> => {
  // 0. A run that is done is asked first, outside any transaction: it must not read the
  //    organisation again on every boot, nor report «not imported» because the branch was renamed
  //    since. The check inside the transaction still settles two processes racing.
  if (await isItGoLiveRunDone(IT_AIO_OCTOBER_MARK)) return { status: 'alreadyDone' };

  // 1. After the inventory — a run row, once written, is never taken back, so asking once is enough.
  if (!(await isItGoLiveRunDone(IT_INVENTORY_MARK))) {
    return { status: 'refused', reason: 'the IT inventory has not been imported yet' };
  }

  // 2. The branch, before anything is written: matched, never created.
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
      reason: `branches not found in the organisation: ${file.branch}: ${match.kind}`,
    };
  }
  const branchId = new Types.ObjectId(match.branch.id);

  // 3. Every collection exists with its indexes before the transaction inserts into it — `autoIndex`
  //    is off in production, and an insert inside a transaction must not be what creates one.
  await Promise.all([ItAssetModel.createIndexes(), ensureItGoLiveRunIndexes()]);

  const run = await unitOfWork(async (session) => {
    if (await isItGoLiveRunDone(IT_AIO_OCTOBER_MARK, session)) {
      return { kind: 'alreadyDone' as const };
    }

    // The device the owner named — by EXACTLY its name, so a neighbouring model is never copied.
    // Read in a fixed order, so two edited at the same moment (the inventory registered its two in
    // one write) resolve to the first registered, on every boot alike.
    const namesakes = await ItAssetModel.find({ name: file.template.name, isDeleted: false })
      .select({
        assetCode: 1,
        categoryId: 1,
        manufacturer: 1,
        model: 1,
        specs: 1,
        accessories: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1, _id: 1 })
      .session(session)
      .lean<TemplateRow[]>()
      .exec();
    const template = pickTemplate(namesakes);

    const live = (
      await ItCatalogItemModel.find({ kind: 'assetCategory', isDeleted: false })
        .session(session)
        .lean()
        .exec()
    ).map((item) => ({ id: String(item._id), name: item.name, isActive: item.isActive }));

    let pattern: Pattern;
    if (template !== null) {
      pattern = {
        categoryId: template.categoryId,
        manufacturer: template.manufacturer,
        model: template.model,
        specs: template.specs == null ? null : copySpecs(template.specs),
        accessories: [...(template.accessories ?? [])],
      };
    } else {
      const category = inventoryCategoryFor(live, file.template.category);
      if (category === null) {
        return {
          kind: 'refused' as const,
          reason: `no asset category to file ${file.template.category} under, and no ${file.template.name} on the register to copy`,
        };
      }
      pattern = {
        categoryId: new Types.ObjectId(category.id),
        manufacturer: file.template.manufacturer,
        model: file.template.model,
        specs: null,
        accessories: [],
      };
    }

    // A serial the register already holds is a device registered since the sheet was sent —
    // compared without case, as the inventory compares, and under the barcode's spelling too: the
    // label carries a leading «S» that is not part of the serial (the file's are without it), so a
    // device the IT team scanned in is the same device. Read inside the transaction, so a device
    // registered a moment ago is seen too.
    const registered = await ItAssetModel.find({
      isDeleted: false,
      serialNumber: { $type: 'string' },
    })
      .select({ serialNumber: 1, assetCode: 1 })
      .session(session)
      .lean<Pick<ItAssetDoc, 'serialNumber' | 'assetCode'>[]>()
      .exec();
    const taken = new Map(
      registered.map((asset) => [(asset.serialNumber ?? '').toUpperCase(), asset.assetCode]),
    );
    const skippedSerials: { key: string; serial: string; existing: string }[] = [];
    const fresh = file.devices.filter((device) => {
      const serial = device.serial.toUpperCase();
      const existing = taken.get(serial) ?? taken.get(`S${serial}`);
      if (existing === undefined) return true;
      skippedSerials.push({ key: device.key, serial: device.serial, existing });
      return false;
    });

    // Their codes, taken inside the transaction: a rollback gives every one of them back.
    const firstCode =
      fresh.length === 0
        ? 0
        : await reserveSequenceBlock(ASSET_SEQUENCE_KEY, fresh.length, session);
    const assets = fresh.map(
      (device, index) =>
        ({
          _id: new Types.ObjectId(),
          assetCode: formatAssetCode(firstCode + index),
          name: file.template.name,
          description: null,
          categoryId: pattern.categoryId,
          status: 'inStock',
          serialNumber: device.serial,
          model: pattern.model,
          manufacturer: pattern.manufacturer,
          externalTag: null,
          branchId,
          location: null,
          purchase: null,
          warranty: null,
          currentAssignmentId: null,
          disposal: null,
          notes: AIO_OCTOBER_NOTE,
          // Each copy its own object: one asset edited later must not be every asset edited.
          specs: pattern.specs === null ? null : copySpecs(pattern.specs),
          accessories: [...pattern.accessories],
        }) as unknown as ItAssetDoc,
    );
    if (assets.length > 0) await ItAssetModel.insertMany(assets, { session });

    const outcome = {
      assets: assets.length,
      firstCode: assets[0]?.assetCode ?? null,
      lastCode: assets.at(-1)?.assetCode ?? null,
      branch: match.branch.name.ar,
      template: template === null ? null : { assetCode: template.assetCode },
      category: {
        id: String(pattern.categoryId),
        name: live.find((item) => item.id === String(pattern.categoryId))?.name.ar ?? null,
      },
      skippedSerials,
    };
    await recordItGoLiveRun(IT_AIO_OCTOBER_MARK, outcome, session);
    return { kind: 'done' as const, outcome, assets };
  });

  if (run.kind === 'alreadyDone') return { status: 'alreadyDone' };
  if (run.kind === 'refused') return { status: 'refused', reason: run.reason };

  // After the commit, as every registration: the audit trail — and through it the realtime
  // refresh of anybody looking at the register — and the platform's event.
  for (const asset of run.assets) {
    await auditService.record({
      entityRef: { moduleId: 'it', entityType: 'asset', entityId: String(asset._id) },
      action: 'create',
      changes: [
        { field: 'assetCode', old: null, new: asset.assetCode },
        { field: 'serialNumber', old: null, new: asset.serialNumber },
        { field: 'status', old: null, new: asset.status },
        { field: 'source', old: null, new: IT_AIO_OCTOBER_MARK },
      ],
    });
    await emit(ItEvents.AssetRegistered, {
      assetId: String(asset._id),
      assetCode: asset.assetCode,
      categoryId: String(asset.categoryId),
    });
  }
  return { status: 'done', ...run.outcome };
};

/** Read the committed file and run it once; say what happened. Exported so a test can await it. */
export const runItAioOctoberGoLive = async (): Promise<void> => {
  const file = resolveAioOctoberFile();
  if (file === null) {
    logger.error(
      `it go-live: ${AIO_OCTOBER_FILE} is not in the build — the October all-in-ones were not registered`,
    );
    return;
  }
  const outcome = await importItAioOctober(
    parseAioOctober(JSON.parse(await readFile(file, 'utf8'))),
  );
  if (outcome.status === 'refused') {
    logger.warn(
      { reason: outcome.reason },
      'it go-live: the October all-in-ones were NOT registered — nothing was written; the next boot tries again',
    );
  } else if (outcome.status === 'done') {
    logger.warn(
      outcome,
      'it go-live: the October all-in-ones were registered — done, and never again',
    );
  }
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — the inventory's terms.
 */
export const startItAioOctoberGoLive = (): void => {
  if (isTest) return;
  void runItAioOctoberGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'it go-live: registering the October all-in-ones failed — no boot was harmed',
    );
  });
};
