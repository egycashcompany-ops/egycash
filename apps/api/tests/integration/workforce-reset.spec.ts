// The workforce reset, against a real database.
//
// The classification is unit-tested (`src/workforce-reset/targets.spec.ts`); this proves what
// actually happens to rows. Every claim here is one that, if wrong, destroys something
// irreplaceable or locks somebody out:
//
//   • the administrators survive, and everybody else goes;
//   • a dry run deletes nothing at all;
//   • employee-scoped rows go;
//   • the eight untouchable collections are not modified — not one field;
//   • the audit trail survives an account being deleted;
//   • with no administrator, the reset refuses rather than emptying the account table.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { runReset, findSurvivors } from '../../src/workforce-reset/reset';

let replSet: MongoMemoryReplSet | null = null;

const db = () => {
  const connection = mongoose.connection.db;
  if (connection === undefined) throw new Error('no connection');
  return connection;
};

const oid = () => new Types.ObjectId();

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-workforce-reset-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const ADMIN = oid();
const HR_ADMIN = oid();
const STAFF = oid();
const APPLICANT = oid();
const EMPLOYEE = oid();
// The administrator is on the payroll too, and needs an employee of their OWN: `users.ux_employeeId`
// is unique, so two accounts cannot name one employee. That is the state the last test here is
// about — an administrator who survives while the employee they are linked to does not.
const ADMIN_EMPLOYEE = oid();

// Resolved in `seed()`, not generated here: the boot seeds some of these roles itself, so the
// fixture has to adopt whatever id boot gave them rather than assert one of its own.
let SUPER_ROLE: Types.ObjectId;
let PLATFORM_ROLE: Types.ObjectId;
let ESS_ROLE: Types.ObjectId;

/**
 * Adopt the role boot created, or create it. The boot already seeds `employee-self-service` (and
 * may seed the two administrator roles), so inserting them here collides on `ux_key`; the id that
 * matters is the one the assignments point at, whoever wrote the row.
 */
const ensureRole = async (key: string): Promise<Types.ObjectId> => {
  await db()
    .collection('roles')
    .updateOne({ key } as never, { $setOnInsert: { key, isSystem: true } } as never, {
      upsert: true,
    });
  const role = await db().collection('roles').findOne({ key } as never);
  if (role === null) throw new Error(`role ${key} missing after upsert`);
  return role._id as Types.ObjectId;
};

/**
 * Two administrators, two doomed accounts, and — the trap — the doomed ones hold
 * `employee-self-service`, which IS a system role. A survival test keyed on "holds a system role"
 * would spare them, and with them the entire workforce.
 */
