// The I/O half of the org-catalog migration (P-ORG-2). Read, plan, check, then — only if asked —
// write.
//
// FOUR THINGS HAPPEN, IN THIS ORDER, and the order is the whole safety argument:
//
//   1. READ the live departments and sections, and PLAN (`plan.ts`, pure).
//   2. PRE-FLIGHT the merges against the rest of the database: every reference that would be
//      repointed, every unique index that repointing could violate, and the two collections whose
//      org ids hide inside `Mixed`. Everything found becomes a `problem`.
//   3. REFUSE if there is a single problem. Not "skip the bad ones" — a catalog that describes some
//      branches and not others is worse than the duplication it was fixing, and a merge that half
//      repointed is a person filed against a department that no longer exists.
//   4. WRITE, and only then: create the catalog entries, link every row to one, apply the merges.
//
// Steps 1-3 are what `--dry-run` (the default) does. They read; they change nothing. The report
// they produce is the same object the write path produces, with `written: false` — so what an
// operator reads before typing `--write` is literally the plan that then runs.
import mongoose, { Types } from 'mongoose';
import { logger } from '../infrastructure/logging/logger';
// Through the BARREL, never the model files. Entering the graph at `department.model` re-opens the
// cycle documented at the top of `shared/org-unit.ts` and kills the entrypoint before its first
// line of logic — the failure `org-duplication-report.cli.ts` shipped with once already.
import {
  DepartmentCatalogModel,
  DepartmentModel,
  SectionCatalogModel,
  SectionModel,
} from '../platform/organization';
import {
  foldUnitName,
  planOrgCatalog,
  type CatalogPlan,
  type MergeRequest,
  type UnitRow,
} from './plan';
import {
  MIXED_ORG_CARRIERS,
  collectModelRefs,
  mixedCarrierHits,
  repointUpdate,
  uniqueIndexRisks,
  type ModelRef,
} from './references';
// FOR THE SIDE EFFECT, and it is load-bearing. The sweep below walks `mongoose.models`, which holds
// only the models something has IMPORTED — so a collection whose feature is reached from the HTTP
// app rather than from a module manifest (`department_applications` is one) would not be swept, and
// its rows would keep pointing at a department the merge just retired. Importing the app registers
// every model the running system has. `references.spec.ts` pins that the hard-to-reach ones appear.
import './app-model-graph';

export interface ReferenceSweep extends ModelRef {
  /** Rows naming a losing department today. Repointed on write; counted on a dry run. */
  rows: number;
}

export interface OrgCatalogReport {
  written: boolean;
  plan: CatalogPlan;
  /** Every collection and path that names a losing department, with how many rows do. */
  references: ReferenceSweep[];
  /** What was actually written. All zeroes on a dry run. */
  created: { departmentEntries: number; sectionEntries: number };
  linked: { departments: number; sections: number };
  merged: { departments: number; referencesRepointed: number; sectionsMoved: number };
}

const live = { isDeleted: false } as const;

const toRow = (doc: {
  _id: unknown;
  code: string;
  name: { ar: string; en: string };
  branchId?: unknown;
  departmentId?: unknown;
  catalogId?: unknown;
  createdAt: Date;
}): UnitRow => ({
  id: String(doc._id),
  code: doc.code,
  name: doc.name,
  branchId: String(doc.branchId ?? ''),
  ...(doc.departmentId == null ? {} : { departmentId: String(doc.departmentId) }),
  catalogId: doc.catalogId == null ? null : String(doc.catalogId),
  createdAt: doc.createdAt.toISOString(),
});

/**
 * Which references exist, and whether repointing any of them would violate a unique index.
 *
 * The unique-index check is done by INTERSECTION rather than by trying the write and catching the
 * error: a duplicate-key failure arrives after some collections have already been rewritten, and
 * this migration has no transaction spanning twenty collections to roll that back with.
 */
