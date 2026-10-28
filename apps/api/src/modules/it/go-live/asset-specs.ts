// The specifications of devices the register already holds — processor, memory and storage, read
// off the IT team's sheet by serial — added, once, by the deploy. «وهبعتلك ملف تانى أسمه (جرد
// الأجهزة) هنشوف فيه الـ سيريال بتاع الجهاز وتاخد بيانات الرام والبروسيسور والهارد وتزودها على
// السيستم».
//
// What the file says (`asset-specs-import.ts`, reviewed with the owner) is what happens:
//   · «وتزودها» — ADDED, never overwritten: a row of the acknowledgment's table the device has no
//     value for gets the sheet's; a value somebody already typed is the IT team's own and is kept,
//     and reported when the sheet says otherwise; every other row of the table is left as it is;
//   · the device is found by its serial as the register spells it — four the sheet mistyped are
//     looked for under the register's spelling — and a serial the register does not hold is
//     reported, never registered: this step adds facts to devices, it adds no device.
//
// ONE TRANSACTION, like the inventory: the specifications, their history and the run row commit
// together or not at all. Each write is conditional on the version read inside the same
// transaction, so an edit saved in between is never overwritten — the run fails, nothing is written,
// and the next boot decides again against what was saved. The audit rows and the platform events
// follow the commit, as every edit's do.
//
// AFTER THE INVENTORY, which registered these devices: until its run row is there this refuses,
// writing nothing, and the next boot tries again.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ItEvents } from '@ecms/contracts';
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { ItAssetModel, type ItAssetDoc, type ItAssetSpecsSub } from '../assets/asset.model';
import { ItAssetEventModel } from '../assets/asset-event.model';
import {
  ensureItGoLiveRunIndexes,
  isItGoLiveRunDone,
  recordItGoLiveRun,
} from './go-live-run.model';
import { IT_INVENTORY_MARK } from './inventory';
import {
  SHEET_SPEC_FIELDS,
  filledSpecs,
  parseAssetSpecs,
  planAssetSpecs,
  targetSerial,
  type AssetSpecsRow,
  type KeptValue,
  type SheetSpecField,
} from './asset-specs-import';

/** The run key — versioned, so a second import is a decision and never a redeploy's accident. */
export const IT_ASSET_SPECS_MARK = 'go-live:it-asset-specs-2026-10:v1';

export const ASSET_SPECS_FILE = 'asset-specs-2026-10.json';

/** What the history says the values came from — the owner's own name for the sheet. */
export const ASSET_SPECS_NOTE = 'من ملف «جرد الأجهزة» — أكتوبر 2026';

/** The table's rows by the names the asset screen gives them, for the history's note. */
const FIELD_LABELS: Readonly<Record<SheetSpecField, string>> = {
  processor: 'المعالج',
  memory: 'إجمالي ذاكرة النظام',
  storage: 'إجمالي سعة الأقراص الصلبة',
};

/** «أُضيفت المواصفات من ملف «جرد الأجهزة» — أكتوبر 2026: المعالج، …» — the rows this step filled. */
export const specsHistoryNote = (fields: readonly SheetSpecField[]): string =>
  `أُضيفت المواصفات ${ASSET_SPECS_NOTE}: ${fields.map((field) => FIELD_LABELS[field]).join('، ')}`;

/**
 * Where the committed file sits at run time: beside the bundle in the deployed image (`tsup`'s
 * `publicDir` copies `assets/` into `dist/`), four levels up under `tsx` — the inventory's two
 * places, each checked before it is used.
 */
const DATA_DIR_CANDIDATES = ['it-go-live', '../../../../assets/it-go-live'];

export const resolveAssetSpecsFile = (): string | null => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of DATA_DIR_CANDIDATES) {
    const file = join(here, candidate, ASSET_SPECS_FILE);
    if (existsSync(file)) return file;
  }
  return null;
};

