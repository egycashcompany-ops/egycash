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
import { AuditLogModel } from '../../../platform/audit/audit.model';
import { diffChanges } from '../../../shared/utils/diff';
import { AtmMachineModel } from '../machines/machine.model';
import { AtmRegisterEntryModel } from '../register/register.model';
import { branchesFiledAs, loadAtmBranchLinks } from '../shared/atm-context';
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

/** The stored links, or none when they cannot be read — a label repair never fails on them. */
const linksOrNone = async (): Promise<ReadonlyMap<string, string>> => {
  try {
    return await loadAtmBranchLinks();
  } catch {
    return new Map();
  }
};

/** Pure: the other branches linked with `branchId` — the one it works as, and that one's sources. */
const otherLinkedBranches = (links: ReadonlyMap<string, string>, branchId: string): string[] => {
  const own = branchId.toLowerCase();
  return links.size === 0 ? [] : branchesFiledAs(links, own).filter((id) => id !== own);
};

/**
 * Whether a branch linked with `branchId` REMEMBERS the name (review finding): a deleted row of it,
 * or a row it was renamed away from (`formerNames`). DEC-38 says such a name is never inserted
 * again, and linked branches work as one — «نقل البيانات» takes the source's memory rows to the
 * target first, so a row still filed under the source must not write the name back as a live
 * label the next run would then bring into the target.
 */
const rememberedInLinkedBranch = async (
  links: ReadonlyMap<string, string>,
  branchId: string,
  area: string,
): Promise<boolean> => {
  const others = otherLinkedBranches(links, branchId);
  if (others.length === 0) return false;
  const found = await AtmRefLabelModel.collection.findOne(
    {
      branchId: { $in: others.map((id) => new Types.ObjectId(id)) },
      kind: 'area',
      $or: [{ name: area, isDeleted: { $ne: false } }, { formerNames: area }],
    },
    { projection: { _id: 1 } },
  );
  return found !== null;
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
  const links = await linksOrNone();
  for (const { branchId, area } of areaLabelPairs(pairs)) {
    try {
      if (await rememberedInLinkedBranch(links, branchId, area)) continue;
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

/**
 * Pure: the old canonical names a label's audit trail remembers — every `name` change's OLD text,
 * trimmed, distinct, in trail order, without the current name and without blanks.
 */
export const formerNamesFromTrail = (
  current: unknown,
  trail: readonly { changes?: readonly { field: string; old?: unknown }[] | null }[],
): string[] => {
  const now = typeof current === 'string' ? current.trim() : null;
  const out: string[] = [];
  for (const row of trail) {
    for (const change of row.changes ?? []) {
      if (change.field !== 'name' || typeof change.old !== 'string') continue;
      const old = change.old.trim();
      if (old === '' || old === now || out.includes(old)) continue;
      out.push(old);
    }
  }
  return out;
};

export interface AreaFormerNamesResult {
  /** Area rows that had no `formerNames` field and now have one. */
  rows: number;
  /** Of those, the rows whose trail held at least one old name. */
  recovered: number;
}

const TRAIL_BATCH = 500;

/**
 * Boot step, ONCE per row, before `backfillAtmAreaLabels`: give `formerNames` to the area rows
 * written before the field existed — by the old data-edit code or the legacy import.
 *
 * The rename existed before this release and was reachable on data-edit, but it set `name` and
 * nothing else: no `formerNames`, no cascade, while the branch's machines kept the old text (they
 * are never rewritten). Without this step the first boot's backfill would find that old text on an
 * active machine, match no row by `name` or `formerNames`, and insert it as a NEW active label —
 * reviving exactly the renamed name DEC-38 promises is never brought back (review finding,
 * reproduced: `MOHNDESSEN` renamed from `Mohndesin` came back as `Mohndesin`). The audit trail is the
 * only place the old name still exists: the old update recorded `diffChanges` of `{ name, isActive }`
 * under `atm/refLabel/<id>`, and the audit stream is append-only and never pruned.
 *
 * Deleted rows are read too — the backfill's `taken` and the upsert both include them, so a renamed
 * and then deleted row must also remember its old names. One audit read per batch (covered by
 * `ix_entityRef_at`); the write repeats `formerNames: { $exists: false }`, so a rename another
 * instance serves during a rolling deploy is never overwritten. A second boot finds no row to read.
 * Counts only in the log, never a name.
 */
export const recoverAreaFormerNames = async (): Promise<AreaFormerNamesResult> => {
  const rows = await AtmRefLabelModel.collection
    .find<{ _id: Types.ObjectId; name?: unknown }>(
      { kind: 'area', formerNames: { $exists: false } },
      { projection: { name: 1 } },
    )
    .toArray();
  const result: AreaFormerNamesResult = { rows: 0, recovered: 0 };
  for (let start = 0; start < rows.length; start += TRAIL_BATCH) {
    const batch = rows.slice(start, start + TRAIL_BATCH);
    const trail = await AuditLogModel.find(
      {
        'entityRef.moduleId': 'atm',
        'entityRef.entityType': 'refLabel',
        'entityRef.entityId': { $in: batch.map((row) => String(row._id)) },
        action: 'update',
      },
      { entityRef: 1, changes: 1, at: 1 },
    )
      .sort({ at: 1 })
      .lean()
      .exec();
    const byLabel = new Map<string, typeof trail>();
    for (const row of trail) {
      const list = byLabel.get(row.entityRef.entityId) ?? [];
      list.push(row);
      byLabel.set(row.entityRef.entityId, list);
    }
    const writes: Parameters<typeof AtmRefLabelModel.collection.bulkWrite>[0] = batch.map((row) => {
      const formerNames = formerNamesFromTrail(row.name, byLabel.get(String(row._id)) ?? []);
      if (formerNames.length > 0) result.recovered += 1;
      return {
        updateOne: {
          filter: { _id: row._id, formerNames: { $exists: false } },
          update: { $set: { formerNames } },
        },
      };
    });
    const written = await AtmRefLabelModel.collection.bulkWrite(writes, { ordered: false });
    result.rows += written.modifiedCount;
  }
  if (result.rows > 0) {
    logger.info(result, 'atm: area labels given the former names their audit trail remembers');
  }
  return result;
};

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
      .find<{
        branchId: Types.ObjectId;
        name?: unknown;
        formerNames?: unknown;
        isDeleted?: unknown;
      }>({ kind: 'area' }, { projection: { branchId: 1, name: 1, formerNames: 1, isDeleted: 1 } })
      .toArray(),
  ]);
  const links = await linksOrNone();
  const taken = new Set<string>();
  for (const row of known) {
    const branchId = String(row.branchId);
    const former = Array.isArray(row.formerNames) ? (row.formerNames as unknown[]) : [];
    for (const name of [row.name, ...former]) {
      if (typeof name === 'string') taken.add(`${branchId}\u0000${name}`);
    }
    // A remembered name — deleted, or renamed away — answers for every branch linked with this one
    // too (`rememberedInLinkedBranch`): after a move cut off by a restart, the source's memory rows
    // are already the target's, and this repair must not write the names back under the source.
    const memory = [...(row.isDeleted !== false ? [row.name] : []), ...former];
    for (const other of otherLinkedBranches(links, branchId)) {
      for (const name of memory) {
        if (typeof name === 'string') taken.add(`${other}\u0000${name}`);
      }
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
