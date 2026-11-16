// «إخطارات تأمين مفتوحة» and «إخطارات ينقصها مرفق» — `dashboardDigest`, the dashboard's ONE read
// of the open notices (it replaced `summary({status:'open'})` + `missingAnyCount({})`), and the
// vehicle set the notices screen now takes («النوع / التشغيل / الفرع», by the car's CURRENT
// registry facts).
//
// The digest's counts are the two old calls' figures by construction (same `noticeFilter`, same
// `withCodes(ctx)`); its rows are at most six of the notices missing ANY attachment, the oldest
// notice date first, a notice with no date LAST (a database sort would put it first), then the
// oldest recorded, then the id. A notice with no car drops out as soon as a set is asked.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthContext } from '../../../shared/types';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import { type FleetVehicleTypeDoc } from '../vehicle-types/vehicle-type.model';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetDriverProfileRepository } from '../driver-profiles/driver-profile.repository';
import { type FleetVehicleDoc } from '../vehicles/vehicle.model';
import { type FleetDriverProfileDoc } from '../driver-profiles/driver-profile.model';
import { fleetNoticeRepository } from './notice.repository';
import { fleetNoticeService, toNoticeDto } from './notice.service';
import { type FleetNoticeDoc, type FleetNoticeImage } from './notice.model';

const image = (): FleetNoticeImage => ({
  fileId: new Types.ObjectId(),
  fileName: 'scan.jpg',
  mime: 'image/jpeg',
  size: 10,
  uploadedAt: new Date('2026-10-01T00:00:00.000Z'),
});

const B1 = String(new Types.ObjectId());
const B2 = String(new Types.ObjectId());
const ARMOURED = String(new Types.ObjectId());
const VAN = String(new Types.ObjectId());
const MAKES: Record<string, { ar: string; en: string }> = {
  [ARMOURED]: { ar: 'مصفحة', en: 'Armoured' },
  [VAN]: { ar: 'فان', en: 'Van' },
};

/** The registry: car 150 (B1, armoured, licence on file), 151 (B2, van, none), 152 (B1, deleted). */
const CAR_150 = new Types.ObjectId();
const CAR_151 = new Types.ObjectId();
const CAR_152 = new Types.ObjectId();
const CARS: Record<string, { code: string; branchId: string; typeId: string; deleted: boolean }> = {
  [String(CAR_150)]: { code: '150', branchId: B1, typeId: ARMOURED, deleted: false },
  [String(CAR_151)]: { code: '151', branchId: B2, typeId: VAN, deleted: false },
  [String(CAR_152)]: { code: '152', branchId: B1, typeId: ARMOURED, deleted: true },
};
const DRIVER = new Types.ObjectId();

let created = 0;
const notice = (fields: Partial<FleetNoticeDoc>): FleetNoticeDoc => {
  created += 1;
  return {
    _id: new Types.ObjectId(),
    template: 'misrInsurance',
    values: {},
    checks: {},
    vehicleId: CAR_150,
    driverEmployeeId: DRIVER,
    accidentId: null,
    noticeNumber: null,
    noticeDate: new Date('2026-10-15T00:00:00.000Z'),
    noticeImage: null,
    checkImage: image(),
    vehicleLicenseImage: null,
    driverLicenseImage: null,
    completedAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, created)),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    __v: 0,
    ...fields,
  } as FleetNoticeDoc;
};

let docs: FleetNoticeDoc[] = [];
let lastFilter: Record<string, unknown> = {};

const ctx = (permissions: Record<string, string>): AuthContext =>
  ({
    userId: new Types.ObjectId().toString(),
    sessionId: 's',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'ar',
    permissions,
    permissionVersion: 1,
    isPrivileged: false,
  }) as AuthContext;
const FULL = ctx({
  'fleetNotice.view': 'organization',
  'fleetVehicle.view': 'organization',
  'fleetDriver.view': 'organization',
});
const NOTICES_ONLY = ctx({ 'fleetNotice.view': 'organization' });

