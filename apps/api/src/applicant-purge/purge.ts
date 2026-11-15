// Erasing named applicants and everything filed against them. The mechanism; the operator-facing
// explanation of why this exists and how it refuses lives in `purge-applicants.cli.ts`.
//
// WHAT IS DERIVED AND WHAT IS BY HAND. The collections come from `applicantTargets()`, which walks
// every registered schema for an applicant-naming path and refuses to start on one nobody has
// classified. Three things carry applicant data without such a path and so are handled here
// explicitly: files (keyed by `entityRef.entityId`), the portal account (`users.externalSubject`)
// and the user-scoped collections that go with a removed account.
//
// THE DISTINCTION THAT MATTERS MOST IN THIS FILE: a TOP-LEVEL applicant path means the row exists
// because the applicant does, so the row goes. A path INSIDE A SUBDOCUMENT ARRAY — `hr_evaluation_
// batches` holds its candidates in `items[].applicantId` — means the row is about several people,
// so the item is pulled and the row is left. Deleting it would erase the other candidates in that
// batch, which is the mistake a hand-written `deleteMany` makes and cannot be undone.
import mongoose, { Types } from 'mongoose';
import { platformPermissions, type ApplicantStatus, type DataScope } from '@ecms/contracts';
import { getRegisteredModules } from '../platform/kernel/module-registry';
import { fileService } from '../platform/files/file.service';
import { auditService } from '../platform/audit/audit.service';
import type { AuthContext } from '../shared/types';
import {
  APPLICANT_REGISTRY,
  USER_SCOPED_COLLECTIONS,
  applicantTargets,
  type Target,
} from '../workforce-reset/targets';

/** `applicant-portal.constants.ts` — the `subjectType` a candidate's portal login carries. */
const APPLICANT_PORTAL_SUBJECT_TYPE = 'applicant';

export interface PurgeOptions {
  /** Exact `fullNameAr` values, read from a file outside the repository. */
  names: string[];
  status: ApplicantStatus;
  write: boolean;
  /** Soft-delete file metadata and leave the bytes in storage, instead of removing them. */
  keepFileBlobs: boolean;
  /** The ids the dry run printed, echoed back, so the approved set and the deleted set are one. */
  approvedIds: string[];
  /** Username whose account the audit rows name. Required to write. */
  operator: string | null;
  /**
   * Collections to empty ENTIRELY — every row, not only the named applicants'.
   *
   * «أمسح كله ماعدا المتقدمين والفرز»: clearing the interview, evaluation and job-offer screens is
   * a different act from erasing seven people, and it is kept a different act here rather than
   * folded into the name match, so a run that empties a collection says so in its own line of the
   * report and cannot happen as a side effect of a name resolving oddly.
   *
   * Only a collection `applicantTargets()` already derived may be named (see `planPurge`), so this
   * can never be pointed at the employee registry or anything outside recruitment.
   */
  emptyCollections: string[];
}

export interface MatchedApplicant {
  id: Types.ObjectId;
  code: string;
  fullNameAr: string;
  nationalId: string | null;
  status: string;
  isDeleted: boolean;
  createdAt: Date | null;
}

export interface CollectionPlan {
  collection: string;
  why: string;
  /** Rows to delete outright. */
  deleteIds: Types.ObjectId[];
  /** Rows to pull items out of, with the nested paths to pull on. */
  pullFrom: { id: Types.ObjectId; paths: string[] }[];
  /** Rows a pull leaves with no items at all — reported, never deleted here. */
  emptiedByPull: string[];
}

export interface PlannedFile {
  id: string;
  entityType: string;
  originalName: string;
  size: number;
}

/** A matched applicant with its id as a string, which is what a JSON report should carry. */
export type ReportedApplicant = Omit<MatchedApplicant, 'id'> & { id: string };

export interface PurgeReport {
  mode: 'dry-run' | 'write';
  status: ApplicantStatus;
  filesMode: string;
  applicants: ReportedApplicant[];
  collections: {
    collection: string;
    why: string;
    rowsDeleted: number;
    rowsPulledFrom: number;
    rowsLeftEmptyByPull: string[];
  }[];
  /** Collections emptied in full — everybody's rows, not only the named applicants'. */
  emptied: { collection: string; documents: number }[];
  files: { count: number; bytes: number; byEntityType: Record<string, number> };
  portalAccounts: string[];
  userScoped: { collection: string; path: string; documents: number }[];
  ids: string[];
  filesRemoved?: number;
  fileFailures?: { id: string; reason: string }[];
}

