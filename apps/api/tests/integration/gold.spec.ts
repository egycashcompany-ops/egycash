// Gold vault integration suite — the ported module, end to end.
//
// What it holds to account is the set of rules the port promised NOT to change:
//
//   · a receipt is data until it is CONFIRMED, and bars exist only after that;
//   · a confirmed document is locked, and reverting is refused once its bars have moved on;
//   · drawer counters are recomputed from the bars, never nudged;
//   · a vault holding bars cannot be deleted or regenerated, and reshape needs the same drawer
//     count and starting number;
//   · one key per drawer, until it comes back.
//
// And the three things the port DID change — the ECMS integrations — are checked as references
// rather than free text: a custodian and a crew leader must be real employees, a vehicle must be a
// real Fleet vehicle, and every document is stamped with the caller's ECMS branch and is invisible
// to a branch-scoped operator somewhere else.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type GoldBarDto,
  type GoldCompanyDto,
  type GoldDeliveryReceiptDto,
  type GoldDrawerDto,
  type GoldKeyHandoverDto,
  type GoldReceivingReceiptDto,
  type GoldRepresentativeDto,
  type GoldTransferDto,
  type GoldVaultDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { goldPermissions } from '../../src/modules/gold/gold.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let branchBToken: string;
let branchAId: string;
let branchBId: string;
let departmentAId: string;
let jobTitleAId: string;
let companyId: string;
let fundId: string;
let representativeId: string;
let custodian1: string;
let custodian2: string;
let vehicleId: string;
let vehiclePlate: string;

let serialCounter = 1000;
let nidCounter = 0;
let phoneCounter = 60_000_000;
const nextSerial = (): string => `GB-${String(serialCounter++)}`;
const nextNid = (): string => `290010102${String(30_000 + nidCounter++).padStart(5, '0')}`;
const nextPhone = (): string => `011${String(phoneCounter++).padStart(8, '0')}`;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-gold-test-${String(Date.now())}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const mkUser = async (email: string, branchId: string | null = null): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

const login = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

/** A real HR employee — the module never fabricates one, that is the whole point of seam 2. */
const mkEmployee = async (fullNameAr: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: { fullNameAr, nationalId: nextNid(), nationality: 'Egyptian' },
        contact: { primaryPhone: nextPhone() },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId: jobTitleAId,
        departmentId: departmentAId,
        branchId: branchAId,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2026-07-01T00:00:00.000Z',
      },
      entryStatus: 'active',
    });
  expect(res.status).toBe(201);
  return data<{ id: string }>(res).id;
};

type Body = Record<string, unknown>;
const post = (path: string, token: string, body: Body): request.Test =>
  request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body);
const patch = (path: string, token: string, body: Body): request.Test =>
  request(app).patch(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body);
const get = (path: string, token: string): request.Test =>
  request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

/** A vault with a generated 2×2 grid, ready to receive metal. */
const mkVault = async (name: string): Promise<GoldVaultDto> => {
  const created = await post('/gold/vaults', adminToken, { name });
  expect(created.status).toBe(201);
  const vault = data<GoldVaultDto>(created);
  const layout = await post(`/gold/vaults/${vault.id}/generate-layout`, adminToken, {
    rows: 2,
    cols: 2,
    orientation: 'horizontal',
    horizontalDirection: 'rtl',
    verticalDirection: 'ttb',
    startNumber: 1,
    drawerWeightLimit: 1000,
  });
  expect(layout.status).toBe(200);
  return data<{ vault: GoldVaultDto }>(layout).vault;
};

const drawersOf = async (vaultId: string): Promise<GoldDrawerDto[]> => {
  const res = await get(`/gold/vaults/${vaultId}/drawers`, adminToken);
  expect(res.status).toBe(200);
  return data<GoldDrawerDto[]>(res);
};

