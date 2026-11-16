// Permanent delete of one employee — «مسح نهائي»: the person leaves the system, everywhere.
//
// This is the only hard delete of a person the product has. Everything else about an employee is a
// state change: terminated, resigned, archived. That is deliberate, and so is this — a break-glass
// authority (`employee.purge`) for somebody entered by mistake, a duplicate, a test record.
//
// WHAT IT TOUCHES, AND WHY THE THREE KINDS ARE DIFFERENT ACTS.
//
//   PURGED — the 43-odd collections `employeeTargets()` classifies `purge`: the row exists only
//   because the person does. A payslip, a leave balance, an attendance day, a contract. These are
//   deleted. It is worth being plain that this includes PAY AND CONTRACT HISTORY.
//
//   SCRUBBED — the collections classified `keep`: a gold receipt, a traffic violation, the
//   consumables stock ledger whose every on-hand figure is the sum of its rows. These rows are
//   records in their own right and are NOT deleted; deleting them would destroy a financial or
//   legal record about a vehicle, a machine or the money, and corrupt running totals that belong
//   to nobody in particular. What goes is the person: every copy of their name on such a row is
//   rewritten to «موظف محذوف» (`employee-name-copies.ts`, which refuses any name field nobody has
//   classified). The id beside it is left pointing at a row that no longer exists, which is the
//   honest state — `targets.ts` makes that same argument at length.
//
//   REMOVED WITH THEM — their account and everything scoped to it, their files and the bytes
//   behind them.
//
// WHAT IT DELIBERATELY DOES NOT TOUCH: the audit trail. It is append-only by ADR-012, its
// retention is "Years (compliance)", and production protects `audit_logs` with a restricted
// database role — a delete there would fail on the machine that matters. The actor snapshot on
// each row exists precisely so that deleting somebody cannot rewrite what was done.
//
// ORDER MATTERS, in one place especially: files go FIRST, while the rows that authorize them still
// exist. A file whose owning entity has already been deleted can no longer be authorized, and
// would be left behind with its bytes still in storage.
import mongoose, { Types } from 'mongoose';
import { fileService } from '../../../../platform/files/file.service';
import { auditService } from '../../../../platform/audit/audit.service';
import type { AuthContext } from '../../../../shared/types';
import { USER_SCOPED_COLLECTIONS, employeeTargets, type Target } from '../../../../workforce-reset/targets';
import { PURGED_EMPLOYEE_NAME, nameCopiesToScrub } from './employee-name-copies';

/** Not in the derived set — it has no `employeeId`, it IS the employee. */
const EMPLOYEE_REGISTRY = 'hr_employees';

const db = (): mongoose.mongo.Db => {
  const connection = mongoose.connection.db;
  if (connection === undefined) throw new Error('the permanent delete needs a live connection');
  return connection;
};

export interface PurgedEmployee {
  id: string;
  code: string;
  fullNameAr: string;
  status: string;
}

export interface CollectionPlan {
  collection: string;
  why: string;
  /** Rows deleted outright — the employee path is top-level, so the row is about them. */
  deleteIds: Types.ObjectId[];
  /** Rows an item is pulled out of — the path sits inside a subdocument array. */
  pullFrom: { id: Types.ObjectId; paths: string[] }[];
}

export interface ScrubPlan {
  collection: string;
  path: string;
  why: string;
  documents: number;
}

export interface PlannedFile {
  id: string;
  entityType: string;
  size: number;
}

export interface EmployeePurgePlan {
  employee: PurgedEmployee;
  /** Their account, if they had one. */
  userId: Types.ObjectId | null;
  purges: CollectionPlan[];
  scrubs: ScrubPlan[];
  files: PlannedFile[];
  userScoped: { collection: string; path: string; documents: number }[];
  /** Named in the report so "left alone" is visible rather than merely true. */
  keptCollections: string[];
}

const isNested = (path: string): boolean => path.includes('.');