/** The repository's reading of the filter this spec needs: open only, and the car clause. */
const matches = (doc: FleetNoticeDoc, filter: Record<string, unknown>): boolean => {
  if ('completedAt' in filter && filter['completedAt'] === null && doc.completedAt !== null) {
    return false;
  }
  const car = filter['vehicleId'] as { $in: Types.ObjectId[] } | undefined;
  if (car !== undefined) {
    if (doc.vehicleId === null) return false;
    return car.$in.some((id) => String(id) === String(doc.vehicleId));
  }
  return true;
};

const typeReads = (): number =>
  vi.mocked(fleetVehicleTypeRepository.findByIdsSystem).mock.calls.length;

beforeEach(() => {
  created = 0;
  docs = [];
  vi.spyOn(fleetNoticeRepository, 'findLive').mockImplementation(async (filter) => {
    lastFilter = filter as Record<string, unknown>;
    return docs.filter((doc) => matches(doc, lastFilter));
  });
  vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockImplementation(
    async (ids: readonly string[]) =>
      ids.flatMap((id) => {
        const car = CARS[id];
        return car === undefined
          ? []
          : [
              {
                _id: new Types.ObjectId(id),
                code: car.code,
                typeId: new Types.ObjectId(car.typeId),
                isDeleted: car.deleted,
                licenseImage: car.code === '150' ? image() : null,
              } as unknown as FleetVehicleDoc,
            ];
      }),
  );
  // The set's resolvers, as the registry answers them: deleted cars INCLUDED.
  vi.spyOn(fleetVehicleRepository, 'idsInBranches').mockImplementation(
    async (branchIds: readonly string[]) =>
      Object.entries(CARS)
        .filter(([, car]) => branchIds.includes(car.branchId))
        .map(([id]) => id),
  );
  vi.spyOn(fleetVehicleRepository, 'idsWithTypes').mockImplementation(
    async (typeIds: readonly string[]) =>
      Object.entries(CARS)
        .filter(([, car]) => typeIds.includes(car.typeId))
        .map(([id]) => id),
  );
  vi.spyOn(fleetVehicleRepository, 'idsWithOperations').mockResolvedValue([String(CAR_151)]);
  vi.spyOn(fleetVehicleRepository, 'idsByCodes').mockImplementation(
    async (codes: readonly string[]) =>
      Object.entries(CARS)
        .filter(([, car]) => codes.includes(car.code))
        .map(([id]) => id),
  );
  vi.spyOn(fleetDriverProfileRepository, 'findForEmployeesSystem').mockImplementation(
    async (ids: readonly string[]) =>
      ids.map(
        (id) =>
          ({ employeeId: new Types.ObjectId(id), licenseImage: image() }) as FleetDriverProfileDoc,
      ),
  );
  vi.spyOn(fleetVehicleTypeRepository, 'findByIdsSystem').mockImplementation(
    async (ids: readonly string[]) =>
      ids.map(
        (id) =>
          ({ _id: new Types.ObjectId(id), name: MAKES[id] }) as unknown as FleetVehicleTypeDoc,
      ),
  );
});

afterEach(() => vi.restoreAllMocks());