export const db = (): mongoose.mongo.Db => {
  const connection = mongoose.connection.db;
  if (connection === undefined) throw new Error('this command needs a live database connection');
  return connection;
};

/**
 * Resolve each name to exactly one applicant, or refuse the WHOLE run.
 *
 * One query per name, deliberately, rather than one `$in`: a name that matched nothing and a name
 * that matched three are different mistakes and the operator has to be told which is which. The
 * refusal lists every unresolved name at once, so a file with two problems takes one round trip.
 *
 * `isDeleted` is NOT part of the match — a soft-deleted applicant is still a row to erase — but it
 * is reported, because "already deleted" changes what the counts mean.
 */
export const matchByName = async (
  names: string[],
  status: ApplicantStatus,
): Promise<MatchedApplicant[]> => {
  const matched: MatchedApplicant[] = [];
  const problems: string[] = [];
  for (const name of names) {
    const rows = await db()
      .collection(APPLICANT_REGISTRY)
      .find({ fullNameAr: name, status })
      .project({
        _id: 1,
        code: 1,
        fullNameAr: 1,
        nationalId: 1,
        status: 1,
        isDeleted: 1,
        createdAt: 1,
      })
      .toArray();
    if (rows.length !== 1) {
      problems.push(
        `  ${name} → ${String(rows.length)} applicants with status ${status}` +
          (rows.length > 1
            ? `: ${rows.map((r) => `${String(r['code'])} (${String(r['_id'])})`).join(', ')}`
            : ''),
      );
      continue;
    }
    const row = rows[0];
    if (row === undefined) continue;
    matched.push({
      id: row['_id'] as Types.ObjectId,
      code: String(row['code'] ?? ''),
      fullNameAr: String(row['fullNameAr']),
      nationalId: (row['nationalId'] as string | null) ?? null,
      status: String(row['status']),
      isDeleted: row['isDeleted'] === true,
      createdAt: (row['createdAt'] as Date | undefined) ?? null,
    });
  }
  if (problems.length > 0) {
    throw new Error(
      'refusing to continue: these names did not resolve to exactly one ' +
        `${status} applicant each. Nothing was read and nothing was touched.\n` +
        problems.join('\n') +
        '\nFix the names file (or --status) and run again.',
    );
  }
  return matched;
};

const isNested = (path: string): boolean => path.includes('.');

/** What one derived collection holds for these applicants, resolved to ids. */
export const planCollection = async (
  target: Target,
  ids: Types.ObjectId[],
): Promise<CollectionPlan> => {
  const plan: CollectionPlan = {
    collection: target.collection,
    why: target.why,
    deleteIds: [],
    pullFrom: [],
    emptiedByPull: [],
  };
  const top = target.paths.filter((p) => !isNested(p));

  if (top.length > 0) {
    const rows = await db()
      .collection(target.collection)
      .find({ $or: top.map((p) => ({ [p]: { $in: ids } })) })
      .project({ _id: 1 })
      .toArray();
    plan.deleteIds = rows.map((r) => r['_id'] as Types.ObjectId);
  }

  for (const path of target.paths.filter(isNested)) {
    const array = path.slice(0, path.lastIndexOf('.'));
    const leaf = path.slice(path.lastIndexOf('.') + 1);
    const rows = await db()
      .collection(target.collection)
      .find({ [path]: { $in: ids } })
      .project({ _id: 1, [array]: 1 })
      .toArray();
    for (const row of rows) {
      const id = row['_id'] as Types.ObjectId;
      // A row already going outright needs no pull.
      if (plan.deleteIds.some((d) => d.equals(id))) continue;
      const existing = plan.pullFrom.find((p) => p.id.equals(id));
      if (existing === undefined) plan.pullFrom.push({ id, paths: [path] });
      else existing.paths.push(path);
      const items: unknown = row[array];
      if (Array.isArray(items)) {
        const survives = (item: unknown): boolean => {
          const value = (item as Record<string, unknown> | null)?.[leaf];
          return !(value instanceof Types.ObjectId) || !ids.some((i) => i.equals(value));
        };
        if (!items.some(survives)) plan.emptiedByPull.push(String(id));
      }
    }
  }
  return plan;
};

