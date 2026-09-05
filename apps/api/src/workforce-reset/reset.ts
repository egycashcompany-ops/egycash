// The reset run: count everything, then — only when told to — delete it.
//
// Same shape as the importer, and for the same reason: the harmless invocation is the default, and
// a dry run walks the SAME path as a real one so its counts are evidence about the run that
// follows. Nothing here decides WHAT is touched; `targets.ts` does, and it refuses to start if it
// meets a collection nobody has classified.
import mongoose, { Types } from 'mongoose';
import { logger } from '../infrastructure/logging/logger';
import {
  SURVIVING_ROLE_KEYS,
  USER_SCOPED_COLLECTIONS,
  employeeTargets,
  type Target,
} from './targets';

/** The employee registry itself. Not in the derived set — it has no `employeeId`, it IS the employee. */
const EMPLOYEES = 'hr_employees';
const USERS = 'users';
const ROLES = 'roles';
const ROLE_ASSIGNMENTS = 'role_assignments';

export interface SurvivingUser {
  id: string;
  username: string | null;
  email: string | null;
  roles: string[];
}

export interface ResetReport {
  mode: 'dry-run' | 'write';
  /** Every account that survives, named — the first thing a human should read. */
  survivors: SurvivingUser[];
  /** Accounts that go, named, so a reset can be checked against a list before it runs. */
  doomed: { id: string; username: string | null; email: string | null }[];
  employees: number;
  /** Employee-scoped collections, emptied. */
  purged: { collection: string; documents: number; why: string }[];
  /** Collections left completely alone, and how many rows in each name an employee. */
  untouched: { collection: string; documentsNamingAnEmployee: number; why: string }[];
  /** Rows removed alongside the deleted accounts. */
  userScoped: { collection: string; documents: number }[];
  /**
   * The Global Employee Number counter, reported and NOT reset. Winding it back would reissue a
   * number somebody already holds on paper; the import raises it when it needs to.
   */
  employeeSequence: number | null;
}

const db = () => {
  const connection = mongoose.connection.db;
  if (connection === undefined) throw new Error('the reset needs a live database connection');
  return connection;
};

/** Count the rows in `collection` whose employee-naming paths are actually populated. */
const countNamingAnEmployee = async (target: Target): Promise<number> =>
  db()
    .collection(target.collection)
    .countDocuments({ $or: target.paths.map((p) => ({ [p]: { $nin: [null, []] } })) });

/**
 * Who survives, and it is deliberately generous.
 *
 * ANY assignment to a surviving role keeps the account, INCLUDING AN EXPIRED ONE. In an operation
 * with no undo, keeping one account too many is a nuisance; deleting an administrator whose grant
 * lapsed last week locks a real person out of a system that has just been emptied. The asymmetry is
 * the whole point, so `validFrom`/`validTo` are not consulted.
 *
 * Survival is two NAMED roles, never "holds a system role": `employee-self-service` is an
 * `isSystem` role granted to every employee with a login, so that test would spare everybody.
 */
export const findSurvivors = async (): Promise<SurvivingUser[]> => {
  const roles = await db()
    .collection(ROLES)
    .find({ key: { $in: [...SURVIVING_ROLE_KEYS] } })
    .toArray();
  const roleKeyById = new Map(roles.map((r) => [String(r._id), String(r.key)]));

  const assignments = await db()
    .collection(ROLE_ASSIGNMENTS)
    .find({ roleId: { $in: roles.map((r) => r._id as Types.ObjectId) } })
    .toArray();

  const keysByUser = new Map<string, Set<string>>();
  for (const a of assignments) {
    const userId = String(a.userId);
    const key = roleKeyById.get(String(a.roleId));
    if (key === undefined) continue;
    const set = keysByUser.get(userId) ?? new Set<string>();
    set.add(key);
    keysByUser.set(userId, set);
  }
  if (keysByUser.size === 0) return [];

  const users = await db()
    .collection(USERS)
    .find({ _id: { $in: [...keysByUser.keys()].map((id) => new Types.ObjectId(id)) } })
    .toArray();

  return users
    .map((u) => ({
      id: String(u._id),
      username: (u.username as string | null) ?? null,
      email: (u.email as string | null) ?? null,
      roles: [...(keysByUser.get(String(u._id)) ?? [])].sort(),
    }))
    .sort((a, b) => (a.username ?? a.id).localeCompare(b.username ?? b.id));
};