const seed = async (): Promise<void> => {
  SUPER_ROLE = await ensureRole('super-admin');
  PLATFORM_ROLE = await ensureRole('platform-admin');
  ESS_ROLE = await ensureRole('employee-self-service');

  // `isDeleted: false` on every row is not decoration: `ux_email`, `ux_username` and
  // `ux_userId_roleId_scope` are all partial on it, so rows without the field are exempt from the
  // uniqueness the real system enforces. These are meant to be rows the database would accept.
  await db().collection('users').insertMany([
    {
      _id: ADMIN,
      username: 'admin@ecms.local',
      email: 'admin@ecms.local',
      employeeId: ADMIN_EMPLOYEE,
      isDeleted: false,
    },
    { _id: HR_ADMIN, username: 'hr@ecms.local', email: 'hr@ecms.local', employeeId: null, isDeleted: false },
    { _id: STAFF, username: 'br1000001', email: 'staff@ecms.com', employeeId: EMPLOYEE, isDeleted: false },
    {
      _id: APPLICANT,
      username: 'applicant-app-2026-000079',
      email: null,
      employeeId: null,
      isDeleted: false,
    },
  ] as never);

  await db().collection('role_assignments').insertMany([
    { userId: ADMIN, roleId: SUPER_ROLE, validFrom: null, validTo: null, isDeleted: false },
    // EXPIRED, and it must still save this account: deleting an administrator whose grant lapsed
    // last week locks a real person out of a system that has just been emptied.
    {
      userId: HR_ADMIN,
      roleId: PLATFORM_ROLE,
      validFrom: null,
      validTo: new Date('2020-01-01'),
      isDeleted: false,
    },
    { userId: STAFF, roleId: ESS_ROLE, validFrom: null, validTo: null, isDeleted: false },
    { userId: APPLICANT, roleId: ESS_ROLE, validFrom: null, validTo: null, isDeleted: false },
  ] as never);

  await db()
    .collection('hr_employees')
    .insertMany([
      { _id: EMPLOYEE, code: '0100004', employeeNumber: '0004', isDeleted: false },
      { _id: ADMIN_EMPLOYEE, code: '0100005', employeeNumber: '0005', isDeleted: false },
    ] as never);

  // Employee-scoped rows, which go.
  await db().collection('hr_payslips').insertMany([{ _id: oid(), employeeId: EMPLOYEE }] as never);
  await db().collection('hr_leave_requests').insertMany([{ _id: oid(), employeeId: EMPLOYEE }] as never);
  await db()
    .collection('operations_crew_assignments')
    .insertMany([{ _id: oid(), captainEmployeeIds: [EMPLOYEE] }] as never);

  // Untouchable rows, which must survive UNMODIFIED.
  await db()
    .collection('gold_receiving_receipts')
    .insertMany([{ _id: oid(), teamLeaderEmployeeId: EMPLOYEE, grams: 5000 }] as never);
  await db()
    .collection('fleet_violations')
    .insertMany([{ _id: oid(), driverEmployeeId: EMPLOYEE, fine: 300 }] as never);
  await db()
    .collection('hr_job_offers')
    .insertMany([{ _id: oid(), hiredEmployeeId: EMPLOYEE, code: 'JO-2026-000001' }] as never);

  // User-scoped rows for a doomed account, and the audit entry that must outlive it.
  await db().collection('sessions').insertMany([{ _id: oid(), userId: STAFF }] as never);
  await db().collection('push_subscriptions').insertMany([{ _id: oid(), userId: STAFF }] as never);
  await db()
    .collection('audit_logs')
    .insertMany([{ _id: oid(), userId: STAFF, action: 'update' }] as never);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await seed();
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('who survives a workforce reset', () => {
  it('keeps the two administrators and nobody else — an expired grant still saves an account', async () => {
    const survivors = await findSurvivors();
    expect(survivors.map((s) => s.username).sort()).toEqual(['admin@ecms.local', 'hr@ecms.local']);
    expect(survivors.find((s) => s.username === 'hr@ecms.local')?.roles).toEqual(['platform-admin']);
  });

  /**
   * The trap `employee-self-service` sets. It is an `isSystem` role granted to every employee with
   * a login, so "keeps a system role" spares the whole workforce and the reset does nothing.
   */
  it('does not spare an account merely for holding a system role', async () => {
    const survivors = await findSurvivors();
    expect(survivors.map((s) => s.username)).not.toContain('br1000001');
    expect(survivors.map((s) => s.username)).not.toContain('applicant-app-2026-000079');
  });
});

describe('a dry run', () => {
  it('counts what would go and deletes none of it', async () => {
    const report = await runReset({ write: false });
    expect(report.mode).toBe('dry-run');
    expect(report.employees).toBe(2);
    expect(report.doomed.map((d) => d.username).sort()).toEqual([
      'applicant-app-2026-000079',
      'br1000001',
    ]);

    // Nothing moved.
    expect(await db().collection('hr_employees').countDocuments({})).toBe(2);
    expect(await db().collection('users').countDocuments({})).toBe(4);
    expect(await db().collection('hr_payslips').countDocuments({})).toBe(1);
    expect(await db().collection('sessions').countDocuments({})).toBe(1);
  }, 240_000);

  it('reports the untouchable collections and what they hold, without touching them', async () => {
    const report = await runReset({ write: false });
    const gold = report.untouched.find((u) => u.collection === 'gold_receiving_receipts');
    expect(gold?.documentsNamingAnEmployee).toBe(1);
    expect(report.untouched.map((u) => u.collection)).toEqual([
      'atm_maintenances',
      'fleet_maintenance_visits',
      'fleet_odometer_logs',
      'fleet_violations',
      'gold_delivery_receipts',
      'gold_receiving_receipts',
      'gold_transfers',
      'hr_job_offers',
    ]);
  }, 240_000);
});

describe('the reset itself', () => {
  it('removes the employees, their records, and every non-administrator account', async () => {
    const report = await runReset({ write: true });
    expect(report.mode).toBe('write');

    expect(await db().collection('hr_employees').countDocuments({})).toBe(0);
    expect(await db().collection('hr_payslips').countDocuments({})).toBe(0);
    expect(await db().collection('hr_leave_requests').countDocuments({})).toBe(0);
    expect(await db().collection('operations_crew_assignments').countDocuments({})).toBe(0);

    const users = await db().collection('users').find({}).toArray();
    expect(users.map((u) => u.username).sort()).toEqual(['admin@ecms.local', 'hr@ecms.local']);

    // The doomed account's session and push endpoint went with it.
    expect(await db().collection('sessions').countDocuments({})).toBe(0);
    expect(await db().collection('push_subscriptions').countDocuments({})).toBe(0);
  }, 240_000);

  /**
   * THE CLAIM THE WHOLE CLASSIFICATION EXISTS FOR. These rows name a deleted employee and are still
   * here, byte for byte — the receipt still says who signed for the metal, the violation still says
   * who was driving. Not deleted, and not "tidied" by clearing the reference either.
   */
  it('leaves the eight untouchable collections exactly as they were', async () => {
    const gold = await db().collection('gold_receiving_receipts').findOne({});
    expect(gold).not.toBeNull();
    expect(String(gold?.teamLeaderEmployeeId)).toBe(String(EMPLOYEE));
    expect(gold?.grams).toBe(5000);

    const violation = await db().collection('fleet_violations').findOne({});
    expect(String(violation?.driverEmployeeId)).toBe(String(EMPLOYEE));
    expect(violation?.fine).toBe(300);

    const offer = await db().collection('hr_job_offers').findOne({});
    expect(String(offer?.hiredEmployeeId)).toBe(String(EMPLOYEE));
    expect(offer?.code).toBe('JO-2026-000001');
  }, 240_000);

  /**
   * History is not rewritten because the actor's account was removed. Scoped to this actor rather
   * than counting the whole collection: the boot records its own entries (the org singleton, the
   * seeded units), and this claim is about the entry whose author has just been deleted.
   */
  it('leaves the audit trail alone, including entries by a deleted account', async () => {
    const entries = await db()
      .collection('audit_logs')
      .find({ userId: STAFF } as never)
      .toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('update');
  });

  /**
   * Every employee is gone, so a surviving administrator's link to one is a false statement about
   * their account — this is the user rule's own collection, so clearing it is its business.
   */
  it('clears the surviving administrator’s link to a now-deleted employee', async () => {
    const admin = await db().collection('users').findOne({ _id: ADMIN } as never);
    expect(admin?.employeeId).toBeNull();
  });

  /** Winding a sequence back reissues a number somebody already holds on paper. */
  it('does not reset the global employee number counter', async () => {
    await db()
      .collection('hr_sequences')
      .updateOne({ _id: 'employee:global' as never }, { $set: { value: 2717 } }, { upsert: true });
    const report = await runReset({ write: true });
    expect(report.employeeSequence).toBe(2717);
    const after = await db().collection('hr_sequences').findOne({ _id: 'employee:global' as never });
    expect(Number(after?.value)).toBe(2717);
  }, 240_000);
});

describe('the refusal that matters most', () => {
  /**
   * With no surviving account the reset would empty the user table and leave nobody able to log in
   * and put anything back. It must refuse in BOTH modes, before deleting anything.
   */
  it('refuses when no account holds a surviving role', async () => {
    await db().collection('role_assignments').deleteMany({});
    await expect(runReset({ write: false })).rejects.toThrow(/no account holds/u);
    await expect(runReset({ write: true })).rejects.toThrow(/super-admin or platform-admin/u);
    // And it refused before touching anything: the administrators are still there.
    expect(await db().collection('users').countDocuments({})).toBe(2);
  }, 240_000);
});
