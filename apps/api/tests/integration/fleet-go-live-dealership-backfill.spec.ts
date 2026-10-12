// The dealership backfill, against a real mongo — «دول مظهروش فى شاشه التوكيل»: car 159's visits
// of 27 September and 29–30 September, on «صيانة السيارات» and not on the dealership screen,
// because they left the workshop before the screen went live.
//
//   1. It WAITS for the workshop import and its second export: until both are done it refuses,
//      unclaimed, and opens nothing.
//   2. Every closed visit out on or after 1 September with no row at all gets its rows, by the
//      check-out's own rules: «صيانة + إصلاح» two, «ملاكي» from the car's operation, the bill on
//      «لا يوجد» even where the car has an insurer — each audited under the seeding admin.
//   3. A visit out before 1 September, one still in the workshop, a deleted one, and one that
//      already has rows — a billed one, or only a withdrawn one — get none, and no row that was
//      there is touched.
//   4. A second run opens nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { ListFleetDealershipInvoicesQuerySchema } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { env } from '../../src/infrastructure/config/env';
import { userService } from '../../src/platform/users';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetVehicleTypeModel } from '../../src/modules/fleet/vehicle-types/vehicle-type.model';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import {
  FleetDealershipInvoiceModel,
  type FleetDealershipInvoiceDoc,
} from '../../src/modules/fleet/dealership/dealership.model';
import { fleetDealershipService } from '../../src/modules/fleet/dealership/dealership.service';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import { MAINTENANCE_GO_LIVE_MARK } from '../../src/modules/fleet/go-live/maintenance';
import { MAINTENANCE_SYNC_GO_LIVE_MARK } from '../../src/modules/fleet/go-live/maintenance-sync';
import {
  DEALERSHIP_BACKFILL_GO_LIVE_MARK,
  applyDealershipBackfill,
  runDealershipBackfillGoLive,
} from '../../src/modules/fleet/go-live/dealership-backfill';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const on = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

const base = () => ({
  schemaVersion: 1,
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
  createdBy: null,
  updatedBy: null,
  createdAt: on('2026-09-29'),
  updatedAt: on('2026-09-29'),
  __v: 0,
});

/** A catalog item by its Arabic name — the boot's vocabulary may have it already. */
const catalogItem = async (kind: string, ar: string): Promise<Types.ObjectId> => {
  const found = await FleetCatalogItemModel.findOne({ kind, 'name.ar': ar, isDeleted: false })
    .lean()
    .exec();
  if (found !== null) return found._id as Types.ObjectId;
  const _id = new Types.ObjectId();
  await FleetCatalogItemModel.collection.insertOne({
    _id,
    kind,
    name: { ar, en: ar },
    countsForAlarm: false,
    violationSide: null,
    isActive: true,
    sortOrder: null,
    ...base(),
  });
  return _id;
};

const typeId = new Types.ObjectId();
type Code = '159' | '160' | '161' | '162';
const cars: Record<Code, Types.ObjectId> = {
  '159': new Types.ObjectId(),
  '160': new Types.ObjectId(),
  '161': new Types.ObjectId(),
  '162': new Types.ObjectId(),
};

const ids = {
  /** Car 159, 27 September — «صيانة». */
  sep27: new Types.ObjectId(),
  /** Car 159, in 29 September, out 30 September — «صيانة + إصلاح». */
  sep29: new Types.ObjectId(),
  /** Car 160, out on the first day the rule takes — «كهرباء». */
  sep01: new Types.ObjectId(),
  /** A car the registry never had, from the old book — «صيانة». */
  legacy: new Types.ObjectId(),
  /** Car 160, out 31 August — before the owner's day. */
  aug31: new Types.ObjectId(),
  /** Car 161, still in the workshop. */
  open: new Types.ObjectId(),
  /** Car 160, out 15 September, deleted. */
  deleted: new Types.ObjectId(),
  /** Car 162, checked out on the live screen 3 October, its bill recorded. */
  billed: new Types.ObjectId(),
  /** Car 162, out 20 September, whose only row was withdrawn. */
  withdrawn: new Types.ObjectId(),
};

