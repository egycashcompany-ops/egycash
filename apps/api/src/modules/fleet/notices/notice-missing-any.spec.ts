// T1.10 — «إخطارات ناقصة مرفقات»: the OPEN notices missing ANY attachment, each counted ONCE.
//
// The notices summary already counts the two parts — `missingLicences` and `missingCheckImage` —
// and a notice missing both is in both, so adding them would count it twice. `missingAnyCount` is
// the union, over the same `noticeFilter` and the same `withCodes(ctx)` the summary uses: a reader
// who may not open a registry licence sees it as missing, exactly as `/fleet/notices` shows it
// to them (R-25). It never counts a completed notice — the alert is about the work still to do.
//
// The notices screen asks the same union as a filter, «ينقصها مرفق» (`missing=any`, D10): the list
// and «الإحصائيات» keep only those notices, so the dashboard line's «فتح» lists what it counts.
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

describe('«ينقصها مرفق» (missing=any) on the notices table and its figures (D10)', () => {
  /** The ids of the notices `missingAny` keeps, as the beforeEach writes them. */
  const missingIds = () => [docs[1], docs[2], docs[4]].map((doc) => String(doc?._id));

  beforeEach(() => {
    // The page's notices read whole — their form values too — by id, as the list reads them.
    vi.spyOn(fleetNoticeRepository, 'findByIdsSystem').mockImplementation(
      async (ids: readonly string[]) =>
        docs.filter((doc) => ids.includes(String(doc._id))).reverse(),
    );
  });

  it('the summary counts only the notices missing an attachment — the dashboard’s union', async () => {
    const summary = await fleetNoticeService.summary({ status: 'open', missing: 'any' }, FULL);
    expect(summary).toMatchObject({ total: 3, open: 3, missingLicences: 2, missingCheckImage: 2 });
    expect(summary.total).toBe(await fleetNoticeService.missingAnyCount({}, FULL));
    // Without the filter, every open notice — the old answer, unchanged.
    expect((await fleetNoticeService.summary({ status: 'open' }, FULL)).total).toBe(5);
  });

  it('the list holds exactly those notices, its total the summary’s', async () => {
    const page = await fleetNoticeService.list(
      { status: 'open', missing: 'any', page: 1, pageSize: 25, sortDir: 'desc' },
      FULL,
    );
    expect(page.meta).toEqual({ page: 1, pageSize: 25, totalItems: 3, totalPages: 1 });
    expect(page.items.map((doc) => String(doc._id)).sort()).toEqual(missingIds().sort());
    // Each row still carries what the table shows: the code and where its licences come from.
    expect(page.items.every((doc) => 'vehicleCode' in doc && 'driverLicense' in doc)).toBe(true);
  });

  it('pages in memory in the order the database would hand them — the arrow, then the id', async () => {
    // Three missing notices on three dates; one with no date sorts first ascending, as Mongo does.
    docs[1] = { ...docs[1], noticeDate: new Date('2026-10-20T00:00:00.000Z') } as FleetNoticeDoc;
    docs[2] = { ...docs[2], noticeDate: null } as FleetNoticeDoc;
    docs[4] = { ...docs[4], noticeDate: new Date('2026-10-05T00:00:00.000Z') } as FleetNoticeDoc;
    const read = async (page: number, sortDir: 'asc' | 'desc') =>
      fleetNoticeService.list(
        { missing: 'any', page, pageSize: 2, sortBy: 'noticeDate', sortDir },
        FULL,
      );
    const asc1 = await read(1, 'asc');
    const asc2 = await read(2, 'asc');
    expect(asc1.meta).toEqual({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
    expect([...asc1.items, ...asc2.items].map((doc) => String(doc._id))).toEqual(
      [docs[2], docs[4], docs[1]].map((doc) => String(doc?._id)),
    );
    const desc = await read(1, 'desc');
    expect(desc.items.map((doc) => String(doc._id))).toEqual(
      [docs[1], docs[4]].map((doc) => String(doc?._id)),
    );
  });

  it('a reader who may not open a registry licence sees it missing in the list too (R-25)', async () => {
    const page = await fleetNoticeService.list(
      { missing: 'any', page: 1, pageSize: 25, sortDir: 'desc' },
      NOTICES_ONLY,
    );
    expect(page.meta.totalItems).toBe(5);
  });

  it('without the filter the list pages in the database, as before', async () => {
    const list = vi.spyOn(fleetNoticeRepository, 'list').mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 },
    });
    await fleetNoticeService.list({ status: 'open', page: 1, pageSize: 25, sortDir: 'desc' }, FULL);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
