// The IT inventory — every device in the head office and the six branches — registered, once, by
// the deploy. «عايز أعدل حاجة تانية في الـ IT … فهحتاج منك بمعلومية الفرع والإدارة والاسم الثنائي
// تظبط أنت الأسماء … وتسلمه الأجهزة اللى معاه … ولو مكتوب مخزن يبقي مش متسلم … الأفرع كل
// الأجهزة والأصول اللى فيها خليها مش متسلمه».
//
// What the file says (`inventory-import.ts`, reviewed with the owner) is what happens:
//   · every device is registered, filed under its kind, in its branch;
//   · a head-office device the review settled is handed over to that employee — one receipt per
//     employee, every device of theirs a page of it, the next numbers of the form;
//   · everything else is in stock: the IT store, every branch device, and the head-office devices
//     whose holder the review did not settle, each with the sheet's name for whoever had it.
//
// ASKED OF THE LIVE SYSTEM, NOT ASSUMED. Branches are found by name in the organisation's list and
// never created; a missing or inactive one refuses the whole run before anything is written, and
// the next boot tries again. An employee HR no longer has, or who has left, gets nothing — their
// devices stay in stock. A serial the register already holds is a device somebody registered
// since the sheet was made: it is left alone, and reported.
//
// ONE TRANSACTION, like the asset restart: the assets, their custody, the receipts, their codes
// and numbers and the run row commit together or not at all — a process killed half-way leaves
// nothing, and a second process racing the first conflicts and finds the run row on its retry.
// The audit rows and the platform events follow the commit, as every custody write's do.
//
// AFTER THE RESTART. The asset restart keeps one asset by its code and deletes the rest; on a
// database where it has not decided yet, an import before it would be the rest. So this waits for
// its run row, refusing until it is there.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { ItEvents } from '@ecms/contracts';
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { auditService } from '../../../platform/audit';
import { getDirectoryEmployeeByCode } from '../../../platform/directory';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { branchRepository } from '../../../platform/organization';
import { ItAssetModel, type ItAssetDoc } from '../assets/asset.model';
import { ItAssetAssignmentModel, type ItAssetAssignmentDoc } from '../assets/assignment.model';
import { ItAssetEventModel } from '../assets/asset-event.model';
import { ItCustodyReceiptModel, type ItCustodyReceiptDoc } from '../assets/receipt.model';
import { itCustodyReceiptRepository } from '../assets/receipt.repository';
import { ASSET_SEQUENCE_KEY, formatAssetCode } from '../assets/asset-number';
import { RECEIPT_SEQUENCE_KEY } from '../assets/receipt-number';
import { readReceiptHolder, type ReceiptHolder } from '../assets/receipt-holder';
import { receiptDeviceFields } from '../assets/receipt-device';
import { auditReceiptIssued, signer } from '../assets/custody.service';
import { ItCatalogItemModel } from '../catalog-items/catalog-item.model';
import { reserveSequenceBlock } from '../shared/sequence';
import { IT_ASSET_RESTART_MARK } from './asset-restart';
import {
  ensureItGoLiveRunIndexes,
  isItGoLiveRunDone,
  recordItGoLiveRun,
} from './go-live-run.model';
import {
  INVENTORY_CATEGORIES,
  INVENTORY_CATEGORY_KEYS,
  matchBranches,
  matchCategories,
  parseInventory,
  type InventoryBranch,
  type InventoryCategoryKey,
  type InventoryDevice,
} from './inventory-import';

/** The run key — versioned, so a second import is a decision and never a redeploy's accident. */
export const IT_INVENTORY_MARK = 'go-live:it-inventory-2026-10:v1';

export const INVENTORY_FILE = 'inventory-2026-10.json';

/** What the custody interval and its history say it came from. */
export const INVENTORY_NOTE = 'من جرد أجهزة تقنية المعلومات — أكتوبر 2026';

/**
 * Where the committed file sits at run time: beside the bundle in the deployed image (`tsup`'s
 * `publicDir` copies `assets/` into `dist/`), four levels up under `tsx` — the fleet import's two
 * places, each checked before it is used.
 */
const DATA_DIR_CANDIDATES = ['it-go-live', '../../../../assets/it-go-live'];

export const resolveInventoryFile = (): string | null => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of DATA_DIR_CANDIDATES) {
    const file = join(here, candidate, INVENTORY_FILE);
    if (existsSync(file)) return file;
  }
  return null;
};

/** A head-office device the review handed over that stays in stock after all, and why. */
export interface HeldDevice {
  key: string;
  holderCode: string;
  reason: 'unknownEmployee' | 'leftCompany';
}

