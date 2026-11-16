// Permanent delete of one applicant — «مسح نهائي» for somebody in the recruitment pipeline.
//
// The sibling of `employee-purge.ts`, and deliberately the simpler of the two: an applicant has no
// «keep» side. Everything filed against a candidate — their screening, both interview rounds, the
// evaluations, the batch they were put in, their documents, the timeline and its workflow events,
// and the offer made to them — exists only because they applied. There is no gold receipt or
// traffic violation in the recruitment cycle: nothing here is a record about money or a vehicle
// that merely happens to name a person. So there is nothing to rewrite, only rows to remove.
//
// IT REFUSES ON THE ONE CANDIDATE WHO IS NOT ONLY A CANDIDATE. Somebody hired became an EMPLOYEE,
// and `hr_employees.applicantId` still points back here. Purging them from the pipeline would
// delete the job offer — which the applicant rule purges by design — and that offer is the record
// of a hiring decision for a person who still works for the company. It would also leave the
// employee holding a reference to an applicant that no longer exists. The honest answer is not to
// do half of it: the refusal names the employee, and `employee.purge` is the tool for that person,
// which removes the pipeline rows with them.
//
// WHAT IT TAKES BESIDES THE DERIVED COLLECTIONS: the candidate's own portal account and everything
// scoped to it, and every file — the ID-card scans the reader made, the portrait, the CV, the
// papers they uploaded — including files filed against the STAGE rows rather than the applicant,
// which is why those ids are gathered before anything is deleted.
//
// THE AUDIT TRAIL IS NOT TOUCHED. Append-only by ADR-012, retention "Years (compliance)", and
// production protects it with a restricted database role. The purge adds one row, which afterwards
// is the only trace of the candidate that is meant to survive.
import mongoose, { Types } from 'mongoose';
import { fileService } from '../../../../platform/files/file.service';
import { auditService } from '../../../../platform/audit/audit.service';
import type { AuthContext } from '../../../../shared/types';
import { BusinessRuleError } from '../../../../shared/errors';
import {
  APPLICANT_REGISTRY,
  USER_SCOPED_COLLECTIONS,
  applicantTargets,
  type Target,
} from '../../../../workforce-reset/targets';
import { APPLICANT_PORTAL_SUBJECT } from '../applicant-portal';

const db = (): mongoose.mongo.Db => {
  const connection = mongoose.connection.db;
  if (connection === undefined) throw new Error('the permanent delete needs a live connection');
  return connection;
};

export interface PurgedApplicant {
  id: string;
  code: string;
  fullNameAr: string;
  status: string;
}

export interface ApplicantCollectionPlan {
  collection: string;
  why: string;
  deleteIds: Types.ObjectId[];
  pullFrom: { id: Types.ObjectId; paths: string[] }[];
}

export interface ApplicantPurgePlan {
  applicant: PurgedApplicant;
  /** Their portal login, if one was ever provisioned. */
  userId: Types.ObjectId | null;
  purges: ApplicantCollectionPlan[];
  files: { id: string; entityType: string; size: number }[];
  userScoped: { collection: string; path: string; documents: number }[];
}

const isNested = (path: string): boolean => path.includes('.');

const planCollection = async (
  target: Target,
  id: Types.ObjectId,
): Promise<ApplicantCollectionPlan> => {
  const plan: ApplicantCollectionPlan = {
    collection: target.collection,
    why: target.why,
    deleteIds: [],
    pullFrom: [],
  };
  const top = target.paths.filter((p) => !isNested(p));
  if (top.length > 0) {
    const rows = await db()
      .collection(target.collection)
      .find({ $or: top.map((p) => ({ [p]: { $in: [id] } })) })
      .project({ _id: 1 })
      .toArray();
    plan.deleteIds = rows.map((r) => r['_id'] as Types.ObjectId);
  }
  // `hr_evaluation_batches` holds its candidates in `items[].applicantId`: a batch is made of
  // SEVERAL people, so the item is pulled and the batch is left standing. Deleting it would erase
  // the other candidates in it.
  for (const path of target.paths.filter(isNested)) {
    const rows = await db()
      .collection(target.collection)
      .find({ [path]: { $in: [id] } })
      .project({ _id: 1 })
      .toArray();
    for (const row of rows) {
      const rowId = row['_id'] as Types.ObjectId;
      if (plan.deleteIds.some((d) => d.equals(rowId))) continue;
      const existing = plan.pullFrom.find((p) => p.id.equals(rowId));
      if (existing === undefined) plan.pullFrom.push({ id: rowId, paths: [path] });
      else existing.paths.push(path);
    }
  }
  return plan;
};

/**
 * Work out everything that would go, and refuse the candidate who is now an employee.
 *
 * `applicantTargets()` refuses here too, on any recruitment collection nobody has classified — so
 * a pipeline that grew a new table since this was written stops the purge rather than leaving rows
 * behind it cannot see.
 */
