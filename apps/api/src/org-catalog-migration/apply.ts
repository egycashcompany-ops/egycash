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
  type PlannedCatalogEntry,
  type UnitRow,
} from './plan';
import { planPaperMoves, type PaperLine, type PaperPlan } from './job-papers';
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

/** A planned entry whose rows join an entry the company list already has, of the same name. */
export interface JoinedEntry {
  /** The planned entry's code (its oldest member's). */
  code: string;
  name: string;
  /** The existing entry the rows are linked to instead of a new one. */
  entryCode: string;
}

/** Two «مستندات الوظائف» lines for one job in one company department that said different things. */
export interface PaperConflictReport {
  department: string;
  job: string;
  kept: { from: string; added: readonly string[]; removed: readonly string[] };
  dropped: { from: string; added: readonly string[]; removed: readonly string[] }[];
}

export interface OrgCatalogReport {
  written: boolean;
  plan: CatalogPlan;
  /** Every collection and path that names a losing department, with how many rows do. */
  references: ReferenceSweep[];
  /**
   * Planned entries whose rows are linked to an EXISTING entry of the same name instead — one the
   * company list was given by hand, or that a department created since P-ORG-3 linked itself to
   * (§5.6). Without this a second «العمليات» entry would be created beside the first.
   */
  joined: { departments: JoinedEntry[]; sections: JoinedEntry[] };
  /**
   * «مستندات الوظائف» lines that follow their department to its entry (`job-papers.ts`): how many
   * move, how many are retired as a second line for the same job, and every pair that disagreed.
   */
  papers: { moves: number; retired: number; conflicts: PaperConflictReport[] };
  /** The company list as it stood before this run: entries a run can join (`joined`). */
  existing: { departmentEntries: number; sectionEntries: number };
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

interface LeanEntry {
  _id: Types.ObjectId;
  code: string;
  name: { ar: string; en: string };
  departmentCatalogId?: Types.ObjectId | null;
}

interface LeanUnit {
  _id: Types.ObjectId;
  code: string;
  branchId?: Types.ObjectId | null;
  departmentId?: Types.ObjectId | null;
  catalogId?: Types.ObjectId | null;
}

/** Planned entries whose rows join an existing entry instead of a new one. */
interface Joins {
  /** By the planned department entry's folded key. */
  departments: Map<string, LeanEntry>;
  /** By `sectionKey` of the planned section entry. */
  sections: Map<string, LeanEntry>;
}

/** A section entry's identity: its folded name under its department's folded name. */
const sectionKey = (entry: { parentKey?: string; foldedKey: string }): string =>
  JSON.stringify([entry.parentKey ?? '', entry.foldedKey]);

const groupByFold = (entries: readonly LeanEntry[]): Map<string, LeanEntry[]> => {
  const out = new Map<string, LeanEntry[]>();
  for (const entry of entries) {
    const key = foldUnitName(entry);
    out.set(key, [...(out.get(key) ?? []), entry]);
  }
  return out;
};

/**
 * Link a planned group to the entry the company list ALREADY has under the same name, instead of
 * creating a second one beside it.
 *
 * Since P-ORG-2 the list can be given entries by hand, and since P-ORG-3 a department or section
 * created on its own page links itself to one (§5.6). A plan that ignored them would make a second
 * «العمليات» next to the first: two tiles on the org chart, two lines in every picker, and job
 * places split between them.
 *
 * Joining must not break the one-row-per-branch rule (`ux_branch_catalog`, and for sections one row
 * per department row): a branch whose copy is ALREADY linked to that entry cannot link a second row
 * to it. That is the same gate as two same-named departments in one branch, and it is refused the
 * same way — with the merge that resolves it.
 */
const joinExisting = (
  plan: CatalogPlan,
  departments: readonly LeanUnit[],
  sections: readonly LeanUnit[],
  departmentEntries: readonly LeanEntry[],
  sectionEntries: readonly LeanEntry[],
): Joins => {
  const joins: Joins = { departments: new Map(), sections: new Map() };
  const departmentsByFold = groupByFold(departmentEntries);
  const id = (value: unknown): string => String(value ?? '').toLowerCase();

  for (const entry of plan.departments) {
    const matches = departmentsByFold.get(entry.foldedKey) ?? [];
    if (matches.length === 0) continue;
    if (matches.length > 1) {
      plan.problems.push(
        `the company list already holds ${String(matches.length)} departments named ` +
          `${entry.foldedKey} (${matches.map((m) => m.code).join(', ')}). Keep one, then run again.`,
      );
      continue;
    }
    const existing = matches[0] as LeanEntry;
    const members = new Set(entry.memberIds.map((member) => member.toLowerCase()));
    const linkedByBranch = new Map(
      departments
        .filter((row) => id(row.catalogId) === id(existing._id))
        .map((row) => [id(row.branchId), row]),
    );
    const clashes = departments.filter(
      (row) => members.has(id(row._id)) && linkedByBranch.has(id(row.branchId)),
    );
    if (clashes.length > 0) {
      plan.problems.push(
        `department ${entry.foldedKey} is already in the company list (${existing.code}), and ` +
          `${String(clashes.length)} branch(es) hold a second, unlinked copy of it: ` +
          clashes
            .map((row) => `--merge ${row.code}=${linkedByBranch.get(id(row.branchId))?.code ?? ''}`)
            .join(' ') +
          '. Run again with those merges.',
      );
      continue;
    }
    joins.departments.set(entry.foldedKey, existing);
  }

  // A section can only join an entry under a department entry that already exists.
  const sectionsByParent = new Map<string, LeanEntry[]>();
  for (const entry of sectionEntries) {
    const parent = id(entry.departmentCatalogId);
    sectionsByParent.set(parent, [...(sectionsByParent.get(parent) ?? []), entry]);
  }
  const movedTo = new Map<string, string>();
  for (const merge of plan.merges) {
    for (const moved of merge.movedSectionIds) movedTo.set(moved.toLowerCase(), merge.winnerId.toLowerCase());
  }
  for (const entry of plan.sections) {
    const parents = departmentsByFold.get(entry.parentKey ?? '') ?? [];
    if (parents.length !== 1) continue;
    const parent = parents[0] as LeanEntry;
    const matches = groupByFold(sectionsByParent.get(id(parent._id)) ?? []).get(entry.foldedKey) ?? [];
    if (matches.length === 0) continue;
    if (matches.length > 1) {
      plan.problems.push(
        `the company list already holds ${String(matches.length)} sections named ` +
          `${entry.foldedKey} under ${parent.code} (${matches.map((m) => m.code).join(', ')}). ` +
          'Keep one, then run again.',
      );
      continue;
    }
    const existing = matches[0] as LeanEntry;
    const members = new Set(entry.memberIds.map((member) => member.toLowerCase()));
    const departmentOf = (row: LeanUnit): string => movedTo.get(id(row._id)) ?? id(row.departmentId);
    const linkedByDepartment = new Map(
      sections
        .filter((row) => id(row.catalogId) === id(existing._id))
        .map((row) => [departmentOf(row), row]),
    );
    const clashes = sections.filter(
      (row) => members.has(id(row._id)) && linkedByDepartment.has(departmentOf(row)),
    );
    if (clashes.length > 0) {
      plan.problems.push(
        `section ${entry.foldedKey} is already in the company list (${existing.code}), and ` +
          `${clashes.map((row) => row.code).join(', ')} is a second, unlinked copy of it in a ` +
          'department that already holds a linked one. Merge them by hand, then run again.',
      );
      continue;
    }
    joins.sections.set(sectionKey(entry), existing);
  }
  return joins;
};

/** «مستندات الوظائف» — named rather than imported: this migration may not reach into HR's code. */
const JOB_PAPERS = 'hr_job_papers';

const dateOf = (value: unknown): string =>
  (value instanceof Date ? value : new Date(0)).toISOString();

const readPaperLines = async (): Promise<PaperLine[]> => {
  const found = await mongoose.connection.db?.listCollections({ name: JOB_PAPERS }).toArray();
  if (found === undefined || found.length === 0) return [];
  const docs = await mongoose.connection
    .collection(JOB_PAPERS)
    .find({ isDeleted: false, departmentId: { $ne: null } })
    .toArray();
  return docs.map((doc) => ({
    id: String(doc['_id']),
    departmentId: String(doc['departmentId']),
    jobTitleId: String(doc['jobTitleId']),
    added: Array.isArray(doc['added']) ? (doc['added'] as string[]) : [],
    removed: Array.isArray(doc['removed']) ? (doc['removed'] as string[]) : [],
    updatedAt: dateOf(doc['updatedAt'] ?? doc['createdAt']),
  }));
};

/**
 * Where each stored department key's lines belong once this run has written: `id:<entry>` for an
 * entry id, a row already linked, or a row joining an existing entry; `fold:<key>` for a row joining
 * an entry this run creates; a merged row's lines go where its winner's go.
 */
const paperTargets = (
  plan: CatalogPlan,
  joins: Joins,
  departments: readonly LeanUnit[],
  departmentEntries: readonly LeanEntry[],
): ((departmentId: string) => string | null) => {
  const target = new Map<string, string>();
  const idTarget = (value: unknown): string => `id:${String(value).toLowerCase()}`;
  for (const entry of departmentEntries) target.set(String(entry._id).toLowerCase(), idTarget(entry._id));
  for (const row of departments) {
    if (row.catalogId != null) target.set(String(row._id).toLowerCase(), idTarget(row.catalogId));
  }
  for (const entry of plan.departments) {
    const joined = joins.departments.get(entry.foldedKey);
    const where = joined === undefined ? `fold:${entry.foldedKey}` : idTarget(joined._id);
    for (const member of entry.memberIds) target.set(member.toLowerCase(), where);
  }
  for (const merge of plan.merges) {
    const winner = target.get(merge.winnerId.toLowerCase());
    if (winner !== undefined) target.set(merge.loserId.toLowerCase(), winner);
  }
  return (departmentId) => target.get(departmentId) ?? null;
};

/** The conflicts in words an operator can check against the popup: department, job, branch codes. */
const describeConflicts = async (
  papers: PaperPlan,
  lines: readonly PaperLine[],
  plan: CatalogPlan,
  departments: readonly LeanUnit[],
  departmentEntries: readonly LeanEntry[],
): Promise<PaperConflictReport[]> => {
  if (papers.conflicts.length === 0) return [];
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const codeOf = new Map<string, string>([
    ...departments.map((row): [string, string] => [String(row._id).toLowerCase(), row.code]),
    ...departmentEntries.map((entry): [string, string] => [String(entry._id).toLowerCase(), entry.code]),
  ]);
  const departmentName = (target: string): string => {
    if (target.startsWith('fold:')) {
      return plan.departments.find((entry) => `fold:${entry.foldedKey}` === target)?.name.ar ?? target;
    }
    return departmentEntries.find((entry) => `id:${String(entry._id).toLowerCase()}` === target)?.name.ar ?? target;
  };
  const jobIds = [...new Set(papers.conflicts.map((conflict) => conflict.jobTitleId))];
  const jobs = await mongoose.connection
    .collection('job_titles')
    .find({ _id: { $in: jobIds.map((jobId) => new Types.ObjectId(jobId)) } }, { projection: { name: 1 } })
    .toArray();
  const jobName = new Map(jobs.map((job) => [String(job['_id']), (job['name'] as { ar?: string } | undefined)?.ar ?? '']));
  const side = (lineId: string): PaperConflictReport['kept'] => {
    const line = lineById.get(lineId);
    return {
      from: codeOf.get(line?.departmentId.toLowerCase() ?? '') ?? line?.departmentId ?? lineId,
      added: line?.added ?? [],
      removed: line?.removed ?? [],
    };
  };
  return papers.conflicts.map((conflict) => ({
    department: departmentName(conflict.target),
    job: jobName.get(conflict.jobTitleId) ?? conflict.jobTitleId,
    kept: side(conflict.kept),
    dropped: conflict.dropped.map(side),
  }));
};

/**
 * Move the lines: retire the second lines FIRST — the unique index on (department, job) counts live
 * lines only — then re-key the kept ones. Each touched line's version is bumped, so a popup open
 * on the old key cannot save over the move.
 */
const movePapers = async (
  papers: PaperPlan,
  departmentIdByKey: ReadonlyMap<string, Types.ObjectId>,
  by: Types.ObjectId,
): Promise<{ moved: number; retired: number }> => {
  if (papers.moves.length === 0 && papers.drops.length === 0) return { moved: 0, retired: 0 };
  const collection = mongoose.connection.collection(JOB_PAPERS);
  const now = new Date();
  let retired = 0;
  for (const drop of papers.drops) {
    const result = await collection.updateOne(
      { _id: new Types.ObjectId(drop.lineId), isDeleted: false },
      { $set: { isDeleted: true, deletedAt: now, deletedBy: by, updatedBy: by }, $inc: { __v: 1 } },
    );
    retired += result.modifiedCount;
  }
  let moved = 0;
  for (const move of papers.moves) {
    const to = move.target.startsWith('id:')
      ? new Types.ObjectId(move.target.slice('id:'.length))
      : departmentIdByKey.get(move.target.slice('fold:'.length));
    if (to === undefined) {
      throw new Error(
        `job papers line ${move.lineId} belongs to ${move.target}, which this run did not create — ` +
          'the plan and the database disagree; the lines moved so far are kept',
      );
    }
    const result = await collection.updateOne(
      { _id: new Types.ObjectId(move.lineId), isDeleted: false },
      { $set: { departmentId: to, updatedBy: by }, $inc: { __v: 1 } },
    );
    moved += result.modifiedCount;
  }
  return { moved, retired };
};

const createEntries = async (
  plan: CatalogPlan,
  joins: Joins,
  by: Types.ObjectId,
): Promise<{ departments: Map<string, Types.ObjectId>; departmentsCreated: number; sections: number }> => {
  const departmentIdByKey = new Map<string, Types.ObjectId>();
  let departmentsCreated = 0;
  for (const entry of plan.departments) {
    const joined = joins.departments.get(entry.foldedKey);
    const doc =
      joined ??
      (await DepartmentCatalogModel.create({
        code: entry.code,
        name: entry.name,
        description: null,
        status: 'active',
        createdBy: by,
        updatedBy: by,
      }));
    if (joined === undefined) departmentsCreated += 1;
    departmentIdByKey.set(entry.foldedKey, doc._id);
    // `name` is set too, deliberately: every member takes the entry's spelling, which is what
    // makes the seven copies read as one department everywhere they appear from now on.
    await DepartmentModel.updateMany(
      { _id: { $in: entry.memberIds.map((id) => new Types.ObjectId(id)) } },
      { $set: { catalogId: doc._id, name: doc.name, updatedBy: by } },
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
    const joined = joins.sections.get(sectionKey(entry));
    const doc =
      joined ??
      (await SectionCatalogModel.create({
        code: entry.code,
        name: entry.name,
        departmentCatalogId: parentId,
        description: null,
        status: 'active',
        createdBy: by,
        updatedBy: by,
      }));
    if (joined === undefined) sections += 1;
    await SectionModel.updateMany(
      { _id: { $in: entry.memberIds.map((id) => new Types.ObjectId(id)) } },
      { $set: { catalogId: doc._id, name: doc.name, updatedBy: by } },
    );
  }
  return { departments: departmentIdByKey, departmentsCreated, sections };
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
  const [departments, sections, departmentEntries, sectionEntries] = await Promise.all([
    DepartmentModel.find(live).lean().exec(),
    SectionModel.find(live).lean().exec(),
    DepartmentCatalogModel.find(live, { code: 1, name: 1 }).lean<LeanEntry[]>().exec(),
    SectionCatalogModel.find(live, { code: 1, name: 1, departmentCatalogId: 1 }).lean<LeanEntry[]>().exec(),
  ]);

  const plan = planOrgCatalog(departments.map(toRow), sections.map(toRow), options.merges ?? []);
  const joins = joinExisting(plan, departments, sections, departmentEntries, sectionEntries);
  const loserIds = plan.merges.map((merge) => merge.loserId);
  const references = await surveyReferences(loserIds, plan.problems);
  await surveyMixedCarriers(loserIds, plan.problems);

  // «مستندات الوظائف»: decided now, from the same plan, so the dry run shows what the write moves.
  const paperLines = await readPaperLines();
  const papers = planPaperMoves(
    paperLines,
    paperTargets(plan, joins, departments, departmentEntries),
  );

  const joinedOf = (
    entries: readonly PlannedCatalogEntry[],
    found: (entry: PlannedCatalogEntry) => LeanEntry | undefined,
  ): JoinedEntry[] =>
    entries.flatMap((entry) => {
      const existing = found(entry);
      return existing === undefined
        ? []
        : [{ code: entry.code, name: entry.name.ar, entryCode: existing.code }];
    });

  const report: OrgCatalogReport = {
    written: false,
    plan,
    references,
    joined: {
      departments: joinedOf(plan.departments, (entry) => joins.departments.get(entry.foldedKey)),
      sections: joinedOf(plan.sections, (entry) => joins.sections.get(sectionKey(entry))),
    },
    existing: { departmentEntries: departmentEntries.length, sectionEntries: sectionEntries.length },
    papers: {
      moves: papers.moves.length,
      retired: papers.drops.length,
      conflicts: await describeConflicts(papers, paperLines, plan, departments, departmentEntries),
    },
    created: { departmentEntries: 0, sectionEntries: 0 },
    linked: { departments: 0, sections: 0 },
    merged: { departments: 0, referencesRepointed: 0, sectionsMoved: 0 },
  };
  if (!options.write || plan.problems.length > 0) return report;

  const created = await createEntries(plan, joins, by);
  const merged = await applyMerges(plan, references, by);
  const paperResult = await movePapers(papers, created.departments, by);

  report.written = true;
  report.papers = { ...report.papers, moves: paperResult.moved, retired: paperResult.retired };
  report.created = {
    departmentEntries: created.departmentsCreated,
    sectionEntries: created.sections,
  };
  report.linked = {
    departments: plan.departments.reduce((sum, entry) => sum + entry.memberIds.length, 0),
    sections: plan.sections.reduce((sum, entry) => sum + entry.memberIds.length, 0),
  };
  report.merged = { departments: plan.merges.length, ...merged };
  return report;
};