const surveyReferences = async (
  loserIds: readonly string[],
  problems: string[],
): Promise<ReferenceSweep[]> => {
  if (loserIds.length === 0) return [];
  const ids = loserIds.map((id) => new Types.ObjectId(id));
  const sweeps: ReferenceSweep[] = [];

  for (const ref of collectModelRefs(mongoose.models)) {
    const model = mongoose.models[ref.modelName];
    if (model === undefined) continue;
    const rows = await model.collection.countDocuments({ [ref.path]: { $in: ids } });
    if (rows === 0) continue;
    sweeps.push({ ...ref, rows });

    // Provable up front rather than at write time: a shape the positional update cannot express
    // stops the migration here, with the path named, instead of failing mid-merge.
    if (repointUpdate(ref, ids[0], ids[0]) === null) {
      problems.push(
        `${ref.collection}.${ref.path}: ${String(rows)} row(s) name a department being merged, ` +
          'in a shape this migration cannot rewrite (a department id nested inside two arrays). ' +
          'Fix these rows by hand first.',
      );
      continue;
    }

    for (const risk of uniqueIndexRisks(model.schema, ref.path)) {
      const shape = (doc: Record<string, unknown>): string =>
        JSON.stringify(risk.otherKeys.map((key) => String(doc[key] ?? '')));
      const projection = Object.fromEntries(risk.otherKeys.map((key) => [key, 1]));
      // `isDeleted: {$ne: true}` rather than `false`: a collection that opted out of soft delete
      // has no such field, and a filter on `false` would silently find nothing and clear a
      // collision that is real.
      const losing = await model.collection
        .find({ [ref.path]: { $in: ids }, isDeleted: { $ne: true } }, { projection })
        .toArray();
      // Every merge shares a branch, so one winner set per loser is not needed: any row that
      // survives on ANY winner and matches a loser's key shape is a collision waiting to happen.
      const surviving = await model.collection
        .find({ [ref.path]: { $nin: ids }, isDeleted: { $ne: true } }, { projection })
        .toArray();
      const survivingShapes = new Set(surviving.map((doc) => shape(doc)));
      const clashes = losing.filter((doc) => survivingShapes.has(shape(doc)));
      if (clashes.length > 0) {
        problems.push(
          `${ref.collection}.${ref.path}: repointing ${String(clashes.length)} row(s) would ` +
            `duplicate the unique index ${risk.name} (${risk.otherKeys.join(', ')}). ` +
            'Remove the duplicate rows from the surviving department first.',
        );
      }
    }
  }
  return sweeps;
};

/** The two `Mixed` carriers: found, named, and refused rather than guessed at. */
const surveyMixedCarriers = async (
  loserIds: readonly string[],
  problems: string[],
): Promise<void> => {
  if (loserIds.length === 0) return;
  for (const carrier of MIXED_ORG_CARRIERS) {
    const collections = await mongoose.connection.db
      ?.listCollections({ name: carrier.collection })
      .toArray();
    if (collections === undefined || collections.length === 0) continue;
    const documents = await mongoose.connection.collection(carrier.collection).find(live).toArray();
    const hits = mixedCarrierHits(documents as unknown as Record<string, unknown>[], loserIds);
    if (hits.length > 0) {
      problems.push(
        `${carrier.collection}: ${String(hits.length)} row(s) name a department being merged ` +
          `(${hits.join(', ')}). This migration will not rewrite them — ${carrier.why}. ` +
          'Change them on their own screen, then run again.',
      );
    }
  }
};

const createEntries = async (
  plan: CatalogPlan,
  by: Types.ObjectId,
): Promise<{ departments: Map<string, Types.ObjectId>; sections: number }> => {
  const departmentIdByKey = new Map<string, Types.ObjectId>();
  for (const entry of plan.departments) {
    const doc = await DepartmentCatalogModel.create({
      code: entry.code,
      name: entry.name,
      description: null,
      status: 'active',
      createdBy: by,
      updatedBy: by,
    });
    departmentIdByKey.set(entry.foldedKey, doc._id);
    // `name` is set too, deliberately: every member takes the entry's spelling, which is what
    // makes the seven copies read as one department everywhere they appear from now on.
    await DepartmentModel.updateMany(
      { _id: { $in: entry.memberIds.map((id) => new Types.ObjectId(id)) } },
      { $set: { catalogId: doc._id, name: entry.name, updatedBy: by } },
    );
  }

  // A re-run links sections under departments an earlier run already catalogued, so the parent may
  // have to be read back rather than found in this run's map. Keyed by the SAME fold the plan used
  // — two folds that disagreed would miss the existing entry and create a second one.
  for (const row of await DepartmentCatalogModel.find(live).lean().exec()) {
    const key = foldUnitName(row);
    if (!departmentIdByKey.has(key)) departmentIdByKey.set(key, row._id);
  }

  let sections = 0;
  for (const entry of plan.sections) {
    const parentId = departmentIdByKey.get(entry.parentKey ?? '');
    if (parentId === undefined) {
      throw new Error(
        `section entry ${entry.code} has no department entry for "${entry.parentKey ?? ''}" — ` +
          'the plan and the database disagree; nothing further was written',
      );
    }
    const doc = await SectionCatalogModel.create({
      code: entry.code,
      name: entry.name,
      departmentCatalogId: parentId,
      description: null,
      status: 'active',
      createdBy: by,
      updatedBy: by,
    });
    sections += 1;
    await SectionModel.updateMany(
      { _id: { $in: entry.memberIds.map((id) => new Types.ObjectId(id)) } },
      { $set: { catalogId: doc._id, name: entry.name, updatedBy: by } },
    );
  }
  return { departments: departmentIdByKey, sections };
};