/**
 * Every file filed against the applicants themselves or against a stage row being removed.
 *
 * The entity types are read off what is in the database rather than listed here. A list would be
 * wrong twice: `applicant-folder.service` knows only two of them (`applicant`,
 * `applicantDocuments`) and so would leave the `applicantOcr` ID-card scans behind, and a longer
 * list written today goes stale the next time a module files something against a candidate.
 */
export const planFiles = async (
  applicantIds: Types.ObjectId[],
  relatedIds: Types.ObjectId[],
): Promise<PlannedFile[]> => {
  const entityIds = [...new Set([...applicantIds, ...relatedIds].map(String))];
  const rows = await db()
    .collection('files')
    .find({ 'entityRef.entityId': { $in: entityIds } })
    .project({ _id: 1, entityRef: 1, originalName: 1, size: 1 })
    .toArray();
  return rows.map((r) => ({
    id: String(r['_id']),
    entityType: String((r['entityRef'] as { entityType?: string } | undefined)?.entityType ?? '?'),
    originalName: String(r['originalName'] ?? ''),
    size: Number(r['size'] ?? 0),
  }));
};

/** The portal logins these applicants sign in with, if any were ever provisioned. */
export const planPortalAccounts = async (ids: Types.ObjectId[]): Promise<Types.ObjectId[]> => {
  const rows = await db()
    .collection('users')
    .find({
      'externalSubject.subjectType': APPLICANT_PORTAL_SUBJECT_TYPE,
      'externalSubject.subjectId': { $in: ids },
    })
    .project({ _id: 1 })
    .toArray();
  return rows.map((r) => r['_id'] as Types.ObjectId);
};

/**
 * A context carrying every declared permission at organization scope.
 *
 * Break-glass, and spelled out rather than hidden. The operator is the person who owns the
 * database, every file removal is audited with its fingerprint, and the alternative — a hand-picked
 * permission list — fails by SILENTLY SKIPPING a file whose owning module asks for a key nobody
 * thought of. "Erase them completely" is the one job that cannot have that outcome.
 */
export const breakGlassContext = (userId: string): AuthContext => ({
  userId,
  sessionId: 'purge-applicants',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: Object.fromEntries(
    [...platformPermissions, ...getRegisteredModules().flatMap((m) => m.permissions)].map((p) => [
      p.key,
      'organization' as DataScope,
    ]),
  ),
  permissionVersion: 0,
  isPrivileged: true,
});

/** Every document this run would touch, for the backup written before the first delete. */
export const affectedDocuments = async (
  ids: Types.ObjectId[],
  plans: CollectionPlan[],
  portalAccounts: Types.ObjectId[],
  files: PlannedFile[],
  empties: EmptyPlan[],
): Promise<Record<string, unknown[]>> => {
  const documents: Record<string, unknown[]> = {};
  documents[APPLICANT_REGISTRY] = await db()
    .collection(APPLICANT_REGISTRY)
    .find({ _id: { $in: ids } })
    .toArray();
  for (const plan of plans) {
    const touched = [...plan.deleteIds, ...plan.pullFrom.map((p) => p.id)];
    if (touched.length === 0) continue;
    documents[plan.collection] = await db()
      .collection(plan.collection)
      .find({ _id: { $in: touched } })
      .toArray();
  }
  if (portalAccounts.length > 0) {
    documents['users'] = await db()
      .collection('users')
      .find({ _id: { $in: portalAccounts } })
      .toArray();
    for (const { collection, path } of USER_SCOPED_COLLECTIONS) {
      const rows = await db()
        .collection(collection)
        .find({ [path]: { $in: portalAccounts } })
        .toArray();
      if (rows.length > 0) documents[collection] = rows;
    }
  }
  for (const empty of empties) {
    if (empty.documents === 0) continue;
    // The WHOLE collection, not just the named applicants' rows: it is about to be emptied, and
    // this file is the only thing that will still hold what everybody else's rows said.
    documents[empty.collection] = await db().collection(empty.collection).find({}).toArray();
  }
  documents['files'] = files;
  return documents;
};

