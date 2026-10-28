// How the areas the register and the machines carry reach data-edit's area list (DEC-38) — labels
// written on save, plus a boot backfill, and NO merged read.
//
// The owner, on data-edit's lists: «مش مسمعه» — the areas Efficiency types into the register, and
// the 118 raw values the workbook import brings (EG-6), never became `atm_ref_labels` rows, so
// Operations never saw them. Two writers close that, both through ONE upsert:
//
//   · `ensureAreaLabels` — called AFTER a register or machine write commits, best effort: a failure
//     is logged and never fails the write, so no WriteConflict on the label collection can ever
//     reach a register or machine transaction, and the next boot repairs a label that was missed;
//   · `backfillAtmAreaLabels` — every boot, idempotent: the distinct areas of the ACTIVE machines
//     and the OPEN or PENDING entries of each branch. An area found only on ended entries or
//     archived machines stays a register suggestion (`branchOptions.areas`) and is no label.
//
// The upsert's filter is `{ branchId, kind: 'area', $or: [{ name }, { formerNames: name }] }` and
// DELIBERATELY carries no `isDeleted` and no `isActive`: a name Operations deleted, archived or
// renamed away matches its old row and is never inserted again. Otherwise every save of a machine
// still carrying the old text — machines are never rewritten — would bring the label back.
//
// EG-6 is amended, not reversed: one label per EXACT trimmed spelling (MOHNDESSEN ≠ Mohndessen ≠
// المهندسين), nothing merged, nothing rewritten. The new row's display name in its own script is
// the stored text; Operations add the other language on data-edit.
import { Types } from 'mongoose';
import { type AtmRefLabelOrigin } from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { AtmMachineModel } from '../machines/machine.model';
import { AtmRegisterEntryModel } from '../register/register.model';
import { AtmRefLabelModel } from './ref-label.model';

/** One area as one branch carries it. */
export interface AtmAreaLabelPair {
  branchId: Types.ObjectId | string | null;
  area: string | null | undefined;
}

/** Any character of the Arabic block (U+0600–U+06FF) makes a text Arabic. */
const ARABIC = /[؀-ۿ]/;

export const isArabicText = (text: string): boolean => ARABIC.test(text);

/**
 * Pure: the display names a label gets from ONE text — that text in the language its script says,
 * nothing in the other (a legacy `{ name }` create, an automatic label).
 */
export const areaNamesByScript = (
  name: string,
): { nameAr: string | null; nameEn: string | null } =>
  isArabicText(name) ? { nameAr: name, nameEn: null } : { nameAr: null, nameEn: name };

/**
 * Pure: the distinct (branch, trimmed area) pairs worth a label. A blank area, a pair with no
 * branch, and a value starting with `#` (an Excel error — `#N/A`, `#REF!` — the import keeps as
 * text) are skipped.
 */