/**
 * Apply the merges: repoint every reference, move the sections, retire the losing department.
 *
 * The section move rewrites `path` as well as `departmentId`, because a section's materialized path
 * is `branch/department/section` and the middle segment has just changed. A merge is always within
 * one branch, so the first segment is left exactly as it was.
 */
const applyMerges = async (
  plan: CatalogPlan,
  sweeps: readonly ReferenceSweep[],
  by: Types.ObjectId,
): Promise<{ referencesRepointed: number; sectionsMoved: number }> => {
  let referencesRepointed = 0;
  let sectionsMoved = 0;

  for (const merge of plan.merges) {
    const loser = new Types.ObjectId(merge.loserId);
    const winner = new Types.ObjectId(merge.winnerId);

    for (const sweep of sweeps) {
      const model = mongoose.models[sweep.modelName];
      if (model === undefined) continue;
      // Built by the same function the pre-flight proved was expressible, so what is written is
      // exactly what was checked.
      const update = repointUpdate(sweep, loser, winner);
      if (update === null) continue;
      const result = await model.collection.updateMany(
        { [sweep.path]: loser },
        { $set: update.set },
        update.arrayFilters === undefined ? {} : { arrayFilters: update.arrayFilters },
      );
      referencesRepointed += result.modifiedCount;
    }

    // `sections.departmentId` was repointed by the sweep above (it is a declared path like any
    // other); the path segment is the part no generic sweep could know about.
    const moved = await SectionModel.find({ ...live, departmentId: winner })
      .lean()
      .exec();
    for (const section of moved) {
      const rebuilt = `${String(section.branchId)}/${String(winner)}/${String(section._id)}`;
      if (section.path === rebuilt) continue;
      await SectionModel.updateOne(
        { _id: section._id },
        { $set: { path: rebuilt, updatedBy: by } },
      );
      sectionsMoved += 1;
    }

    await DepartmentModel.updateOne(
      { _id: loser },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: by, updatedBy: by } },
    );
    logger.info(
      { loser: merge.loserCode, winner: merge.winnerCode, branchId: merge.branchId },
      'org catalog: department merged and retired',
    );
  }
  return { referencesRepointed, sectionsMoved };
};

/**
 * Read, plan, check, and — when `write` is true and nothing is wrong — apply.
 *
 * `actorId` is stamped as `updatedBy`/`deletedBy` on everything this touches, so the change is
 * attributable to the operator who ran it rather than appearing to have happened by itself.
 */
export const runOrgCatalogMigration = async (options: {
  write: boolean;
  actorId: string;
  merges?: readonly MergeRequest[];
}): Promise<OrgCatalogReport> => {
  const by = new Types.ObjectId(options.actorId);
  const [departments, sections] = await Promise.all([
    DepartmentModel.find(live).lean().exec(),
    SectionModel.find(live).lean().exec(),
  ]);

  const plan = planOrgCatalog(departments.map(toRow), sections.map(toRow), options.merges ?? []);
  const loserIds = plan.merges.map((merge) => merge.loserId);
  const references = await surveyReferences(loserIds, plan.problems);
  await surveyMixedCarriers(loserIds, plan.problems);

  const report: OrgCatalogReport = {
    written: false,
    plan,
    references,
    created: { departmentEntries: 0, sectionEntries: 0 },
    linked: { departments: 0, sections: 0 },
    merged: { departments: 0, referencesRepointed: 0, sectionsMoved: 0 },
  };
  if (!options.write || plan.problems.length > 0) return report;

  const created = await createEntries(plan, by);
  const merged = await applyMerges(plan, references, by);

  report.written = true;
  report.created = {
    departmentEntries: plan.departments.length,
    sectionEntries: created.sections,
  };
  report.linked = {
    departments: plan.departments.reduce((sum, entry) => sum + entry.memberIds.length, 0),
    sections: plan.sections.reduce((sum, entry) => sum + entry.memberIds.length, 0),
  };
  report.merged = { departments: plan.merges.length, ...merged };
  return report;
};