export interface EmptyPlan {
  collection: string;
  /** How many rows the collection holds — all of which go. */
  documents: number;
  /** Their ids, so their attachments are found and the backup can be checked against them. */
  ids: Types.ObjectId[];
}

export interface Plan {
  matched: MatchedApplicant[];
  ids: Types.ObjectId[];
  plans: CollectionPlan[];
  empties: EmptyPlan[];
  files: PlannedFile[];
  portalAccounts: Types.ObjectId[];
  userScoped: { collection: string; path: string; documents: number }[];
}

/**
 * Resolve the names and work out everything that would go. Reads only — this is the dry run, and
 * `execute` below operates on exactly what this returned.
 */
export const planPurge = async (options: PurgeOptions): Promise<Plan> => {
  // Refuses here, by name, if a recruitment collection has been added and not classified.
  const targets = applicantTargets().filter((t) => t.action === 'purge');
  const matched = await matchByName(options.names, options.status);
  const ids = matched.map((m) => m.id);

  if (options.write) {
    const found = new Set(ids.map(String));
    const unexpected = options.approvedIds.filter((id) => !found.has(id));
    const unapproved = [...found].filter((id) => !options.approvedIds.includes(id));
    if (unexpected.length > 0 || unapproved.length > 0) {
      throw new Error(
        'refusing to write: --ids does not match what these names resolve to now, so the set you ' +
          'approved is not the set this would delete.\n' +
          (unexpected.length > 0 ? `  approved but not matched: ${unexpected.join(', ')}\n` : '') +
          (unapproved.length > 0 ? `  matched but not approved: ${unapproved.join(', ')}\n` : '') +
          'Re-run the dry run, read it, and pass the ids it prints.',
      );
    }
  }

  // Emptying a whole collection is only ever allowed for one the applicant derivation already
  // found, so a typo or a widened flag cannot reach `hr_employees`, `users`, or anything else.
  const emptiable = new Set(targets.map((t) => t.collection));
  const notEmptiable = options.emptyCollections.filter((c) => !emptiable.has(c));
  if (notEmptiable.length > 0) {
    throw new Error(
      `refusing to empty: ${notEmptiable.join(', ')} — only a recruitment collection holding ` +
        'applicant data may be emptied in full. The ones this run derived are: ' +
        `${[...emptiable].sort().join(', ')}.`,
    );
  }

  const plans: CollectionPlan[] = [];
  for (const target of targets) plans.push(await planCollection(target, ids));

  const empties: EmptyPlan[] = [];
  for (const collection of options.emptyCollections) {
    const rows = await db().collection(collection).find({}).project({ _id: 1 }).toArray();
    empties.push({
      collection,
      documents: rows.length,
      ids: rows.map((r) => r['_id'] as Types.ObjectId),
    });
  }

  // An emptied row's attachments go with it — an evaluation's sheet, an offer's signed papers —
  // or they would be left in storage with nothing left to say whose they were.
  const files = await planFiles(ids, [
    ...plans.flatMap((p) => p.deleteIds),
    ...empties.flatMap((e) => e.ids),
  ]);
  const portalAccounts = await planPortalAccounts(ids);

  const userScoped: Plan['userScoped'] = [];
  for (const { collection, path } of USER_SCOPED_COLLECTIONS) {
    userScoped.push({
      collection,
      path,
      documents:
        portalAccounts.length === 0
          ? 0
          : await db()
              .collection(collection)
              .countDocuments({ [path]: { $in: portalAccounts } }),
    });
  }
  return { matched, ids, plans, empties, files, portalAccounts, userScoped };
};