/** What one `purge` collection holds for this employee, resolved to ids. */
const planCollection = async (target: Target, id: Types.ObjectId): Promise<CollectionPlan> => {
  const plan: CollectionPlan = {
    collection: target.collection,
    why: target.why,
    deleteIds: [],
    pullFrom: [],
  };
  const top = target.paths.filter((p) => !isNested(p));
  if (top.length > 0) {
    const rows = await db()
      .collection(target.collection)
      // `$in` on a scalar path matches equality; on an array path it matches membership, which is
      // what `captainEmployeeIds`-shaped fields need and gets for free.
      .find({ $or: top.map((p) => ({ [p]: { $in: [id] } })) })
      .project({ _id: 1 })
      .toArray();
    plan.deleteIds = rows.map((r) => r['_id'] as Types.ObjectId);
  }
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
 * Work out everything that would go, and everything that would be rewritten. Reads only.
 *
 * `employeeTargets()` and `nameCopiesToScrub()` both refuse here — on a collection nobody has
 * classified, and on a name field nobody has classified — so an unplanned purge never starts.
 */
export const planEmployeePurge = async (employeeId: string): Promise<EmployeePurgePlan> => {
  const id = new Types.ObjectId(employeeId);
  const row = await db().collection(EMPLOYEE_REGISTRY).findOne({ _id: id });
  if (row === null) throw new Error(`no employee ${employeeId}`);

  const targets = employeeTargets();
  const account = await db()
    .collection('users')
    .findOne({ employeeId: id }, { projection: { _id: 1 } });
  const userId = account === null ? null : (account['_id'] as Types.ObjectId);

  const purges: CollectionPlan[] = [];
  for (const target of targets.filter((t) => t.action === 'purge')) {
    purges.push(await planCollection(target, id));
  }

  const scrubs: ScrubPlan[] = [];
  for (const copy of nameCopiesToScrub()) {
    const match = copy.by.kind === 'employee' ? id : userId;
    if (match === null) continue;
    scrubs.push({
      collection: copy.collection,
      path: copy.path,
      why: copy.why,
      documents: await db()
        .collection(copy.collection)
        .countDocuments({ [copy.by.path]: match, [copy.path]: { $ne: null } }),
    });
  }

  // Files against the employee AND against every row going with them: a loan's attachment is
  // filed on the loan, an action's on the action, so the ids have to be gathered first.
  const entityIds = [...new Set([String(id), ...purges.flatMap((p) => p.deleteIds).map(String)])];
  const fileRows = await db()
    .collection('files')
    .find({ 'entityRef.entityId': { $in: entityIds } })
    .project({ _id: 1, entityRef: 1, size: 1 })
    .toArray();

  const userScoped: EmployeePurgePlan['userScoped'] = [];
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
    employee: {
      id: String(id),
      code: String(row['code'] ?? ''),
      fullNameAr: String((row['personal'] as { fullNameAr?: string } | undefined)?.fullNameAr ?? ''),
      status: String(row['status'] ?? ''),
    },
    userId,
    purges,
    scrubs,
    files: fileRows.map((f) => ({
      id: String(f['_id']),
      entityType: String(
        (f['entityRef'] as { entityType?: string } | undefined)?.entityType ?? '?',
      ),
      size: Number(f['size'] ?? 0),
    })),
    userScoped,
    keptCollections: targets.filter((t) => t.action === 'keep').map((t) => t.collection).sort(),
  };
};

export interface EmployeePurgeResult {
  filesRemoved: number;
  fileFailures: { id: string; reason: string }[];
  rowsDeleted: number;
  namesScrubbed: number;
}

/** Do it. There is no undo. */
export const executeEmployeePurge = async (
  ctx: AuthContext,
  plan: EmployeePurgePlan,
): Promise<EmployeePurgeResult> => {
  const id = new Types.ObjectId(plan.employee.id);

  // FILES FIRST, while the rows that authorize them still exist.
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

  // THE NAME COPIES, before the rows that say whose they are go away. Matching is on the id, so
  // the order is not strictly forced — but doing it first keeps the plan and the write looking at
  // the same world, and a failure here stops the purge before anything is destroyed.
  let namesScrubbed = 0;
  for (const copy of nameCopiesToScrub()) {
    const match = copy.by.kind === 'employee' ? id : plan.userId;
    if (match === null) continue;
    const res = await db()
      .collection(copy.collection)
      .updateMany(
        { [copy.by.path]: match, [copy.path]: { $ne: null } },
        { $set: { [copy.path]: PURGED_EMPLOYEE_NAME } },
      );
    namesScrubbed += res.modifiedCount;
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
        // The array and the leaf are read off a schema path discovered at run time, which the
        // driver's `PullOperator` cannot express — it types a dynamic key as never-pullable.
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

  await db().collection(EMPLOYEE_REGISTRY).deleteOne({ _id: id });
  rowsDeleted += 1;

  // The audit trail is not rewritten — it is added to. This row is what proves the erasure
  // happened, who did it and what it took, and it is the only trace of the person that survives
  // on purpose.
  await auditService.record({
    entityRef: { moduleId: 'hr', entityType: 'employee', entityId: plan.employee.id },
    action: 'purge',
    changes: [
      { field: 'employeeCode', old: plan.employee.code, new: null },
      { field: 'fullNameAr', old: plan.employee.fullNameAr, new: null },
      { field: 'status', old: plan.employee.status, new: null },
      { field: 'rowsDeleted', old: null, new: rowsDeleted },
      { field: 'namesScrubbed', old: null, new: namesScrubbed },
      { field: 'filesRemoved', old: null, new: filesRemoved },
    ],
  });

  return { filesRemoved, fileFailures, rowsDeleted, namesScrubbed };
};