export type InventoryOutcome =
  | { status: 'alreadyDone' }
  | { status: 'refused'; reason: string }
  | {
      status: 'done';
      assets: number;
      inStock: number;
      assigned: number;
      receipts: number;
      firstCode: string | null;
      lastCode: string | null;
      firstReceipt: number | null;
      lastReceipt: number | null;
      byBranch: Record<string, number>;
      categories: { key: string; name: string; created: boolean }[];
      skippedSerials: { key: string; serial: string; existing: string }[];
      held: HeldDevice[];
    };

type Created = { asset: ItAssetDoc; device: InventoryDevice };

/** «في الجرد مع: …» — what a device left in stock says it was found with, when the sheet says. */
const foundWith = (device: InventoryDevice): string | null =>
  device.holder === null ? null : `في الجرد مع: ${device.holder}`;

const joinNotes = (...parts: (string | null)[]): string | null => {
  const kept = parts.filter((part): part is string => part !== null && part !== '');
  return kept.length === 0 ? null : [...new Set(kept)].join('، ');
};

/**
 * Run the import. Exported so a test can drive it against a real database with a file of its own;
 * the boot reads the committed one (`runItInventoryGoLive`).
 */
export const importItInventory = async (
  devices: readonly InventoryDevice[],
  at: Date = new Date(),
): Promise<InventoryOutcome> => {
  // 1. Branches, before anything is written: matched, never created.
  const branchMatches = matchBranches(
    (await branchRepository.listAll()).map((branch) => ({
      id: String(branch._id),
      name: branch.name,
      status: branch.status,
    })),
  );
  const branchIds = new Map<InventoryBranch, Types.ObjectId>();
  const unmatched: string[] = [];
  for (const [name, match] of branchMatches) {
    if (!devices.some((device) => device.branch === name)) continue;
    if (match.kind === 'found') branchIds.set(name, new Types.ObjectId(match.branch.id));
    else unmatched.push(`${name}: ${match.kind}`);
  }
  if (unmatched.length > 0) {
    return {
      status: 'refused',
      reason: `branches not found in the organisation: ${unmatched.join('; ')}`,
    };
  }

  // 2. The employees, by code — HR's answer is read before the transaction, as a hand-over reads
  //    it; who they are on the receipt is the same snapshot a hand-over takes.
  const holders = new Map<string, { employeeId: string; holder: ReceiptHolder }>();
  const refused = new Map<string, HeldDevice['reason']>();
  for (const code of new Set(devices.flatMap((device) => device.holderCode ?? []))) {
    const employee = await getDirectoryEmployeeByCode(code);
    if (employee === null) refused.set(code, 'unknownEmployee');
    else if (employee.status === 'exited') refused.set(code, 'leftCompany');
    else {
      holders.set(code, {
        employeeId: employee.employeeId,
        holder: await readReceiptHolder(employee.employeeId),
      });
    }
  }

  // 3. Every collection exists with its indexes before the transaction inserts into it — `autoIndex`
  //    is off in production, and an insert inside a transaction must not be what creates one.
  await Promise.all([
    ItAssetModel.createIndexes(),
    ItAssetAssignmentModel.createIndexes(),
    ItAssetEventModel.createIndexes(),
    ItCatalogItemModel.createIndexes(),
    itCustodyReceiptRepository.ensureCollection(),
    ensureItGoLiveRunIndexes(),
  ]);

  const run = await unitOfWork(async (session) => {
    if (await isItGoLiveRunDone(IT_INVENTORY_MARK, session))
      return { kind: 'alreadyDone' as const };
    if (!(await isItGoLiveRunDone(IT_ASSET_RESTART_MARK, session))) {
      return { kind: 'refused' as const, reason: 'the asset restart has not decided yet' };
    }

    // The categories: the IT team's own where they have one, a new one where not.
    const live = await ItCatalogItemModel.find({ kind: 'assetCategory', isDeleted: false })
      .session(session)
      .lean()
      .exec();
    const matched = matchCategories(
      live.map((item) => ({ id: String(item._id), name: item.name, isActive: item.isActive })),
    );
    const categories = new Map<
      InventoryCategoryKey,
      { id: Types.ObjectId; name: string; created: boolean }
    >();
    for (const key of INVENTORY_CATEGORY_KEYS) {
      const existing = matched.get(key) ?? null;
      if (existing !== null) {
        categories.set(key, {
          id: new Types.ObjectId(existing.id),
          name: existing.name.ar,
          created: false,
        });
        continue;
      }
      const wanted = INVENTORY_CATEGORIES[key].create;
      if (wanted === null) continue; // filed with the desktops below
      const [created] = await ItCatalogItemModel.create(
        [
          {
            kind: 'assetCategory',
            code: null,
            name: wanted,
            description: null,
            sortOrder: 0,
            isActive: true,
          },
        ],
        { session },
      );
      if (created === undefined) throw new Error(`category ${wanted.ar} was not created`);
      categories.set(key, { id: created._id, name: wanted.ar, created: true });
    }
    const categoryOf = (key: InventoryCategoryKey) => {
      const category = categories.get(key) ?? categories.get('desktop');
      if (category === undefined) throw new Error(`no category for ${key}`);
      return category;
    };

    // A serial the register already holds is a device registered since the sheet was made —
    // compared without case, because the sheet's «57l6033» is the label's «57L6033».
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
    const fresh = devices.filter((device) => {
      const existing = device.serial === null ? undefined : taken.get(device.serial.toUpperCase());
      if (existing === undefined) return true;
      skippedSerials.push({ key: device.key, serial: device.serial ?? '', existing });
      return false;
    });

    // Their codes, taken inside the transaction: a rollback gives every one of them back.
    const firstCode =
      fresh.length === 0
        ? 0
        : await reserveSequenceBlock(ASSET_SEQUENCE_KEY, fresh.length, session);
    const held: HeldDevice[] = [];
    const created: Created[] = fresh.map((device, index) => {
      const reason = device.holderCode === null ? undefined : refused.get(device.holderCode);
      if (device.holderCode !== null && reason !== undefined) {
        held.push({ key: device.key, holderCode: device.holderCode, reason });
      }
      const handedOver = device.holderCode !== null && holders.has(device.holderCode);
      const asset = {
        _id: new Types.ObjectId(),
        assetCode: formatAssetCode(firstCode + index),
        name: device.name,
        description: null,
        categoryId: categoryOf(device.category).id,
        status: handedOver ? 'assigned' : 'inStock',
        serialNumber: device.serial,
        model: device.model,
        manufacturer: device.manufacturer,
        externalTag: null,
        branchId: branchIds.get(device.branch) as Types.ObjectId,
        location: device.location,
        purchase: null,
        warranty: null,
        currentAssignmentId: handedOver ? new Types.ObjectId() : null,
        disposal: null,
        notes: handedOver
          ? device.notes
          : joinNotes(device.notes, device.holderCode === null ? null : foundWith(device)),
        specs:
          device.storage === null
            ? null
            : {
                processor: null,
                memory: null,
                systemType: null,
                storage: device.storage,
                mediaDrive: null,
                displayAdapter: null,
                graphicsMemory: null,
                networkAdapters: [],
              },
        accessories: device.accessories,
      } as unknown as ItAssetDoc;
      return { asset, device };
    });

    // One receipt per employee, in the order their first device appears in the sheet.
    const byHolder = new Map<string, Created[]>();
    for (const entry of created) {
      if (entry.asset.status !== 'assigned' || entry.device.holderCode === null) continue;
      const list = byHolder.get(entry.device.holderCode) ?? [];
      list.push(entry);
      byHolder.set(entry.device.holderCode, list);
    }
    const firstReceipt =
      byHolder.size === 0
        ? null
        : await reserveSequenceBlock(RECEIPT_SEQUENCE_KEY, byHolder.size, session);
    const deviceTypes = new Map(
      [...categories.values()].map((category) => [String(category.id), category.name]),
    );

    const assignments: (Partial<ItAssetAssignmentDoc> & { _id: Types.ObjectId })[] = [];
    const events: Record<string, unknown>[] = [];
    const receipts: (Partial<ItCustodyReceiptDoc> & { _id: Types.ObjectId })[] = [];
    [...byHolder.entries()].forEach(([code, entries], index) => {
      const { employeeId, holder } = holders.get(code) as {
        employeeId: string;
        holder: ReceiptHolder;
      };
      const receiptId = new Types.ObjectId();
      for (const { asset } of entries) {
        const assignmentId = asset.currentAssignmentId as Types.ObjectId;
        assignments.push({
          _id: assignmentId,
          assetId: asset._id,
          assignedToEmployeeId: new Types.ObjectId(employeeId),
          assignedByUserId: null,
          assignedAt: at,
          conditionOnIssue: null,
          expectedReturnAt: null,
          returnedAt: null,
          returnedToUserId: null,
          conditionOnReturn: null,
          notes: INVENTORY_NOTE,
          branchId: asset.branchId,
          receiptId,
        });
        events.push({
          subjectId: asset._id,
          type: 'assigned',
          at,
          actorUserId: null,
          actorName: '',
          metadata: {
            assignmentId: String(assignmentId),
            employeeId,
            receiptId: String(receiptId),
          },
          notes: INVENTORY_NOTE,
        });
      }
      const [first] = entries;
      receipts.push({
        _id: receiptId,
        formNumber: (firstReceipt as number) + index,
        employeeId: new Types.ObjectId(employeeId),
        ...signer(holder),
        issuedAt: at,
        issuedByUserId: null,
        branchId: first?.asset.branchId as Types.ObjectId,
        lines: entries.map(({ asset }) => ({
          assetId: asset._id,
          assignmentId: asset.currentAssignmentId as Types.ObjectId,
          assetCode: asset.assetCode,
          name: asset.name,
          serialNumber: asset.serialNumber,
          conditionOnIssue: null,
          notes: null,
          ...receiptDeviceFields(asset, deviceTypes),
        })),
        signedCopy: null,
      });
    });

    if (created.length > 0)
      await ItAssetModel.insertMany(
        created.map(({ asset }) => asset),
        { session },
      );
    if (assignments.length > 0) await ItAssetAssignmentModel.insertMany(assignments, { session });
    if (events.length > 0) await ItAssetEventModel.insertMany(events, { session });
    if (receipts.length > 0) await ItCustodyReceiptModel.insertMany(receipts, { session });

    const byBranch: Record<string, number> = {};
    for (const { device } of created) byBranch[device.branch] = (byBranch[device.branch] ?? 0) + 1;
    const outcome = {
      assets: created.length,
      inStock: created.filter(({ asset }) => asset.status === 'inStock').length,
      assigned: assignments.length,
      receipts: receipts.length,
      firstCode: created[0]?.asset.assetCode ?? null,
      lastCode: created.at(-1)?.asset.assetCode ?? null,
      firstReceipt,
      lastReceipt: firstReceipt === null ? null : firstReceipt + receipts.length - 1,
      byBranch,
      categories: [...categories.entries()].map(([key, category]) => ({
        key,
        name: category.name,
        created: category.created,
      })),
      skippedSerials,
      held,
    };
    await recordItGoLiveRun(IT_INVENTORY_MARK, outcome, session);
    return { kind: 'done' as const, outcome, created, assignments, receipts };
  });

  if (run.kind === 'alreadyDone') return { status: 'alreadyDone' };
  if (run.kind === 'refused') return { status: 'refused', reason: run.reason };

  // After the commit, as every custody write: the audit trail and the platform's events.
  for (const { asset } of run.created) {
    await auditService.record({
      entityRef: { moduleId: 'it', entityType: 'asset', entityId: String(asset._id) },
      action: 'create',
      changes: [
        { field: 'assetCode', old: null, new: asset.assetCode },
        { field: 'serialNumber', old: null, new: asset.serialNumber },
        { field: 'status', old: null, new: asset.status },
        { field: 'source', old: null, new: IT_INVENTORY_MARK },
      ],
    });
    await emit(ItEvents.AssetRegistered, {
      assetId: String(asset._id),
      assetCode: asset.assetCode,
      categoryId: String(asset.categoryId),
    });
  }
  for (const assignment of run.assignments) {
    const asset = run.created.find(({ asset: a }) => a._id.equals(assignment.assetId))?.asset;
    await auditService.record({
      entityRef: { moduleId: 'it', entityType: 'asset', entityId: String(assignment.assetId) },
      action: 'assign',
      changes: [{ field: 'holder', old: null, new: String(assignment.assignedToEmployeeId) }],
    });
    await emit(ItEvents.AssetAssigned, {
      assetId: String(assignment.assetId),
      assetCode: asset?.assetCode ?? '',
      employeeId: String(assignment.assignedToEmployeeId),
      assignmentId: String(assignment._id),
    });
  }
  for (const receipt of run.receipts) {
    await auditReceiptIssued(
      receipt._id,
      String(receipt.employeeId),
      (receipt.lines ?? []).map((line) => line.assetCode),
    );
  }
  return { status: 'done', ...run.outcome };
};

/** Read the committed file and run it once; say what happened. Exported so a test can await it. */
export const runItInventoryGoLive = async (): Promise<void> => {
  const file = resolveInventoryFile();
  if (file === null) {
    logger.error(
      `it go-live: ${INVENTORY_FILE} is not in the build — the inventory was not imported`,
    );
    return;
  }
  const { devices } = parseInventory(JSON.parse(await readFile(file, 'utf8')));
  const outcome = await importItInventory(devices);
  if (outcome.status === 'refused') {
    logger.warn(
      { reason: outcome.reason },
      'it go-live: the inventory was NOT imported — nothing was written; the next boot tries again',
    );
  } else if (outcome.status === 'done') {
    logger.warn(outcome, 'it go-live: the IT inventory was imported — done, and never again');
  }
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — the asset restart's terms.
 */
export const startItInventoryGoLive = (): void => {
  if (isTest) return;
  void runItInventoryGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'it go-live: importing the IT inventory failed — no boot was harmed',
    );
  });
};