const billedRow = new Types.ObjectId();
const withdrawnRow = new Types.ObjectId();

const rowsOf = (visitId: Types.ObjectId) =>
  FleetDealershipInvoiceModel.find({ visitId })
    .sort({ workKind: 1 })
    .lean<FleetDealershipInvoiceDoc[]>()
    .exec();
const runRow = () =>
  FleetGoLiveRunModel.findOne({ key: DEALERSHIP_BACKFILL_GO_LIVE_MARK }).lean().exec();

let adminId = '';
let insurer: Types.ObjectId;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  const { user } = await userService.create(
    {
      email: env.SEED_ADMIN_EMAIL,
      firstName: { ar: 'مدير', en: 'Admin' },
      lastName: { ar: 'النظام', en: 'System' },
      locale: 'ar',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminId = String(user._id);

  const service = await catalogItem('workType', 'صيانة');
  const both = await catalogItem('workType', 'صيانة + إصلاح');
  const electrics = await catalogItem('workType', 'كهرباء');
  const workshop = await catalogItem('workshop', 'ورشة التوكيل');
  const privateOp = await catalogItem('operation', 'ملاكي');
  const transport = await catalogItem('operation', 'نقل موظفين');
  insurer = await catalogItem('insuranceCompany', 'مصر للتأمين');

  await FleetVehicleTypeModel.collection.insertOne({
    _id: typeId,
    name: { ar: 'نوع اختبار التوكيل', en: 'Dealership test type' },
    maintenanceIntervalKm: 10000,
    isActive: true,
    sortOrder: null,
    ...base(),
  });
  await FleetVehicleModel.collection.insertMany(
    (Object.entries(cars) as [Code, Types.ObjectId][]).map(([code, _id]) => ({
      _id,
      code,
      typeId,
      plateNumber: `ت و ${code}`,
      chassisNumber: `DB-CH-${code}`,
      motorNumber: `DB-MO-${code}`,
      joinedAt: on('2025-01-01'),
      licenseExpiresAt: on('2027-01-01'),
      branchId: new Types.ObjectId(),
      status: 'active',
      statusReason: null,
      // 159 is «ملاكي» and insured; the rest carry people, uninsured.
      operationId: code === '159' ? privateOp : transport,
      insuranceCompanyId: code === '159' ? insurer : null,
      ...base(),
    })),
  );

  const visit = (
    _id: Types.ObjectId,
    car: Code | null,
    inDay: string,
    outDay: string | null,
    workTypeId: Types.ObjectId,
    deleted = false,
  ) => ({
    _id,
    vehicleId: car === null ? null : cars[car],
    vehicleCode: car === null ? '777' : null,
    inDate: on(inDay),
    outDate: outDay === null ? null : on(outDay),
    workshopId: workshop,
    workTypeId,
    spareParts: [],
    sparePartIds: [],
    odometerAtService: null,
    exitOdometer: null,
    driverInEmployeeId: null,
    driverOutEmployeeId: null,
    driverInName: null,
    driverOutName: null,
    takenInByEmployeeId: null,
    takenOutByEmployeeId: null,
    notes: null,
    ...base(),
    ...(deleted ? { isDeleted: true, deletedAt: on('2026-09-16') } : {}),
  });
  await FleetMaintenanceVisitModel.collection.insertMany([
    visit(ids.sep27, '159', '2026-09-27', '2026-09-27', service),
    visit(ids.sep29, '159', '2026-09-29', '2026-09-30', both),
    visit(ids.sep01, '160', '2026-08-30', '2026-09-01', electrics),
    visit(ids.legacy, null, '2026-09-09', '2026-09-10', service),
    visit(ids.aug31, '160', '2026-08-30', '2026-08-31', service),
    visit(ids.open, '161', '2026-10-05', null, service),
    visit(ids.deleted, '160', '2026-09-14', '2026-09-15', service, true),
    visit(ids.billed, '162', '2026-10-02', '2026-10-03', service),
    visit(ids.withdrawn, '162', '2026-09-19', '2026-09-20', service),
  ]);

  const row = (_id: Types.ObjectId, visitId: Types.ObjectId, outDay: string) => ({
    _id,
    visitId,
    vehicleId: cars['162'],
    vehicleCode: null,
    outDate: on(outDay),
    workKind: 'maintenance',
    workTypeLabel: 'صيانة',
    privateCar: false,
    insuranceCompanyId: null,
    invoiceNumber: null,
    invoiceAmount: null,
    image: null,
    side: null,
    ...base(),
  });
  await FleetDealershipInvoiceModel.collection.insertMany([
    {
      ...row(billedRow, ids.billed, '2026-10-03'),
      invoiceNumber: '7001',
      invoiceAmount: 500,
      side: 'dealership',
    },
    // Withdrawn by a reopen, then the car went out again with nobody checking it out on the screen.
    {
      ...row(withdrawnRow, ids.withdrawn, '2026-09-20'),
      isDeleted: true,
      deletedAt: on('2026-09-21'),
    },
  ]);
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('it waits for the workshop import and its second export', () => {
  it('refuses, unclaimed, while they are not done — writes why, opens nothing', async () => {
    await runDealershipBackfillGoLive();
    const doc = await runRow();
    expect(doc?.status).toBe('running');
    expect(doc?.outcome).toMatchObject({ refused: true, reason: 'maintenance-not-done' });
    expect(await rowsOf(ids.sep27), 'nothing was opened').toEqual([]);

    const now = new Date();
    for (const key of [MAINTENANCE_GO_LIVE_MARK, MAINTENANCE_SYNC_GO_LIVE_MARK]) {
      await FleetGoLiveRunModel.create({
        key,
        status: 'done',
        leaseUntil: now,
        startedAt: now,
        finishedAt: now,
        outcome: {},
      });
    }
  });
});

describe('the visits out since 1 September — «دول مظهروش فى شاشه التوكيل»', () => {
  it('159’s visit of 27 September gets its row: «ملاكي», on «لا يوجد» though the car is insured', async () => {
    await runDealershipBackfillGoLive();

    const rows = await rowsOf(ids.sep27);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vehicleId: cars['159'],
      vehicleCode: null,
      outDate: on('2026-09-27'),
      workKind: 'maintenance',
      workTypeLabel: 'صيانة',
      privateCar: true,
      insuranceCompanyId: null,
      invoiceNumber: null,
      invoiceAmount: null,
      image: null,
      side: null,
      isDeleted: false,
    });
    expect(String(rows[0]?.createdBy), 'opened by the seeding admin').toBe(adminId);
  });

  it('«صيانة + إصلاح» (in 29, out 30 September) gets two — each half its own invoice', async () => {
    const rows = await rowsOf(ids.sep29);
    expect(rows.map((row) => [row.workKind, row.workTypeLabel])).toEqual([
      ['maintenance', 'صيانة'],
      ['repair', 'إصلاح'],
    ]);
    for (const row of rows) {
      expect(row.outDate).toEqual(on('2026-09-30'));
      expect(row.privateCar).toBe(true);
    }
  });

  it('a visit out on 1 September itself gets its row; a car that is not «ملاكي» is not', async () => {
    const rows = await rowsOf(ids.sep01);
    expect(rows.map((row) => [row.workKind, row.workTypeLabel, row.privateCar])).toEqual([
      ['repair', 'إصلاح (كهرباء)', false],
    ]);
  });

  it('a visit the old book kept for a car the registry never had keeps the book’s code', async () => {
    const rows = await rowsOf(ids.legacy);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vehicleId: null, vehicleCode: '777', privateCar: false });
  });

  it('a visit out before 1 September, one still in the workshop and a deleted one get none', async () => {
    expect(await rowsOf(ids.aug31)).toEqual([]);
    expect(await rowsOf(ids.open)).toEqual([]);
    expect(await rowsOf(ids.deleted)).toEqual([]);
  });

  it('a visit that has rows — billed, or only withdrawn — gets none, and its row is untouched', async () => {
    const billed = await rowsOf(ids.billed);
    expect(billed).toHaveLength(1);
    expect(billed[0]).toMatchObject({
      _id: billedRow,
      invoiceNumber: '7001',
      invoiceAmount: 500,
      isDeleted: false,
      __v: 0,
      updatedAt: on('2026-09-29'),
    });
    const withdrawn = await rowsOf(ids.withdrawn);
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]).toMatchObject({
      _id: withdrawnRow,
      isDeleted: true,
      __v: 0,
      updatedAt: on('2026-09-29'),
    });
  });

  it('the new rows are on the dealership screen; the withdrawn one still is not', async () => {
    const page = await fleetDealershipService.list(
      ListFleetDealershipInvoicesQuerySchema.parse({ pageSize: 100 }),
    );
    const visits = page.items.map((row) => String(row.visitId)).sort();
    expect(visits).toEqual(
      [ids.sep27, ids.sep29, ids.sep29, ids.sep01, ids.legacy, ids.billed].map(String).sort(),
    );
  });

  it('every row opened is audited as a check-out’s is, under the seeding admin', async () => {
    const opened = await FleetDealershipInvoiceModel.find({
      visitId: { $in: [ids.sep27, ids.sep29, ids.sep01, ids.legacy] },
    })
      .lean<FleetDealershipInvoiceDoc[]>()
      .exec();
    expect(opened).toHaveLength(5);
    const audits = await AuditLogModel.find({ 'entityRef.entityType': 'dealershipInvoice' })
      .lean()
      .exec();
    expect(audits).toHaveLength(5);
    for (const row of opened) {
      const audit = audits.find((entry) => entry.entityRef.entityId === String(row._id));
      expect(audit?.action).toBe('create');
      expect(String(audit?.actor.userId)).toBe(adminId);
      expect(audit?.changes).toEqual([
        { field: 'visitId', old: null, new: String(row.visitId) },
        { field: 'source', old: null, new: DEALERSHIP_BACKFILL_GO_LIVE_MARK },
      ]);
    }
  });

  it('the run is done, and its row says what it saw, opened and passed over', async () => {
    const doc = await runRow();
    expect(doc?.status).toBe('done');
    expect(doc?.outcome).toEqual({
      from: '2026-09-01',
      // Out on or after 1 September: 27th, 29th–30th, 1st, the old book's, the deleted, the billed
      // and the withdrawn.
      visitsSeen: 7,
      opened: 4,
      rowsCreated: 5,
      skipped: 3,
      skippedDeleted: 1,
      skippedHadRows: 2,
      skippedStillIn: 0,
      skippedBefore: 0,
      openedVisits: [
        '160 2026-09-01: إصلاح (كهرباء)',
        '777 2026-09-10: صيانة',
        '159 2026-09-27: صيانة',
        '159 2026-09-30: صيانة · إصلاح',
      ],
    });
  });

  it('happens once — a second pass opens nothing and changes nothing', async () => {
    const before = await FleetDealershipInvoiceModel.find({})
      .sort({ _id: 1 })
      .lean<FleetDealershipInvoiceDoc[]>()
      .exec();
    await runDealershipBackfillGoLive();
    const again = await applyDealershipBackfill(adminId);
    expect(again.failures).toEqual([]);
    expect(again.outcome).toMatchObject({
      visitsSeen: 7,
      opened: 0,
      rowsCreated: 0,
      skipped: 7,
      skippedDeleted: 1,
      skippedHadRows: 6,
      openedVisits: [],
    });
    const after = await FleetDealershipInvoiceModel.find({})
      .sort({ _id: 1 })
      .lean<FleetDealershipInvoiceDoc[]>()
      .exec();
    expect(after).toEqual(before);
    expect(
      await AuditLogModel.countDocuments({ 'entityRef.entityType': 'dealershipInvoice' }).exec(),
    ).toBe(5);
    expect((await runRow())?.outcome).toMatchObject({ opened: 4, rowsCreated: 5 });
  });
});