/** Delete it. Only ever called after the backup has been written. */
export const execute = async (
  plan: Plan,
  options: PurgeOptions,
  ctx: AuthContext,
  backupPath: string,
): Promise<{ filesRemoved: number; fileFailures: { id: string; reason: string }[] }> => {
  const { ids, plans, files, portalAccounts, matched } = plan;

  // FILES FIRST, while the rows that authorize them still exist. The owning module's authorizer
  // reads the applicant (or the screening, or the offer) to answer «may this caller touch this
  // file», so a file whose entity has already been deleted can no longer be authorized — and would
  // be left behind with its bytes still in storage.
  let filesRemoved = 0;
  const fileFailures: { id: string; reason: string }[] = [];
  for (const file of files) {
    try {
      if (options.keepFileBlobs) await fileService.softDelete(ctx, file.id);
      else await fileService.permanentDelete(ctx, file.id);
      filesRemoved += 1;
    } catch (error: unknown) {
      fileFailures.push({
        id: file.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const collectionPlan of plans) {
    if (collectionPlan.deleteIds.length > 0) {
      await db()
        .collection(collectionPlan.collection)
        .deleteMany({ _id: { $in: collectionPlan.deleteIds } });
    }
    for (const { id, paths } of collectionPlan.pullFrom) {
      for (const path of paths) {
        const array = path.slice(0, path.lastIndexOf('.'));
        const leaf = path.slice(path.lastIndexOf('.') + 1);
        // The array and the leaf are computed from a schema path discovered at run time, which the
        // driver's `PullOperator` cannot express — it types a dynamic key as never-pullable. The
        // shape is fixed by the two `slice`s above, so the cast narrows nothing real.
        const pull = {
          $pull: { [array]: { [leaf]: { $in: ids } } },
        } as unknown as mongoose.mongo.UpdateFilter<mongoose.mongo.BSON.Document>;
        await db().collection(collectionPlan.collection).updateOne({ _id: id }, pull);
      }
    }
  }

  // Whole-collection emptying, after the per-applicant work: the named applicants' rows are
  // already gone by here, so what this removes is everybody else's, which is what makes the
  // report's two sections mean different things.
  for (const empty of plan.empties) {
    await db().collection(empty.collection).deleteMany({});
  }

  if (portalAccounts.length > 0) {
    for (const { collection, path } of USER_SCOPED_COLLECTIONS) {
      await db()
        .collection(collection)
        .deleteMany({ [path]: { $in: portalAccounts } });
    }
    await db()
      .collection('users')
      .deleteMany({ _id: { $in: portalAccounts } });
  }

  await db()
    .collection(APPLICANT_REGISTRY)
    .deleteMany({ _id: { $in: ids } });

  // One row per applicant, naming what went and where the backup is. The audit trail is never
  // rewritten by this tool — only added to, which is what makes the erasure itself traceable.
  for (const applicant of matched) {
    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'applicant', entityId: String(applicant.id) },
      action: 'purge',
      changes: [
        { field: 'applicantCode', old: applicant.code, new: null },
        { field: 'status', old: applicant.status, new: null },
        { field: 'filesRemoved', old: null, new: filesRemoved },
        { field: 'backup', old: null, new: backupPath },
      ],
    });
  }
  return { filesRemoved, fileFailures };
};

/** The report both modes print, built from the plan. */
export const reportOf = (plan: Plan, options: PurgeOptions): PurgeReport => ({
  mode: options.write ? 'write' : 'dry-run',
  status: options.status,
  filesMode: options.keepFileBlobs
    ? 'soft-delete (blobs KEPT in storage)'
    : 'permanent (blobs removed)',
  applicants: plan.matched.map((m) => ({ ...m, id: String(m.id) })),
  collections: plan.plans.map((p) => ({
    collection: p.collection,
    why: p.why,
    rowsDeleted: p.deleteIds.length,
    rowsPulledFrom: p.pullFrom.length,
    rowsLeftEmptyByPull: p.emptiedByPull,
  })),
  emptied: plan.empties.map((e) => ({ collection: e.collection, documents: e.documents })),
  files: {
    count: plan.files.length,
    bytes: plan.files.reduce((sum, f) => sum + f.size, 0),
    byEntityType: Object.fromEntries(
      [...new Set(plan.files.map((f) => f.entityType))].map((t) => [
        t,
        plan.files.filter((f) => f.entityType === t).length,
      ]),
    ),
  },
  portalAccounts: plan.portalAccounts.map(String),
  userScoped: plan.userScoped,
  ids: plan.ids.map(String),
});