export type AssetSpecsOutcome =
  | { status: 'alreadyDone' }
  | { status: 'refused'; reason: string }
  | {
      status: 'done';
      rows: number;
      /** Devices something was added to. */
      assets: number;
      filled: Record<SheetSpecField, number>;
      /** Rows found under the register's spelling of a serial the sheet mistyped. */
      corrected: { key: string; serial: string; registerSerial: string; assetCode: string }[];
      /** Devices that already had all three — left exactly as they were. */
      complete: { key: string; assetCode: string }[];
      kept: KeptValue[];
      notFound: { key: string; serial: string }[];
      ambiguous: { key: string; serial: string; assetCodes: string[] }[];
    };

/** What is read of a device on the register. */
type RegisterRow = Pick<
  ItAssetDoc,
  '_id' | 'assetCode' | 'serialNumber' | 'categoryId' | 'specs'
> & { __v?: number };

/** The version the decision was taken against — absent only on a row no write ever touched. */
const versionOf = (row: RegisterRow): { __v: number } | { __v: { $exists: false } } =>
  typeof row.__v === 'number' ? { __v: row.__v } : { __v: { $exists: false } };

type Written = {
  row: RegisterRow;
  fields: SheetSpecField[];
  specs: ItAssetSpecsSub;
};

/**
 * Run the step. Exported so a test can drive it against a real database with rows of its own; the
 * boot reads the committed file (`runItAssetSpecsGoLive`).
 */
