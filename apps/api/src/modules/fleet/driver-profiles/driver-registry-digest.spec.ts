// The drivers registry's figures on the fleet dashboard (R-08, R-10, T1.3, T3.4–T3.8, T4.5).
//
// Every number `registryDigest` returns is a promise about a link: «منتهية N» is the total of
// `/fleet/drivers?licExpBefore=<today>`, «خلال 30 يومًا» the total with both bounds, «بلا تاريخ» the
// total of `?licExp=none`, and the branch is `?branch=`. So each figure here is checked against the
// REGISTRY LIST itself — `listRoster` with the link's query, over the same roster — not against
// numbers written down beside it.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarDayBounds, licenceWindows, type ListFleetDriversQuery } from '@ecms/contracts';
import type * as DirectoryModule from '../../../platform/directory';
import { type DirectoryEmployee } from '../../../platform/directory';
import { jobTitleRepository } from '../../../platform/organization/job-titles/job-title.repository';
import { fleetDriverProfileRepository } from './driver-profile.repository';
import { type FleetDriverProfileDoc } from './driver-profile.model';

const roster = vi.hoisted(() => ({ employees: [] as DirectoryEmployee[] }));
vi.mock('../../../platform/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof DirectoryModule>()),
  listDirectoryEmployeesByJobTitles: vi.fn(async () => roster.employees),
}));

const { fleetDriverProfileService } = await import('./driver-profile.service');

const TODAY = '2026-11-01';
const W = 30;
const MAADI = new Types.ObjectId().toString();
const GIZA = new Types.ObjectId().toString();
const CASH_SPEC = new Types.ObjectId();
const ATM_SPEC = new Types.ObjectId();
const OTHER_SPEC = new Types.ObjectId();

let seq = 0;
const employee = (branchId: string | null): DirectoryEmployee => {
  seq += 1;
  return {
    employeeId: new Types.ObjectId().toString(),
    code: `E${seq}`,
    fullNameAr: `سائق ${seq}`,
    status: 'active',
    branchId,
    departmentId: null,
    phone: null,
    governorate: null,
    hiredAt: null,
  } as DirectoryEmployee;
};

const profile = (
  of: DirectoryEmployee,
  fields: Partial<FleetDriverProfileDoc> = {},
): FleetDriverProfileDoc =>
  ({
    _id: new Types.ObjectId(),
    employeeId: new Types.ObjectId(of.employeeId),
    licenseNumber: null,
    licenseExpiresAt: null,
    jobId: null,
    specializationId: null,
    licenseTypeId: null,
    specialization: null,
    area: null,
    isActive: true,
    licenseImage: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...fields,
  }) as FleetDriverProfileDoc;

/** The world: who sits in a driving seat, and what Fleet recorded about them. */
let profiles: FleetDriverProfileDoc[] = [];
const at = (iso: string): Date => new Date(iso);

beforeEach(() => {
  const e = Array.from({ length: 14 }, (_, i) => employee(i < 10 ? MAADI : i < 13 ? GIZA : null));
  roster.employees = e;
  profiles = [
    // Expired — ON the expiry day (Q-02), even stamped mid-morning by an import.
    profile(e[0]!, { licenseExpiresAt: at('2026-11-01T10:00:00.000Z') }),
    profile(e[1]!, { licenseExpiresAt: at('2026-10-01T00:00:00.000Z'), isActive: false }),
    // Expiring: the day after today, and the last day of the window.
    profile(e[2]!, { licenseExpiresAt: at('2026-11-02T00:00:00.000Z') }),
    profile(e[3]!, {
      licenseExpiresAt: at('2026-12-01T00:00:00.000Z'),
      specializationId: CASH_SPEC,
    }),
    // Soon (grey): the first and the last day of the window up to today + 60.
    profile(e[4]!, {
      licenseExpiresAt: at('2026-12-02T00:00:00.000Z'),
      specializationId: ATM_SPEC,
    }),
    profile(e[5]!, { licenseExpiresAt: at('2026-12-31T00:00:00.000Z') }),
    // Beyond 60 days: in no bucket.
    profile(e[6]!, {
      licenseExpiresAt: at('2027-01-01T00:00:00.000Z'),
      specialization: 'cashTransport',
    }),
    // No date recorded — «بلا تاريخ» — two of them, one a legacy «both».
    profile(e[7]!, { specialization: 'both' }),
    profile(e[8]!, { specialization: 'atm' }),
    // A catalog specialization wins over a stale legacy value.
    profile(e[9]!, { specializationId: OTHER_SPEC, specialization: 'cashTransport' }),
    // Giza.
    profile(e[10]!, {
      licenseExpiresAt: at('2026-10-31T00:00:00.000Z'),
      specializationId: CASH_SPEC,
    }),
    profile(e[11]!, { licenseExpiresAt: at('2026-11-15T00:00:00.000Z') }),
    // e[12] (Giza) and e[13] (no branch) have NO profile — «غير مسجّلين».
  ];
  vi.spyOn(jobTitleRepository, 'idsRequiringDrivingTestSystem').mockResolvedValue([
    new Types.ObjectId().toString(),
  ] as never);
  vi.spyOn(fleetDriverProfileRepository, 'findForEmployeesSystem').mockImplementation(
    async (ids: readonly string[]) =>
      profiles.filter((doc) => ids.includes(String(doc.employeeId))),
  );
});