describe('dashboardDigest — the counts are the screen’s, in one read', () => {
  beforeEach(() => {
    docs = [
      notice({}), // complete
      notice({ checkImage: null }), // the cheque only
      notice({ vehicleId: CAR_151 }), // the car licence only (151 has none on file)
      notice({ vehicleId: CAR_151, vehicleLicenseImage: image() }), // its own copy: complete
      notice({ vehicleId: CAR_151, checkImage: null }), // both: ONE notice
      notice({ checkImage: null, completedAt: new Date('2026-10-20T00:00:00.000Z') }), // done
    ];
  });

  it('open, missingAny and the two parts equal summary({status:open}) and missingAnyCount({})', async () => {
    const digest = await fleetNoticeService.dashboardDigest({}, FULL);
    const summary = await fleetNoticeService.summary({ status: 'open' }, FULL);
    const missingAny = await fleetNoticeService.missingAnyCount({}, FULL);
    expect({
      open: digest.open,
      missingAny: digest.missingAny,
      missingLicences: digest.missingLicences,
      missingCheckImage: digest.missingCheckImage,
    }).toEqual({
      open: summary.open,
      missingAny,
      missingLicences: summary.missingLicences,
      missingCheckImage: summary.missingCheckImage,
    });
    expect(digest).toMatchObject({
      open: 5,
      missingAny: 3,
      missingLicences: 2,
      missingCheckImage: 2,
    });
    // `status` is always open, whatever the query says.
    await fleetNoticeService.dashboardDigest({ status: 'done' }, FULL);
    expect(lastFilter['completedAt']).toBeNull();
  });

  it('reads the notices ONCE (the two full reads it replaced were two)', async () => {
    await fleetNoticeService.dashboardDigest({}, FULL);
    expect(fleetNoticeRepository.findLive).toHaveBeenCalledTimes(1);
  });

  it('R-25: a reader who may not open a registry licence sees it missing, as on the screen', async () => {
    const digest = await fleetNoticeService.dashboardDigest({}, NOTICES_ONLY);
    expect(digest.missingAny).toBe(5);
    expect(digest.missingAny).toBe(await fleetNoticeService.missingAnyCount({}, NOTICES_ONLY));
    expect(digest.rows.every((row) => row.missing.driverLicense)).toBe(true);
  });
});

describe('dashboardDigest — the rows', () => {
  it('missing-any only; the oldest notice date first, no date last, then recorded, then the id', async () => {
    const late = notice({ checkImage: null, noticeDate: new Date('2026-10-20T00:00:00.000Z') });
    const undated = notice({ checkImage: null, noticeDate: null, noticeNumber: '9' });
    const early = notice({
      checkImage: null,
      noticeDate: new Date('2026-10-02T00:00:00.000Z'),
      noticeNumber: ' 77 ',
    });
    const sameDayLater = notice({ vehicleId: CAR_151, noticeDate: early.noticeDate });
    const complete = notice({ noticeDate: new Date('2026-10-01T00:00:00.000Z') });
    // Written in a scrambled order: the order is the rule's, not the store's.
    docs = [undated, late, complete, sameDayLater, early];
    const { rows } = await fleetNoticeService.dashboardDigest({}, FULL);
    expect(rows.map((row) => row.noticeId)).toEqual([
      String(early._id),
      // Same notice date, recorded after it.
      String(sameDayLater._id),
      String(late._id),
      String(undated._id),
    ]);
    // Same date, same recorded instant: the id decides.
    const twinA = notice({ checkImage: null });
    const twinB = notice({ checkImage: null, createdAt: twinA.createdAt });
    docs = [twinB, twinA];
    const twins = await fleetNoticeService.dashboardDigest({}, FULL);
    expect(twins.rows.map((row) => row.noticeId)).toEqual(
      [String(twinA._id), String(twinB._id)].sort(),
    );
  });

  it('each row names its form, car, make, number, day and what is missing', async () => {
    docs = [
      notice({
        template: 'deltaInsurance',
        vehicleId: CAR_151,
        noticeNumber: '42',
        noticeDate: new Date('2026-10-05T00:00:00.000Z'),
        checkImage: null,
      }),
    ];
    const { rows } = await fleetNoticeService.dashboardDigest({}, FULL);
    expect(rows).toEqual([
      {
        noticeId: String(docs[0]?._id),
        template: 'deltaInsurance',
        vehicleId: String(CAR_151),
        code: '151',
        typeName: { ar: 'فان', en: 'Van' },
        noticeNumber: '42',
        noticeDate: '2026-10-05',
        missing: { vehicleLicense: true, driverLicense: false, checkImage: true },
      },
    ]);
  });

  it('a notice with no car is «بلا سيارة»: no code, no make; no type read when no row has a car', async () => {
    docs = [notice({ vehicleId: null, checkImage: null, noticeDate: null })];
    const { rows, missingAny } = await fleetNoticeService.dashboardDigest({}, FULL);
    expect(missingAny).toBe(1);
    expect(rows).toEqual([
      expect.objectContaining({
        vehicleId: null,
        code: null,
        typeName: null,
        noticeNumber: null,
        noticeDate: null,
        missing: { vehicleLicense: true, driverLicense: false, checkImage: true },
      }),
    ]);
    expect(typeReads()).toBe(0);
  });

  it('at most six rows, the count stays the union; ONE read of the makes', async () => {
    docs = Array.from({ length: 9 }, (_, i) =>
      notice({
        checkImage: null,
        vehicleId: i % 2 === 0 ? CAR_150 : CAR_151,
        noticeDate: new Date(Date.UTC(2026, 9, 1 + i)),
      }),
    );
    const digest = await fleetNoticeService.dashboardDigest({}, FULL);
    expect(digest.missingAny).toBe(9);
    expect(digest.rows).toHaveLength(6);
    expect(digest.rows[0]?.noticeDate).toBe('2026-10-01');
    expect(typeReads()).toBe(1);
  });

  it('the internal make id never reaches the notices screen’s DTO', async () => {
    const doc = notice({ checkImage: null });
    vi.spyOn(fleetNoticeRepository, 'getById').mockResolvedValue(doc);
    const withCode = await fleetNoticeService.get(String(doc._id), FULL);
    expect(withCode.vehicleTypeId).toBe(ARMOURED);
    expect(Object.keys(toNoticeDto(withCode))).not.toContain('vehicleTypeId');
  });
});