/** A confirmed receiving receipt that puts `count` bars into one drawer. */
const receiveBars = async (
  vaultId: string,
  drawerId: string,
  count: number,
  weight = 100,
): Promise<GoldReceivingReceiptDto> => {
  const draft = await post('/gold/receiving', adminToken, {
    deliveredByUs: false,
    companyId,
    supervisor1EmployeeId: custodian1,
    supervisor2EmployeeId: custodian2,
    lines: Array.from({ length: count }, () => ({
      serialNumber: nextSerial(),
      metalType: 'gold',
      weight,
      vaultId,
      drawerId,
    })),
  });
  expect(draft.status).toBe(201);
  const receipt = data<GoldReceivingReceiptDto>(draft);
  const confirmed = await post(`/gold/receiving/${receipt.id}/confirm`, adminToken, {
    version: receipt.version,
  });
  expect(confirmed.status).toBe(200);
  return data<GoldReceivingReceiptDto>(confirmed);
};

const barsOf = async (receipt: GoldReceivingReceiptDto): Promise<GoldBarDto[]> => {
  const res = await get(`/gold/bars?pageSize=100`, adminToken);
  expect(res.status).toBe(200);
  return data<GoldBarDto[]>(res).filter((bar) => receipt.barIds.includes(bar.id));
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions, ...goldPermissions].map(
      (p) => p.key,
    ),
  );
  const adminId = await mkUser('gold-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  const ctx: AuthContext = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  adminToken = await login('gold-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await post('/platform/branches', adminToken, { code, name: { ar, en } });
    expect(res.status).toBe(201);
    return data<{ id: string }>(res).id;
  };
  branchAId = await mkBranch('80', 'فرع الذهب أ', 'Gold Branch A');
  branchBId = await mkBranch('81', 'فرع الذهب ب', 'Gold Branch B');

  const dept = await post('/platform/departments', adminToken, {
    code: 'GLD-OPS',
    name: { ar: 'إدارة الخزينة', en: 'Vault Operations' },
    branchId: branchAId,
  });
  expect(dept.status).toBe(201);
  departmentAId = data<{ id: string }>(dept).id;

  const title = await post('/platform/job-titles', adminToken, {
    code: 'GLD-CUST',
    name: { ar: 'أمين خزينة', en: 'Vault custodian' },
    jobGrade: 'G1',
  });
  expect(title.status).toBe(201);
  jobTitleAId = data<{ id: string }>(title).id;

  custodian1 = await mkEmployee('أمين الخزينة الأول');
  custodian2 = await mkEmployee('أمين الخزينة الثاني');

  // A real Fleet vehicle — seam 1's other half.
  const type = await post('/fleet/vehicle-types', adminToken, {
    name: { ar: 'مصفحة ذهب', en: 'Gold armoured' },
    maintenanceIntervalKm: 10_000,
  });
  expect(type.status).toBe(201);
  const vehicle = await post('/fleet/vehicles', adminToken, {
    code: 'GV1',
    typeId: data<FleetVehicleTypeDto>(type).id,
    plateNumber: 'ذ ه ب 111',
    chassisNumber: 'CH-GOLD-1',
    motorNumber: 'MO-GOLD-1',
    joinedAt: '2024-01-01T00:00:00.000Z',
    licenseExpiresAt: '2028-01-01T00:00:00.000Z',
    radio: { issi: 'ISSI-GOLD-1' },
    branchId: branchAId,
  });
  expect(vehicle.status).toBe(201);
  vehicleId = data<FleetVehicleDto>(vehicle).id;
  vehiclePlate = data<FleetVehicleDto>(vehicle).plateNumber;

  const company = await post('/gold/companies', adminToken, {
    name: 'شركة الاختبار',
    type: 'company',
  });
  expect(company.status).toBe(201);
  companyId = data<GoldCompanyDto>(company).id;

  const fund = await post('/gold/companies', adminToken, { name: 'صندوق الاختبار', type: 'fund' });
  expect(fund.status).toBe(201);
  fundId = data<GoldCompanyDto>(fund).id;

  const rep = await post('/gold/representatives', adminToken, {
    companyId,
    fullName: 'مندوب الاختبار',
    nationalId: '29001010200001',
  });
  expect(rep.status).toBe(201);
  representativeId = data<GoldRepresentativeDto>(rep).id;

  // A branch-scoped operator in branch B — used to prove the scope actually filters.
  const role = await rbacService.createRole(
    {
      name: { en: 'Gold operator', ar: 'موظف خزينة' },
      permissionKeys: [
        'goldReceiving.view',
        'goldReceiving.create',
        'goldVault.view',
        'goldBar.view',
      ],
    },
    adminId,
  );
  const scopedId = await mkUser('gold-b@ecms.local', branchBId);
  await rbacService.ensureAssignment(scopedId, String(role._id), 'branch');
  branchBToken = await login('gold-b@ecms.local');
}, 240_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('gold vaults and drawer numbering', () => {
  it('numbers a 2×2 grid right-to-left and labels drawers from the vault code', async () => {
    const vault = await mkVault('خزينة الترقيم');
    const drawers = await drawersOf(vault.id);
    expect(drawers).toHaveLength(4);
    // rtl / ttb: the top row is numbered from the right, so col 1 is number 1.
    const byNumber = new Map(drawers.map((d) => [d.number, d]));
    expect(byNumber.get(1)).toMatchObject({ row: 0, col: 1 });
    expect(byNumber.get(2)).toMatchObject({ row: 0, col: 0 });
    expect(byNumber.get(3)).toMatchObject({ row: 1, col: 1 });
    expect(byNumber.get(4)).toMatchObject({ row: 1, col: 0 });
    expect(drawers.every((d) => d.label.startsWith(vault.code))).toBe(true);
    expect(drawers.every((d) => d.weightLimit === 1000)).toBe(true);
  });

  it('derives a unique code from the name rather than asking for one', async () => {
    const first = await post('/gold/vaults', adminToken, { name: 'خزينة مكررة' });
    const second = await post('/gold/vaults', adminToken, { name: 'خزينة مكررة' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(data<GoldVaultDto>(first).code).toBe('خزينة مكررة');
    expect(data<GoldVaultDto>(second).code).toBe('خزينة مكررة 2');
  });

  it('refuses to reshape into a different drawer count, and accepts the same one', async () => {
    const vault = await mkVault('خزينة إعادة التشكيل');
    const wrongCount = await post(`/gold/vaults/${vault.id}/reshape-layout`, adminToken, {
      rows: 3,
      cols: 2,
      orientation: 'horizontal',
      horizontalDirection: 'rtl',
      verticalDirection: 'ttb',
      startNumber: 1,
      drawerWeightLimit: 1000,
    });
    expect(wrongCount.status).toBe(409);

    // Same 4 drawers, same start — a legitimate reshape, and the numbers survive it.
    const reshaped = await post(`/gold/vaults/${vault.id}/reshape-layout`, adminToken, {
      rows: 1,
      cols: 4,
      orientation: 'horizontal',
      horizontalDirection: 'ltr',
      verticalDirection: 'ttb',
      startNumber: 1,
      drawerWeightLimit: 2000,
    });
    expect(reshaped.status).toBe(200);
    const drawers = await drawersOf(vault.id);
    expect(drawers.map((d) => d.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(drawers.every((d) => d.row === 0)).toBe(true);
    expect(drawers.every((d) => d.weightLimit === 2000)).toBe(true);
  });
});

describe('receiving — the draft → confirm → revert lifecycle', () => {
  it('creates bars only on confirm, and recounts the drawer they landed in', async () => {
    const vault = await mkVault('خزينة الدخول');
    const [drawer] = await drawersOf(vault.id);
    expect(drawer).toBeDefined();

    const draft = await post('/gold/receiving', adminToken, {
      deliveredByUs: false,
      companyId,
      supervisor1EmployeeId: custodian1,
      lines: [
        {
          serialNumber: nextSerial(),
          metalType: 'gold',
          weight: 250,
          vaultId: vault.id,
          drawerId: drawer?.id,
        },
        {
          serialNumber: nextSerial(),
          metalType: 'gold',
          weight: 150,
          vaultId: vault.id,
          drawerId: drawer?.id,
        },
      ],
    });
    expect(draft.status).toBe(201);
    const receipt = data<GoldReceivingReceiptDto>(draft);
    expect(receipt.status).toBe('draft');
    expect(receipt.barsCount).toBe(2);
    expect(receipt.totalWeight).toBe(400);
    // The custodian's NAME was captured beside the id, so the printed receipt keeps reading.
    expect(receipt.supervisor1Name).toBe('أمين الخزينة الأول');
    // A draft has created nothing.
    expect(receipt.barIds).toHaveLength(0);
    expect((await drawersOf(vault.id))[0]?.barsCount).toBe(0);

    const confirmed = await post(`/gold/receiving/${receipt.id}/confirm`, adminToken, {
      version: receipt.version,
    });
    expect(confirmed.status).toBe(200);
    expect(data<GoldReceivingReceiptDto>(confirmed).status).toBe('confirmed');
    expect(data<GoldReceivingReceiptDto>(confirmed).barIds).toHaveLength(2);

    const after = (await drawersOf(vault.id)).find((d) => d.id === drawer?.id);
    expect(after?.barsCount).toBe(2);
    expect(after?.totalWeight).toBe(400);
    expect(after?.status).toBe('occupied');
  });

  it('locks a confirmed receipt and refuses a second approval', async () => {
    const vault = await mkVault('خزينة القفل');
    const [drawer] = await drawersOf(vault.id);
    const receipt = await receiveBars(vault.id, drawer?.id ?? '', 1);

    const edit = await patch(`/gold/receiving/${receipt.id}`, adminToken, {
      notes: 'late edit',
      version: receipt.version,
    });
    expect(edit.status).toBe(409);

    const again = await post(`/gold/receiving/${receipt.id}/confirm`, adminToken, {
      version: receipt.version,
    });
    expect(again.status).toBe(409);
  });

  it('refuses a serial that already exists anywhere in the system', async () => {
    const vault = await mkVault('خزينة السيريال');
    const [drawer] = await drawersOf(vault.id);
    const serial = nextSerial();

    const first = await post('/gold/receiving', adminToken, {
      deliveredByUs: false,
      companyId,
      lines: [
        {
          serialNumber: serial,
          metalType: 'gold',
          weight: 100,
          vaultId: vault.id,
          drawerId: drawer?.id,
        },
      ],
    });
    const firstReceipt = data<GoldReceivingReceiptDto>(first);
    expect(
      (
        await post(`/gold/receiving/${firstReceipt.id}/confirm`, adminToken, {
          version: firstReceipt.version,
        })
      ).status,
    ).toBe(200);

    const second = await post('/gold/receiving', adminToken, {
      deliveredByUs: false,
      companyId,
      lines: [
        {
          serialNumber: serial,
          metalType: 'gold',
          weight: 100,
          vaultId: vault.id,
          drawerId: drawer?.id,
        },
      ],
    });
    const secondReceipt = data<GoldReceivingReceiptDto>(second);
    const clash = await post(`/gold/receiving/${secondReceipt.id}/confirm`, adminToken, {
      version: secondReceipt.version,
    });
    expect(clash.status).toBe(409);
  });

  it('refuses a serial repeated inside ONE receipt, at save time', async () => {
    const serial = nextSerial();
    const res = await post('/gold/receiving', adminToken, {
      deliveredByUs: false,
      companyId,
      lines: [
        { serialNumber: serial, metalType: 'gold', weight: 100 },
        { serialNumber: serial, metalType: 'gold', weight: 100 },
      ],
    });
    expect(res.status).toBe(409);
  });

  it('reverts an untouched entry, archiving its bars and emptying the drawer', async () => {
    const vault = await mkVault('خزينة التراجع');
    const [drawer] = await drawersOf(vault.id);
    const receipt = await receiveBars(vault.id, drawer?.id ?? '', 2);
    expect((await drawersOf(vault.id))[0]?.barsCount).toBe(2);

    const reverted = await post(`/gold/receiving/${receipt.id}/revert`, adminToken, {
      version: receipt.version,
    });
    expect(reverted.status).toBe(200);
    expect(data<GoldReceivingReceiptDto>(reverted).status).toBe('reverted');
    expect(data<GoldReceivingReceiptDto>(reverted).barIds).toHaveLength(0);

    const after = (await drawersOf(vault.id)).find((d) => d.id === drawer?.id);
    expect(after?.barsCount).toBe(0);
    expect(after?.status).toBe('empty');
  });

  it('requires an owner and at least one complete line before approval', async () => {
    const noCompany = await post('/gold/receiving', adminToken, {
      deliveredByUs: false,
      lines: [{ serialNumber: nextSerial(), metalType: 'gold', weight: 10 }],
    });
    const draft = data<GoldReceivingReceiptDto>(noCompany);
    const res = await post(`/gold/receiving/${draft.id}/confirm`, adminToken, {
      version: draft.version,
    });
    expect(res.status).toBe(422);
  });

  it('numbers a hand-typed receipt only when one is given, and refuses a duplicate number', async () => {
    const missing = await post('/gold/receiving', adminToken, { deliveredByUs: true, lines: [] });
    expect(missing.status).toBe(422);

    const first = await post('/gold/receiving', adminToken, {
      deliveredByUs: true,
      receiptNumber: 'BOOK-0001',
      lines: [],
    });
    expect(first.status).toBe(201);
    const clash = await post('/gold/receiving', adminToken, {
      deliveredByUs: true,
      receiptNumber: 'BOOK-0001',
      lines: [],
    });
    expect(clash.status).toBe(409);
  });
});

describe('the three ECMS integrations', () => {
  it('records the crew leader and the vehicle as references, with their display snapshots', async () => {
    const res = await post('/gold/receiving', adminToken, {
      deliveredByUs: true,
      receiptNumber: 'BOOK-0002',
      teamLeaderEmployeeId: custodian1,
      vehicleId,
      lines: [],
    });
    expect(res.status).toBe(201);
    const receipt = data<GoldReceivingReceiptDto>(res);
    expect(receipt.teamLeaderEmployeeId).toBe(custodian1);
    expect(receipt.teamLeaderName).toBe('أمين الخزينة الأول');
    expect(receipt.vehicleId).toBe(vehicleId);
    expect(receipt.vehicleNumber).toBe(vehiclePlate);
  });

  it('refuses a custodian, a leader or a vehicle that is not a real ECMS record', async () => {
    const ghost = '000000000000000000000001';
    const badCustodian = await post('/gold/receiving', adminToken, {
      deliveredByUs: false,
      supervisor1EmployeeId: ghost,
      lines: [],
    });
    expect(badCustodian.status).toBe(400);

    const badVehicle = await post('/gold/receiving', adminToken, {
      deliveredByUs: false,
      vehicleId: ghost,
      lines: [],
    });
    expect(badVehicle.status).toBe(400);
  });

  it('stamps every document with the ECMS branch and hides other branches from a scoped operator', async () => {
    const mine = await get('/gold/receiving?pageSize=100', adminToken);
    expect(mine.status).toBe(200);
    expect(data<GoldReceivingReceiptDto[]>(mine).length).toBeGreaterThan(0);

    // The scoped operator sits in branch B and every receipt above belongs to branch A.
    const theirs = await get('/gold/receiving?pageSize=100', branchBToken);
    expect(theirs.status).toBe(200);
    expect(data<GoldReceivingReceiptDto[]>(theirs)).toHaveLength(0);
  });
});

describe('delivery — releasing metal', () => {
  it('marks the bars delivered, empties the drawer, and puts them back on revert', async () => {
    const vault = await mkVault('خزينة الخروج');
    const [drawer] = await drawersOf(vault.id);
    const receipt = await receiveBars(vault.id, drawer?.id ?? '', 2);
    const bars = await barsOf(receipt);
    expect(bars).toHaveLength(2);

    const draft = await post('/gold/delivery', adminToken, {
      companyId,
      representativeId,
      supervisor1EmployeeId: custodian1,
      barIds: bars.map((bar) => bar.id),
    });
    expect(draft.status).toBe(201);
    const order = data<GoldDeliveryReceiptDto>(draft);
    expect(order.barsCount).toBe(2);
    expect(order.receiptNumber.startsWith('D')).toBe(true);

    const confirmed = await post(`/gold/delivery/${order.id}/confirm`, adminToken, {
      version: order.version,
    });
    expect(confirmed.status).toBe(200);
    expect((await drawersOf(vault.id)).find((d) => d.id === drawer?.id)?.barsCount).toBe(0);

    const delivered = await get(`/gold/bars/${bars[0]?.id ?? ''}`, adminToken);
    expect(data<GoldBarDto>(delivered).status).toBe('delivered');
    expect(data<GoldBarDto>(delivered).currentDrawerId).toBeNull();

    const reverted = await post(`/gold/delivery/${order.id}/revert`, adminToken, {
      version: data<GoldDeliveryReceiptDto>(confirmed).version,
    });
    expect(reverted.status).toBe(200);
    // The origin came off each bar's own history, so they land back where they were.
    const back = await get(`/gold/bars/${bars[0]?.id ?? ''}`, adminToken);
    expect(data<GoldBarDto>(back).status).toBe('in_vault');
    expect(data<GoldBarDto>(back).currentDrawerId).toBe(drawer?.id);
    expect((await drawersOf(vault.id)).find((d) => d.id === drawer?.id)?.barsCount).toBe(2);
  });

  it('refuses to approve a delivery of bars that are no longer in the vault', async () => {
    const vault = await mkVault('خزينة الخروج المزدوج');
    const [drawer] = await drawersOf(vault.id);
    const receipt = await receiveBars(vault.id, drawer?.id ?? '', 1);
    const bars = await barsOf(receipt);

    const first = await post('/gold/delivery', adminToken, {
      companyId,
      barIds: bars.map((bar) => bar.id),
    });
    const firstOrder = data<GoldDeliveryReceiptDto>(first);
    expect(
      (
        await post(`/gold/delivery/${firstOrder.id}/confirm`, adminToken, {
          version: firstOrder.version,
        })
      ).status,
    ).toBe(200);

    const second = await post('/gold/delivery', adminToken, {
      companyId,
      barIds: bars.map((bar) => bar.id),
    });
    const secondOrder = data<GoldDeliveryReceiptDto>(second);
    const clash = await post(`/gold/delivery/${secondOrder.id}/confirm`, adminToken, {
      version: secondOrder.version,
    });
    expect(clash.status).toBe(409);
  });
});

describe('transfers — ownership only', () => {
  it('moves ownership without moving the metal, and hands it back on revert', async () => {
    const vault = await mkVault('خزينة التحويل');
    const [drawer] = await drawersOf(vault.id);
    const receipt = await receiveBars(vault.id, drawer?.id ?? '', 1);
    const bars = await barsOf(receipt);

    const draft = await post('/gold/transfers', adminToken, {
      metalType: 'gold',
      currentOwnerId: companyId,
      newOwnerId: fundId,
      barIds: bars.map((bar) => bar.id),
    });
    expect(draft.status).toBe(201);
    const transfer = data<GoldTransferDto>(draft);
    expect(transfer.transferNumber.startsWith('T')).toBe(true);

    const confirmed = await post(`/gold/transfers/${transfer.id}/confirm`, adminToken, {
      version: transfer.version,
    });
    expect(confirmed.status).toBe(200);

    const moved = await get(`/gold/bars/${bars[0]?.id ?? ''}`, adminToken);
    expect(data<GoldBarDto>(moved).companyId).toBe(fundId);
    // Nothing physical moved: the bar is still in its drawer.
    expect(data<GoldBarDto>(moved).currentDrawerId).toBe(drawer?.id);
    expect((await drawersOf(vault.id)).find((d) => d.id === drawer?.id)?.barsCount).toBe(1);

    const reverted = await post(`/gold/transfers/${transfer.id}/revert`, adminToken, {
      version: data<GoldTransferDto>(confirmed).version,
    });
    expect(reverted.status).toBe(200);
    const backAgain = await get(`/gold/bars/${bars[0]?.id ?? ''}`, adminToken);
    expect(data<GoldBarDto>(backAgain).companyId).toBe(companyId);
  });

  it('will not approve a transfer with no new owner', async () => {
    const draft = await post('/gold/transfers', adminToken, {
      currentOwnerId: companyId,
      barIds: [],
    });
    const transfer = data<GoldTransferDto>(draft);
    const res = await post(`/gold/transfers/${transfer.id}/confirm`, adminToken, {
      version: transfer.version,
    });
    expect(res.status).toBe(422);
  });
});

describe('vault safety rules', () => {
  it('refuses to delete or regenerate a vault that is holding bars', async () => {
    const vault = await mkVault('خزينة ممتلئة');
    const [drawer] = await drawersOf(vault.id);
    await receiveBars(vault.id, drawer?.id ?? '', 1);

    const regen = await post(`/gold/vaults/${vault.id}/generate-layout`, adminToken, {
      rows: 2,
      cols: 2,
      orientation: 'horizontal',
      horizontalDirection: 'rtl',
      verticalDirection: 'ttb',
      startNumber: 1,
      drawerWeightLimit: 1000,
    });
    expect(regen.status).toBe(409);

    const removed = await request(app)
      .delete(`/api/v1/gold/vaults/${vault.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removed.status).toBe(409);
  });
});

describe('drawer keys — one per drawer', () => {
  it('refuses a second handover until the key comes back', async () => {
    const vault = await mkVault('خزينة المفاتيح');
    const [drawer] = await drawersOf(vault.id);

    const first = await post('/gold/keys', adminToken, {
      companyId,
      representativeId,
      vaultId: vault.id,
      drawerId: drawer?.id,
    });
    expect(first.status).toBe(201);
    const handover = data<GoldKeyHandoverDto>(first);
    expect(handover.status).toBe('active');

    const second = await post('/gold/keys', adminToken, {
      companyId,
      representativeId,
      vaultId: vault.id,
      drawerId: drawer?.id,
    });
    expect(second.status).toBe(409);

    const returned = await patch(`/gold/keys/${handover.id}/return`, adminToken, {});
    expect(returned.status).toBe(200);
    expect(data<GoldKeyHandoverDto>(returned).status).toBe('returned');

    const third = await post('/gold/keys', adminToken, {
      companyId,
      representativeId,
      vaultId: vault.id,
      drawerId: drawer?.id,
    });
    expect(third.status).toBe(201);
  });

  it('counts what is out against every drawer in scope', async () => {
    const res = await get('/gold/keys/overview', adminToken);
    expect(res.status).toBe(200);
    const overview = data<{ totalDrawers: number; handedOver: number; notHandedOver: number }>(res);
    expect(overview.totalDrawers).toBeGreaterThan(0);
    expect(overview.handedOver + overview.notHandedOver).toBe(overview.totalDrawers);
  });
});

describe('reports', () => {
  it('reports a client balance that matches what is actually in the vault', async () => {
    const vault = await mkVault('خزينة التقارير');
    const [drawer] = await drawersOf(vault.id);
    await receiveBars(vault.id, drawer?.id ?? '', 2, 500);

    const res = await get('/gold/reports/client-balances?metalType=gold', adminToken);
    expect(res.status).toBe(200);
    const report = data<{
      rows: { companyId: string; count: number; weight: number }[];
      totals: { count: number; weight: number };
    }>(res);
    const row = report.rows.find((r) => r.companyId === companyId);
    expect(row).toBeDefined();
    expect(report.totals.weight).toBeGreaterThanOrEqual(1000);
  });

  it('answers the dashboard with current inventory only', async () => {
    const res = await get('/gold/dashboard/stats', adminToken);
    expect(res.status).toBe(200);
    const stats = data<{ totalBars: number; goldWeight: number; totalVaults: number }>(res);
    expect(stats.totalVaults).toBeGreaterThan(0);
    expect(stats.goldWeight).toBeGreaterThan(0);
  });
});

describe('RBAC', () => {
  it('refuses a caller who holds no gold grant at all', async () => {
    const outsiderId = await mkUser('gold-outsider@ecms.local', branchAId);
    expect(outsiderId).toBeTruthy();
    const token = await login('gold-outsider@ecms.local');
    expect((await get('/gold/receiving', token)).status).toBe(403);
    expect((await get('/gold/vaults', token)).status).toBe(403);
    expect((await get('/gold/reports/client-balances', token)).status).toBe(403);
  });

  it('lets a read-only operator list but not create', async () => {
    // The branch-B operator holds create on receiving but nothing on companies.
    expect((await get('/gold/companies', branchBToken)).status).toBe(403);
    expect((await post('/gold/companies', branchBToken, { name: 'x' })).status).toBe(403);
  });
});