afterEach(() => vi.restoreAllMocks());

const digest = (branchId: string | null) =>
  fleetDriverProfileService.registryDigest({
    today: TODAY,
    warnDays: W,
    branchId,
    cashSpecIds: [String(CASH_SPEC)],
    atmSpecIds: [String(ATM_SPEC)],
  });

/** The registry LIST's total for a link's query — what the linked screen prints. */
const listTotal = async (query: Partial<ListFleetDriversQuery>): Promise<number> =>
  (
    await fleetDriverProfileService.listRoster({
      page: 1,
      pageSize: 100,
      ...query,
    } as ListFleetDriversQuery)
  ).meta.totalItems;

const windows = licenceWindows(TODAY, W);
const expiredQuery = {
  licenseExpiresBefore: calendarDayBounds(TODAY, TODAY).before,
};
const between = (from: string, to: string) => {
  const bounds = calendarDayBounds(from, to);
  return { licenseExpiresFrom: bounds.from, licenseExpiresBefore: bounds.before };
};

describe('registryDigest — the whole company', () => {
  it('counts each licence bucket exactly as the list link does', async () => {
    const out = await digest(null);
    expect(out.licence).toEqual({
      expired: 3,
      expiring: 3,
      soon: 2,
      notRecorded: 3,
      unregistered: 2,
    });
    expect(out.licence.expired).toBe(await listTotal(expiredQuery));
    expect(out.licence.expiring).toBe(
      await listTotal(between(windows.expiring.from, windows.expiring.to)),
    );
    expect(out.licence.soon).toBe(await listTotal(between(windows.soon!.from, windows.soon!.to)));
    expect(out.licence.notRecorded).toBe(await listTotal({ licenseNotRecorded: true }));
  });

  it('total is everyone in a driving seat — the unfiltered list', async () => {
    const out = await digest(null);
    expect(out.total).toBe(14);
    expect(out.total).toBe(await listTotal({}));
  });

  it('the buckets are disjoint and every dated licence up to today + 60 is in one', async () => {
    const out = await digest(null);
    const dated = profiles.filter(
      (doc) =>
        doc.licenseExpiresAt !== null && doc.licenseExpiresAt <= at('2026-12-31T23:59:59.999Z'),
    ).length;
    expect(out.licence.expired + out.licence.expiring + out.licence.soon).toBe(dated);
  });

  it('cash and ATM: the catalog ids `?spec=` lists, plus the legacy enum shown apart', async () => {
    const out = await digest(null);
    // cash: e3, e10 by the catalog; e6 (cashTransport) and e7 (both) by the legacy enum only.
    expect(out.cash).toEqual({ drivers: 4, legacy: 2 });
    // atm: e4 by the catalog; e7 (both) and e8 (atm) by the legacy enum only.
    expect(out.atm).toEqual({ drivers: 3, legacy: 2 });
    expect(out.cash.drivers - out.cash.legacy).toBe(
      await listTotal({ specializationId: [String(CASH_SPEC)] }),
    );
    expect(out.atm.drivers - out.atm.legacy).toBe(
      await listTotal({ specializationId: [String(ATM_SPEC)] }),
    );
  });
});

describe('registryDigest — a switcher branch is the HR branch, as `?branch=`', () => {
  it('narrows every figure to the drivers placed there', async () => {
    const out = await digest(GIZA);
    expect(out.total).toBe(3);
    expect(out.total).toBe(await listTotal({ branchId: [GIZA] }));
    expect(out.licence).toEqual({
      expired: 1,
      expiring: 1,
      soon: 0,
      notRecorded: 0,
      unregistered: 1,
    });
    expect(out.licence.expired).toBe(await listTotal({ ...expiredQuery, branchId: [GIZA] }));
    expect(out.cash).toEqual({ drivers: 1, legacy: 0 });
  });

  it('a driver the directory could not place is in no branch', async () => {
    const out = await digest(MAADI);
    expect(out.total).toBe(10);
    expect(out.licence.unregistered).toBe(0);
  });
});

describe('the list filter it shares — `licenseExpiresFrom` and `licenseNotRecorded`', () => {
  it('From is the window’s lower bound; a driver with no date is in no window', async () => {
    expect(
      await listTotal({ licenseExpiresFrom: at('2026-12-02T00:00:00.000Z') }),
      'e4, e5, e6',
    ).toBe(3);
  });

  it('licenseNotRecorded=false asks the opposite — a profile WITH a date', async () => {
    expect(await listTotal({ licenseNotRecorded: false })).toBe(9);
  });

  it('a seat-holder with no profile matches neither — they are «غير مسجّل»', async () => {
    const both =
      (await listTotal({ licenseNotRecorded: true })) +
      (await listTotal({ licenseNotRecorded: false }));
    expect(both).toBe(14 - 2);
  });
});