export const planApplicantPurge = async (applicantId: string): Promise<ApplicantPurgePlan> => {
  const id = new Types.ObjectId(applicantId);
  const row = await db().collection(APPLICANT_REGISTRY).findOne({ _id: id });
  if (row === null) throw new BusinessRuleError('no such applicant');

  // The one refusal, and it is checked against the EMPLOYEE registry rather than the applicant's
  // own status: a status can be corrected by hand, while an employee row carrying `applicantId` is
  // the fact that somebody was hired out of this record.
  const hired = await db()
    .collection('hr_employees')
    .findOne({ applicantId: id }, { projection: { _id: 1, code: 1 } });
  if (hired !== null) {
    throw new BusinessRuleError(
      `this candidate was hired and is now employee ${String(hired['code'] ?? '')}. Erasing them ` +
        'from the pipeline would delete the offer that records that hiring and leave the employee ' +
        'pointing at an applicant that no longer exists — permanently delete the EMPLOYEE instead, ' +
        'which removes these recruitment rows with them.',
    );
  }

  const purges: ApplicantCollectionPlan[] = [];
  for (const target of applicantTargets().filter((t) => t.action === 'purge')) {
    purges.push(await planCollection(target, id));
  }

  const account = await db()
    .collection('users')
    .findOne(
      { 'externalSubject.subjectType': APPLICANT_PORTAL_SUBJECT, 'externalSubject.subjectId': id },
      { projection: { _id: 1 } },
    );
  const userId = account === null ? null : (account['_id'] as Types.ObjectId);

  // Files against the candidate AND against each stage row going with them: the card scans are
  // filed on the applicant, a screening's attachments on the screening, an offer's on the offer.
  const entityIds = [...new Set([String(id), ...purges.flatMap((p) => p.deleteIds).map(String)])];
  const fileRows = await db()
    .collection('files')
    .find({ 'entityRef.entityId': { $in: entityIds } })
    .project({ _id: 1, entityRef: 1, size: 1 })
    .toArray();

  const userScoped: ApplicantPurgePlan['userScoped'] = [];
  for (const { collection, path } of USER_SCOPED_COLLECTIONS) {
    userScoped.push({
      collection,
      path,
      documents:
        userId === null
          ? 0
          : await db()
              .collection(collection)
              .countDocuments({ [path]: userId }),
    });
  }

  return {
    applicant: {
      id: String(id),
      code: String(row['code'] ?? ''),
      fullNameAr: String(row['fullNameAr'] ?? ''),
      status: String(row['status'] ?? ''),
    },
    userId,
    purges,
    files: fileRows.map((f) => ({
      id: String(f['_id']),
      entityType: String(
        (f['entityRef'] as { entityType?: string } | undefined)?.entityType ?? '?',
      ),
      size: Number(f['size'] ?? 0),
    })),
    userScoped,
  };
};

export interface ApplicantPurgeResult {
  filesRemoved: number;
  fileFailures: { id: string; reason: string }[];
  rowsDeleted: number;
}

/** Do it. There is no undo. */
export const executeApplicantPurge = async (
  ctx: AuthContext,
  plan: ApplicantPurgePlan,
): Promise<ApplicantPurgeResult> => {
  const id = new Types.ObjectId(plan.applicant.id);

  // FILES FIRST, while the rows that authorize them still exist. A file whose owning screening or
  // offer has already gone can no longer be authorized, and would be left with its bytes in
  // storage — which for an ID-card scan is the one outcome this feature exists to prevent.
  let filesRemoved = 0;
  const fileFailures: { id: string; reason: string }[] = [];
  for (const file of plan.files) {
    try {
      await fileService.permanentDelete(ctx, file.id);
      filesRemoved += 1;
    } catch (error: unknown) {
      fileFailures.push({
        id: file.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let rowsDeleted = 0;
  for (const purge of plan.purges) {
    if (purge.deleteIds.length > 0) {
      const res = await db()
        .collection(purge.collection)
        .deleteMany({ _id: { $in: purge.deleteIds } });
      rowsDeleted += res.deletedCount;
    }
    for (const { id: rowId, paths } of purge.pullFrom) {
      for (const path of paths) {
        const array = path.slice(0, path.lastIndexOf('.'));
        const leaf = path.slice(path.lastIndexOf('.') + 1);
        // Computed from a schema path discovered at run time, which the driver's `PullOperator`
        // types as never-pullable.
        const pull = { $pull: { [array]: { [leaf]: id } } } as unknown as
          mongoose.mongo.UpdateFilter<mongoose.mongo.BSON.Document>;
        await db().collection(purge.collection).updateOne({ _id: rowId }, pull);
      }
    }
  }

  if (plan.userId !== null) {
    for (const { collection, path } of USER_SCOPED_COLLECTIONS) {
      const res = await db()
        .collection(collection)
        .deleteMany({ [path]: plan.userId });
      rowsDeleted += res.deletedCount;
    }
    await db().collection('users').deleteOne({ _id: plan.userId });
    rowsDeleted += 1;
  }

  await db().collection(APPLICANT_REGISTRY).deleteOne({ _id: id });
  rowsDeleted += 1;

  await auditService.record({
    entityRef: { moduleId: 'hr', entityType: 'applicant', entityId: plan.applicant.id },
    action: 'purge',
    changes: [
      { field: 'applicantCode', old: plan.applicant.code, new: null },
      { field: 'fullNameAr', old: plan.applicant.fullNameAr, new: null },
      { field: 'status', old: plan.applicant.status, new: null },
      { field: 'rowsDeleted', old: null, new: rowsDeleted },
      { field: 'filesRemoved', old: null, new: filesRemoved },
    ],
  });

  return { filesRemoved, fileFailures, rowsDeleted };
};