export const runReset = async (opts: { write: boolean }): Promise<ResetReport> => {
  // Throws, by design, if any collection naming an employee is unclassified.
  const targets = employeeTargets();
  const survivors = await findSurvivors();

  // THE REFUSAL THAT MATTERS MOST. An empty survivor list means every account goes, and nobody is
  // left who can log in and put anything back. This is checked before a single delete, in both
  // modes, so a dry run reports it too.
  if (survivors.length === 0) {
    throw new Error(
      `refusing to reset: no account holds ${SURVIVING_ROLE_KEYS.join(' or ')}, so every user ` +
        'would be deleted and nobody could log in afterwards. Grant one of those roles first.',
    );
  }

  const survivorIds = survivors.map((s) => new Types.ObjectId(s.id));
  const doomedDocs = await db()
    .collection(USERS)
    .find({ _id: { $nin: survivorIds } })
    .project({ username: 1, email: 1 })
    .toArray();
  const doomed = doomedDocs
    .map((u) => ({
      id: String(u._id),
      username: (u.username as string | null) ?? null,
      email: (u.email as string | null) ?? null,
    }))
    .sort((a, b) => (a.username ?? a.id).localeCompare(b.username ?? b.id));

  const purgeTargets = targets.filter((t) => t.action === 'purge');
  const keepTargets = targets.filter((t) => t.action === 'keep');

  const purged: ResetReport['purged'] = [];
  for (const t of purgeTargets) {
    purged.push({
      collection: t.collection,
      documents: await db().collection(t.collection).countDocuments({}),
      why: t.why,
    });
  }

  const untouched: ResetReport['untouched'] = [];
  for (const t of keepTargets) {
    untouched.push({
      collection: t.collection,
      documentsNamingAnEmployee: await countNamingAnEmployee(t),
      why: t.why,
    });
  }

  const doomedIds = doomed.map((u) => new Types.ObjectId(u.id));
  const userScoped: ResetReport['userScoped'] = [];
  for (const { collection, path } of USER_SCOPED_COLLECTIONS) {
    userScoped.push({
      collection,
      documents: await db()
        .collection(collection)
        .countDocuments({ [path]: { $in: doomedIds } }),
    });
  }

  const employees = await db().collection(EMPLOYEES).countDocuments({});
  const sequence = await db().collection('hr_sequences').findOne({ _id: 'employee:global' as never });
  const employeeSequence = sequence === null ? null : Number(sequence.value);

  if (opts.write) {
    // Sessions first, so nobody whose account is about to vanish is still acting while it does.
    await db()
      .collection('sessions')
      .deleteMany({ userId: { $in: doomedIds } });

    for (const t of purgeTargets) await db().collection(t.collection).deleteMany({});
    await db().collection(EMPLOYEES).deleteMany({});

    for (const { collection, path } of USER_SCOPED_COLLECTIONS) {
      await db()
        .collection(collection)
        .deleteMany({ [path]: { $in: doomedIds } });
    }
    await db()
      .collection(USERS)
      .deleteMany({ _id: { $nin: survivorIds } });

    // Every employee is gone, so a surviving administrator's link to one is now a false statement
    // about their account. This is the user rule's own collection, so clearing it is its business.
    await db()
      .collection(USERS)
      .updateMany({ _id: { $in: survivorIds } }, { $set: { employeeId: null } });

    logger.warn(
      { employees, users: doomed.length, survivors: survivors.length },
      'workforce reset complete — employees and non-administrator accounts removed',
    );
  }

  return {
    mode: opts.write ? 'write' : 'dry-run',
    survivors,
    doomed,
    employees,
    purged: purged.sort((a, b) => b.documents - a.documents || a.collection.localeCompare(b.collection)),
    untouched: untouched.sort((a, b) => a.collection.localeCompare(b.collection)),
    userScoped: userScoped.sort((a, b) => b.documents - a.documents),
    employeeSequence,
  };
};
