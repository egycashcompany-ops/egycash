// The device registry and what it changes about a punch (AT-D1 — design v1.3 §17.2, D12.5/D12.7).
//
// WHAT ONLY A DATABASE CAN PROVE HERE. The source guards assert that the import resolves a device
// and that the axis moved off the evidence field. They cannot show that an unregistered device is
// actually refused, that the punch actually lands with the DEVICE's branch, or — the one that
// matters most — that a branch-scoped reader still sees their own employee's punch after the
// evidence field stopped meaning what the scope used to read.
//
// Fixtures are written through the collection, not the models: each row exists to carry the two or
// three fields under test, and a valid employee needs a job title, a salary and an address that no
// code here looks at.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { AttendanceDeviceModel } from '../../src/modules/hr/attendance/devices/attendance-device.model';
import { AttendancePunchModel } from '../../src/modules/hr/attendance/punches/punch.model';
import { punchService } from '../../src/modules/hr/attendance/punches/punch.service';
import { punchRepository } from '../../src/modules/hr/attendance/punches/punch.repository';

let replSet: MongoMemoryReplSet | null = null;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-attendance-devices-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const HQ = new Types.ObjectId();
const MAADI = new Types.ObjectId();
const SYSTEM = { userId: null, roles: [], permissions: [], branchId: null } as never;

let seq = 0;
const next = (): string => String(1000 + (seq += 1));

/** Read by the import: `employeeNumber`, and the branch that becomes the reader's axis. */
const mkEmployee = async (branchId: Types.ObjectId): Promise<string> => {
  const number = next();
  await EmployeeModel.collection.insertOne({
    _id: new Types.ObjectId(),
    employeeNumber: number,
    code: `EG-${number}`,
    status: 'active',
    employment: { branchId },
    isDeleted: false,
    __v: 0,
  });
  return number;
};

const mkDevice = async (code: string, branchId: Types.ObjectId, isActive = true): Promise<void> => {
  await AttendanceDeviceModel.collection.insertOne({
    _id: new Types.ObjectId(),
    code,
    name: code,
    branchId,
    isActive,
    note: null,
    isDeleted: false,
    __v: 0,
  });
};

const importOne = async (employeeNumber: string, deviceId: string, at: Date) =>
  punchService.import(SYSTEM, { rows: [{ employeeNumber, at, direction: 'in', deviceId }] });

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('an unregistered device cannot put a punch in the system', () => {
  it('quarantines the row and names the device', async () => {
    const employee = await mkEmployee(HQ);
    const result = await importOne(employee, 'NOT-REGISTERED', new Date());
    expect(result.imported).toBe(0);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0]?.reason).toContain('NOT-REGISTERED');
  });

  /** A retired device stops accepting rows without losing the history it already produced. */
  it('quarantines a deactivated device', async () => {
    const employee = await mkEmployee(HQ);
    await mkDevice('RETIRED-1', HQ, false);
    const result = await importOne(employee, 'RETIRED-1', new Date());
    expect(result.imported).toBe(0);
    expect(result.quarantined[0]?.reason).toContain('deactivated');
  });

  /** The code is matched case-insensitively — one wall is one device however the row shouts it. */
  it('resolves a device whatever case the row reports', async () => {
    const employee = await mkEmployee(HQ);
    await mkDevice('HQ-GATE-9', HQ);
    const result = await importOne(employee, 'hq-gate-9', new Date());
    expect(result.imported).toBe(1);
  });
});

/**
 * D12.7 — the punch records where it HAPPENED. This is the assertion that gives `crossBranchPunch`
 * its meaning back: before AT-D1 the stamped branch was the employee's own, so the comparison the
 * flag makes was a value against itself and could never differ.
 */
describe('the punch records the device’s branch, and the employee’s separately', () => {
  it('stamps the device branch as evidence and the employee branch as the axis', async () => {
    const employee = await mkEmployee(MAADI);
    await mkDevice('HQ-GATE-1', HQ);
    const at = new Date();
    expect((await importOne(employee, 'HQ-GATE-1', at)).imported).toBe(1);

    const punch = await AttendancePunchModel.findOne({ deviceId: 'HQ-GATE-1', at })
      .lean<{ branchIdAtPunch: Types.ObjectId; employeeBranchId: Types.ObjectId }>()
      .exec();
    expect(String(punch?.branchIdAtPunch), 'evidence = the device').toBe(String(HQ));
    expect(String(punch?.employeeBranchId), 'axis = the employee').toBe(String(MAADI));
  });
});

/**
 * THE REGRESSION THIS PHASE COULD MOST EASILY HAVE SHIPPED.
 *
 * The punch repository used to scope on `branchIdAtPunch`. Once that field became the device's
 * branch, scoping on it would silently have changed who reads what — in both directions, with
 * nothing failing. A Maadi manager must still see their own person's punch made at head office.
 */
/**
 * THE PRE-EXISTING HOLE THIS PHASE FOUND AND CLOSED.
 *
 * `listPunches` declared a branch axis on its class and then called `list` without a selector, so
 * `baseFilter` added no clause and the read returned the whole organization to anybody holding
 * `attendance.view` — a key the attendance migration grants to Employee Self-Service. Nothing in
 * the web called the route, so no screen depended on it; the exposure was simply available.
 */
describe('the punch list is scoped at all', () => {
  it('does not hand one branch’s reader another branch’s punches', async () => {
    const hqEmployee = await mkEmployee(HQ);
    await mkDevice('HQ-GATE-3', HQ);
    await importOne(hqEmployee, 'HQ-GATE-3', new Date());

    const maadiReader = { scope: 'branch', branchId: String(MAADI), userId: null } as never;
    const page = await punchRepository.listPunches({ page: 1, pageSize: 200 } as never, maadiReader);
    const leaked = page.items.some((p) => p.deviceId === 'HQ-GATE-3');
    expect(leaked, 'an HQ punch must not appear for a Maadi-scoped reader').toBe(false);
  });

  it('still shows an organization-scoped reader everything', async () => {
    const orgReader = { scope: 'organization', branchId: null, userId: null } as never;
    const page = await punchRepository.listPunches({ page: 1, pageSize: 200 } as never, orgReader);
    expect(page.items.length).toBeGreaterThan(0);
  });
});

describe('a branch-scoped reader still follows their people, not the walls', () => {
  it('sees their own employee’s punch even when it happened in another branch', async () => {
    const employee = await mkEmployee(MAADI);
    await mkDevice('HQ-GATE-2', HQ);
    const at = new Date();
    await importOne(employee, 'HQ-GATE-2', at);

    const maadiReader = { scope: 'branch', branchId: String(MAADI), userId: null } as never;
    const page = await punchRepository.listPunches(
      { page: 1, pageSize: 50 } as never,
      maadiReader,
    );
    const found = page.items.some((p) => p.deviceId === 'HQ-GATE-2');
    expect(found, 'the Maadi manager sees their person punching at HQ').toBe(true);
  });
});
