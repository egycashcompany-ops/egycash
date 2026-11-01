// T1.10 — «إخطارات ناقصة مرفقات»: the OPEN notices missing ANY attachment, each counted ONCE.
//
// The notices summary already counts the two parts — `missingLicences` and `missingCheckImage` —
// and a notice missing both is in both, so adding them would count it twice. `missingAnyCount` is
// the union, over the same `noticeFilter` and the same `withCodes(ctx)` the summary uses: a reader
// who may not open a registry licence sees it as missing, exactly as `/fleet/notices` shows it
// to them (R-25). It never counts a completed notice — the alert is about the work still to do.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthContext } from '../../../shared/types';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetDriverProfileRepository } from '../driver-profiles/driver-profile.repository';
import { type FleetVehicleDoc } from '../vehicles/vehicle.model';
import { type FleetDriverProfileDoc } from '../driver-profiles/driver-profile.model';
import { fleetNoticeRepository } from './notice.repository';
import { fleetNoticeService } from './notice.service';
import { type FleetNoticeDoc, type FleetNoticeImage } from './notice.model';

const image = (): FleetNoticeImage => ({
  fileId: new Types.ObjectId(),
  fileName: 'scan.jpg',
  mime: 'image/jpeg',
  size: 10,
  uploadedAt: new Date('2026-10-01T00:00:00.000Z'),
});

/** A car whose licence scan is on the registry, and one whose is not. */
const CAR_WITH_SCAN = new Types.ObjectId();
const CAR_WITHOUT = new Types.ObjectId();
/** A driver whose licence scan is on the registry. */
const DRIVER_WITH_SCAN = new Types.ObjectId();
const DRIVER_WITHOUT = new Types.ObjectId();

const notice = (fields: Partial<FleetNoticeDoc>): FleetNoticeDoc =>
  ({
    _id: new Types.ObjectId(),
    template: 'police',
    values: {},
    checks: {},
    vehicleId: CAR_WITH_SCAN,
    driverEmployeeId: DRIVER_WITH_SCAN,
    accidentId: null,
    noticeNumber: null,
    noticeDate: new Date('2026-10-15T00:00:00.000Z'),
    noticeImage: null,
    checkImage: image(),
    vehicleLicenseImage: null,
    driverLicenseImage: null,
    completedAt: null,
    ...fields,
  }) as FleetNoticeDoc;

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

beforeEach(() => {
  docs = [
    // Complete — every attachment on file (the licences through the registry).
    notice({}),
    // Missing the cheque image only.
    notice({ checkImage: null }),
    // Missing the car's licence only — no registry scan and no copy of its own.
    notice({ vehicleId: CAR_WITHOUT }),
    // Its own copy of the car licence makes up for the registry's missing one.
    notice({ vehicleId: CAR_WITHOUT, vehicleLicenseImage: image() }),
    // Missing a licence AND the cheque — ONE notice, counted once.
    notice({ driverEmployeeId: DRIVER_WITHOUT, checkImage: null }),
  ];
  vi.spyOn(fleetNoticeRepository, 'findLive').mockImplementation(async (filter) => {
    lastFilter = filter as Record<string, unknown>;
    // The repository's own reading of `completedAt: null` — open only.
    return docs.filter((doc) =>
      'completedAt' in lastFilter && lastFilter['completedAt'] === null
        ? doc.completedAt === null
        : true,
    );
  });
  vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockImplementation(
    async (ids: readonly string[]) =>
      ids.map(
        (id) =>
          ({
            _id: new Types.ObjectId(id),
            code: id === String(CAR_WITH_SCAN) ? '150' : '151',
            isDeleted: false,
            licenseImage: id === String(CAR_WITH_SCAN) ? image() : null,
          }) as unknown as FleetVehicleDoc,
      ),
  );
  vi.spyOn(fleetDriverProfileRepository, 'findForEmployeesSystem').mockImplementation(
    async (ids: readonly string[]) =>
      ids
        .filter((id) => id === String(DRIVER_WITH_SCAN))
        .map(
          (id) =>
            ({
              employeeId: new Types.ObjectId(id),
              licenseImage: image(),
            }) as FleetDriverProfileDoc,
        ),
  );
});

afterEach(() => vi.restoreAllMocks());

describe('missingAnyCount — the union, counted once per notice', () => {
  it('counts every open notice missing a licence OR the cheque image', async () => {
    expect(await fleetNoticeService.missingAnyCount({}, FULL)).toBe(3);
  });

  it('is never the sum of the summary’s two parts when a notice misses both', async () => {
    const summary = await fleetNoticeService.summary({ status: 'open' }, FULL);
    const any = await fleetNoticeService.missingAnyCount({}, FULL);
    expect(summary.missingLicences).toBe(2);
    expect(summary.missingCheckImage).toBe(2);
    expect(any).toBeLessThan(summary.missingLicences + summary.missingCheckImage);
    expect(any).toBeGreaterThanOrEqual(
      Math.max(summary.missingLicences, summary.missingCheckImage),
    );
  });

  it('counts only OPEN notices, whatever status the query names', async () => {
    docs.push(notice({ checkImage: null, completedAt: new Date('2026-10-20T00:00:00.000Z') }));
    expect(await fleetNoticeService.missingAnyCount({}, FULL)).toBe(3);
    expect(await fleetNoticeService.missingAnyCount({ status: 'done' }, FULL)).toBe(3);
    expect(lastFilter['completedAt']).toBeNull();
  });

  it('keeps the rest of the query — the same noticeFilter the screen sends', async () => {
    await fleetNoticeService.missingAnyCount({ checkImage: 'missing' }, FULL);
    expect(lastFilter['checkImage']).toBeNull();
    expect(lastFilter['completedAt']).toBeNull();
  });

  it('R-25: a reader who may not open a registry licence sees it missing, as on the screen', async () => {
    // Without fleetVehicle.view / fleetDriver.view no registry scan is offered, so every notice
    // that leans on one is missing it — and every notice here leans on the registry for at least
    // its driver's licence, so all five count.
    expect(await fleetNoticeService.missingAnyCount({}, NOTICES_ONLY)).toBe(5);
    const summary = await fleetNoticeService.summary({ status: 'open' }, NOTICES_ONLY);
    expect(summary.missingLicences).toBe(5);
  });
});

describe('the summary it sits beside is unchanged', () => {
  it('still answers its own figures over the same rows', async () => {
    const summary = await fleetNoticeService.summary({}, FULL);
    expect(summary).toMatchObject({
      total: 5,
      done: 0,
      open: 5,
      missingLicences: 2,
      missingCheckImage: 2,
    });
  });
});