describe('the vehicle set — by the car’s CURRENT registry facts', () => {
  beforeEach(() => {
    docs = [
      notice({ vehicleId: CAR_150, checkImage: null }), // B1, armoured
      notice({ vehicleId: CAR_151, checkImage: null }), // B2, van
      notice({ vehicleId: CAR_152, checkImage: null }), // B1, deleted since: still its history
      notice({ vehicleId: null, checkImage: null }), // no car
    ];
  });

  it('a branch: its cars’ notices (a deleted car’s included); a notice with no car drops out', async () => {
    const digest = await fleetNoticeService.dashboardDigest({ branchIds: [B1] }, FULL);
    expect(digest.missingAny).toBe(2);
    expect(digest.rows.map((row) => row.code)).toEqual(['150', '152']);
    const company = await fleetNoticeService.dashboardDigest({}, FULL);
    expect(company.missingAny).toBe(4);
    expect(company.rows.some((row) => row.code === null)).toBe(true);
  });

  it('«كل فروعي»: both branches, still no carless notice', async () => {
    const digest = await fleetNoticeService.dashboardDigest({ branchIds: [B1, B2] }, FULL);
    expect(digest.missingAny).toBe(3);
    expect(digest.rows.every((row) => row.code !== null)).toBe(true);
  });

  it('`[]` — a reach with no branch — narrows to nothing', async () => {
    const digest = await fleetNoticeService.dashboardDigest({ branchIds: [] }, FULL);
    expect(digest).toMatchObject({ open: 0, missingAny: 0, rows: [] });
  });

  it('the type and the operation narrow the screen’s summary (and so its list) the same way', async () => {
    const byType = await fleetNoticeService.summary({ typeIds: [VAN] }, FULL);
    expect(byType.total).toBe(1);
    expect(lastFilter['vehicleId']).toEqual({ $in: [CAR_151] });
    const byOperation = await fleetNoticeService.summary(
      { operationIds: [String(new Types.ObjectId())] },
      FULL,
    );
    expect(byOperation.total).toBe(1);
    // Asked together they intersect: a van (151) of the operation, but not in B1.
    const all = await fleetNoticeService.summary(
      { typeIds: [VAN], operationIds: [String(new Types.ObjectId())], branchIds: [B1] },
      FULL,
    );
    expect(all.total).toBe(0);
    expect(lastFilter['vehicleId']).toEqual({ $in: [] });
  });

  it('codes AND a set intersect: a code outside the set narrows to nothing', async () => {
    const both = await fleetNoticeService.summary({ vehicleCodes: ['151'], branchIds: [B1] }, FULL);
    expect(both.total).toBe(0);
    const codesOnly = await fleetNoticeService.summary({ vehicleCodes: ['151'] }, FULL);
    expect(codesOnly.total).toBe(1);
  });
});