export const areaLabelPairs = (
  pairs: readonly AtmAreaLabelPair[],
): { branchId: string; area: string }[] => {
  const seen = new Set<string>();
  const out: { branchId: string; area: string }[] = [];
  for (const pair of pairs) {
    if (pair.branchId === null || typeof pair.area !== 'string') continue;
    const area = pair.area.trim();
    if (area === '' || area.startsWith('#')) continue;
    const branchId = String(pair.branchId);
    const key = `${branchId}\u0000${area}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ branchId, area });
  }
  return out;
};

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/**
 * The one upsert. Returns the id of the row it INSERTED, or null when a row already answered to the
 * name (live, archived, deleted or renamed) or a concurrent insert won the race on the live partial
 * index `ux_branch_kind_name` — two saves of one new area end with one label.
 */
const upsertAreaLabel = async (
  branchId: string,
  area: string,
  origin: AtmRefLabelOrigin,
  actorId: string | null,
): Promise<Types.ObjectId | null> => {
  const now = new Date();
  const by = actorId === null ? null : new Types.ObjectId(actorId);
  try {
    const write = await AtmRefLabelModel.collection.updateOne(
      {
        branchId: new Types.ObjectId(branchId),
        kind: 'area',
        $or: [{ name: area }, { formerNames: area }],
      },
      {
        $setOnInsert: {
          branchId: new Types.ObjectId(branchId),
          kind: 'area',
          name: area,
          ...areaNamesByScript(area),
          formerNames: [],
          bankCode: null,
          origin,
          isActive: true,
          // The raw driver stamps nothing: the base fields are written out, as Mongoose would.
          schemaVersion: 1,
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          createdBy: by,
          updatedBy: by,
          __v: 0,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    return write.upsertedId ?? null;
  } catch (error) {
    if (isDuplicateKeyError(error)) return null;
    throw error;
  }
};

/**
 * After a register or machine write COMMITTED: a label for every area it carried that has none.
 * Never throws — the write it follows has already succeeded, and the boot backfill repairs a miss.
 * Each row it inserts is audited as `atm.refLabel` `create` (the request's actor), which is also
 * what refreshes open data-edit and register screens.
 */
export const ensureAreaLabels = async (
  pairs: readonly AtmAreaLabelPair[],
  meta: { actorId: string | null; origin: AtmRefLabelOrigin },
): Promise<void> => {
  for (const { branchId, area } of areaLabelPairs(pairs)) {
    try {
      const id = await upsertAreaLabel(branchId, area, meta.origin, meta.actorId);
      if (id === null) continue;
      await auditService.record({
        entityRef: { moduleId: 'atm', entityType: 'refLabel', entityId: String(id) },
        action: 'create',
        changes: diffChanges({}, { kind: 'area', name: area, branchId, origin: meta.origin }),
      });
    } catch (error) {
      // Never the area text: a count-and-code log, like every other ATM boot or repair line.
      logger.warn(
        { err: error instanceof Error ? error.name : 'Error', origin: meta.origin },
        'atm: an automatic area label was not written — the next boot repairs it',
      );
    }
  }
};

export interface AreaLabelBackfillResult {
  inserted: number;
}

/** The distinct trimmed areas per branch of one collection's rows that `match` selects. */
const distinctAreas = async (
  collection: typeof AtmMachineModel.collection,
  match: Record<string, unknown>,
): Promise<AtmAreaLabelPair[]> =>
  (
    await collection
      .aggregate<{ _id: { branchId: Types.ObjectId; area: string } }>([
        { $match: { ...match, area: { $type: 'string' } } },
        { $group: { _id: { branchId: '$branchId', area: { $trim: { input: '$area' } } } } },
      ])
      .toArray()
  ).map((row) => ({ branchId: row._id.branchId, area: row._id.area }));

/**
 * Boot step (after the bank catalog's): a label for every area an active machine or an open or
 * pending entry carries in its branch. Idempotent — the existing names (deleted, archived and former
 * ones included) are read first, so a second boot writes nothing — and not audited: like the
 * catalog seed it is the system's own repair, and `origin: 'backfill'` says where the row came from.
 */
export const backfillAtmAreaLabels = async (): Promise<AreaLabelBackfillResult> => {
  const [machines, entries, known] = await Promise.all([
    distinctAreas(AtmMachineModel.collection, { isDeleted: false, isActive: true }),
    distinctAreas(AtmRegisterEntryModel.collection, {
      isDeleted: false,
      status: { $in: ['open', 'pending'] },
      branchId: { $ne: null },
    }),
    AtmRefLabelModel.collection
      .find<{ branchId: Types.ObjectId; name?: unknown; formerNames?: unknown }>(
        { kind: 'area' },
        { projection: { branchId: 1, name: 1, formerNames: 1 } },
      )
      .toArray(),
  ]);
  const taken = new Set<string>();
  for (const row of known) {
    const names = [row.name, ...(Array.isArray(row.formerNames) ? row.formerNames : [])];
    for (const name of names) {
      if (typeof name === 'string') taken.add(`${String(row.branchId)}\u0000${name}`);
    }
  }
  const result: AreaLabelBackfillResult = { inserted: 0 };
  for (const { branchId, area } of areaLabelPairs([...machines, ...entries])) {
    if (taken.has(`${branchId}\u0000${area}`)) continue;
    if ((await upsertAreaLabel(branchId, area, 'backfill', null)) !== null) result.inserted += 1;
  }
  if (result.inserted > 0) {
    logger.info(result, 'atm: area labels written for the areas machines and the register carry');
  }
  return result;
};