export const importItAssetSpecs = async (
  rows: readonly AssetSpecsRow[],
  at: Date = new Date(),
): Promise<AssetSpecsOutcome> => {
  // 0. A run that is done is asked first, outside any transaction; the check inside the
  //    transaction still settles two processes racing.
  if (await isItGoLiveRunDone(IT_ASSET_SPECS_MARK)) return { status: 'alreadyDone' };

  // 1. After the inventory — a run row, once written, is never taken back, so asking once is enough.
  if (!(await isItGoLiveRunDone(IT_INVENTORY_MARK))) {
    return { status: 'refused', reason: 'the IT inventory has not been imported yet' };
  }

  // 2. Every collection exists with its indexes before the transaction writes to it — `autoIndex`
  //    is off in production, and an insert inside a transaction must not be what creates one.
  await Promise.all([
    ItAssetModel.createIndexes(),
    ItAssetEventModel.createIndexes(),
    ensureItGoLiveRunIndexes(),
  ]);

  const run = await unitOfWork(async (session) => {
    if (await isItGoLiveRunDone(IT_ASSET_SPECS_MARK, session)) {
      return { kind: 'alreadyDone' as const };
    }

    // The register as it stands — read inside the transaction, with the versions the writes below
    // are conditional on.
    const registered = await ItAssetModel.find({
      isDeleted: false,
      serialNumber: { $type: 'string' },
    })
      .select({ assetCode: 1, serialNumber: 1, categoryId: 1, specs: 1, __v: 1 })
      .session(session)
      .lean<RegisterRow[]>()
      .exec();
    const byId = new Map(registered.map((row) => [String(row._id), row]));
    const decisions = planAssetSpecs(
      rows,
      registered.map((row) => ({
        id: String(row._id),
        assetCode: row.assetCode,
        serialNumber: row.serialNumber ?? '',
        specs: row.specs ?? null,
      })),
    );

    const written: Written[] = [];
    for (const decision of decisions) {
      if (decision.kind !== 'found') continue;
      const fields = SHEET_SPEC_FIELDS.filter((field) => decision.fill[field] !== undefined);
      const row = byId.get(decision.device.id);
      if (fields.length === 0 || row === undefined) continue;
      const specs = filledSpecs(row.specs, decision.fill);
      // Only the device exactly as read above. Anything else means somebody saved it while this
      // ran: the whole run rolls back and the next boot decides again.
      const result = await ItAssetModel.updateOne(
        { _id: row._id, isDeleted: false, ...versionOf(row) },
        { $set: { specs, updatedBy: null }, $inc: { __v: 1 } },
        { session },
      ).exec();
      if (result.matchedCount !== 1) {
        throw new Error(
          `asset ${row.assetCode} changed while its specifications were being added — nothing was written; the next boot decides again`,
        );
      }
      written.push({ row, fields, specs });
    }

    // The history's own write: the go-live is nobody's hand, so no actor.
    const events = written.map(({ row, fields }) => ({
      subjectId: row._id,
      type: 'updated',
      at,
      actorUserId: null,
      actorName: '',
      metadata: { fields: fields.map((field) => `specs.${field}`) },
      notes: specsHistoryNote(fields),
    }));
    if (events.length > 0) await ItAssetEventModel.insertMany(events, { session });

    const found = decisions.flatMap((decision) => (decision.kind === 'found' ? [decision] : []));
    const outcome = {
      rows: rows.length,
      assets: written.length,
      filled: Object.fromEntries(
        SHEET_SPEC_FIELDS.map((field) => [
          field,
          written.filter((entry) => entry.fields.includes(field)).length,
        ]),
      ) as Record<SheetSpecField, number>,
      corrected: found.flatMap(({ row, device }) =>
        row.registerSerial === null
          ? []
          : [
              {
                key: row.key,
                serial: row.serial,
                registerSerial: row.registerSerial,
                assetCode: device.assetCode,
              },
            ],
      ),
      complete: found
        .filter(({ fill }) => Object.keys(fill).length === 0)
        .map(({ row, device }) => ({ key: row.key, assetCode: device.assetCode })),
      kept: found.flatMap(({ kept }) => kept),
      notFound: decisions.flatMap((decision) =>
        decision.kind === 'notFound'
          ? [{ key: decision.row.key, serial: targetSerial(decision.row) }]
          : [],
      ),
      ambiguous: decisions.flatMap((decision) =>
        decision.kind === 'ambiguous'
          ? [
              {
                key: decision.row.key,
                serial: targetSerial(decision.row),
                assetCodes: decision.assetCodes,
              },
            ]
          : [],
      ),
    };
    await recordItGoLiveRun(IT_ASSET_SPECS_MARK, outcome, session);
    return { kind: 'done' as const, outcome, written };
  });

  if (run.kind === 'alreadyDone') return { status: 'alreadyDone' };

  // After the commit, as every edit: the audit trail — and through it the realtime refresh of
  // anybody looking at the register — and the platform's event.
  for (const { row, fields, specs } of run.written) {
    await auditService.record({
      entityRef: { moduleId: 'it', entityType: 'asset', entityId: String(row._id) },
      action: 'update',
      changes: [
        ...fields.map((field) => ({
          field: `specs.${field}`,
          old: row.specs?.[field] ?? null,
          new: specs[field],
        })),
        { field: 'source', old: null, new: IT_ASSET_SPECS_MARK },
      ],
    });
    await emit(ItEvents.AssetUpdated, {
      assetId: String(row._id),
      assetCode: row.assetCode,
      categoryId: String(row.categoryId),
    });
  }
  return { status: 'done', ...run.outcome };
};

/** Read the committed file and run it once; say what happened. Exported so a test can await it. */
export const runItAssetSpecsGoLive = async (): Promise<void> => {
  const file = resolveAssetSpecsFile();
  if (file === null) {
    logger.error(
      `it go-live: ${ASSET_SPECS_FILE} is not in the build — the devices' specifications were not added`,
    );
    return;
  }
  const { devices } = parseAssetSpecs(JSON.parse(await readFile(file, 'utf8')));
  const outcome = await importItAssetSpecs(devices);
  if (outcome.status === 'refused') {
    logger.warn(
      { reason: outcome.reason },
      "it go-live: the devices' specifications were NOT added — nothing was written; the next boot tries again",
    );
  } else if (outcome.status === 'done') {
    logger.warn(
      outcome,
      "it go-live: the devices' specifications were added — done, and never again",
    );
  }
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — the inventory's terms.
 */
export const startItAssetSpecsGoLive = (): void => {
  if (isTest) return;
  void runItAssetSpecsGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      "it go-live: adding the devices' specifications failed — no boot was harmed",
    );
  });
};
