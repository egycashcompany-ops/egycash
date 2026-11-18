// The drivers registry's figures on the fleet dashboard (R-08, R-10, T1.3, T3.4–T3.8, T4.5).
//
// Every number `registryDigest` returns is a promise about a link: «منتهية N» is the total of
// `/fleet/drivers?licExpBefore=<today>`, «خلال 30 يومًا» the total with both bounds, «بلا تاريخ» the
// total of `?licExp=none`, and the branch is `?branch=`. So each figure here is checked against the
// REGISTRY LIST itself — `listRoster` with the link's query, over the same roster — not against
// numbers written down beside it. «التراخيص والتجديدات» adds two more promises of the same kind:
// each month's column is the total of `?licExpFrom=<its first day>&licExpBefore=<its last day>`, and
// «أقرب رخص السائقين» lists the very files `?licExpBefore=<today + 60>` keeps (suspended included),
// nearest first.
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
const FIRST_GRADE = new Types.ObjectId();
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
    profile(e[0]!, {
      licenseExpiresAt: at('2026-11-01T10:00:00.000Z'),
      licenseTypeId: FIRST_GRADE,
    }),
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

const digest = (branchIds: readonly string[] | null) =>
  fleetDriverProfileService.registryDigest({
    today: TODAY,
    warnDays: W,
    branchIds,
    cashSpecIds: [String(CASH_SPEC)],
    atmSpecIds: [String(ATM_SPEC)],
    nearestLimit: 6,
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
    expect(out.licence).toMatchObject({
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

  it('cash and ATM: `drivers` is the catalog alone — the list `?spec=` opens (D13)', async () => {
    const out = await digest(null);
    // cash: e3, e10 by the catalog — the figure; e6 (cashTransport) and e7 (both) are `legacy`.
    expect(out.cash).toEqual({ drivers: 2, legacy: 2 });
    // atm: e4 by the catalog — the figure; e7 (both) and e8 (atm) are `legacy`.
    expect(out.atm).toEqual({ drivers: 1, legacy: 2 });
    expect(out.cash.drivers).toBe(await listTotal({ specializationId: [String(CASH_SPEC)] }));
    expect(out.atm.drivers).toBe(await listTotal({ specializationId: [String(ATM_SPEC)] }));
  });

  it('the old enum is a figure APART: never added in, and a `both` profile on neither card (D13)', async () => {
    const out = await digest(null);
    const both = roster.employees[7]!.employeeId;
    // e7 is the legacy «both»: the list by either catalog id never names him…
    const listed = async (spec: Types.ObjectId) =>
      (
        await fleetDriverProfileService.listRoster({
          page: 1,
          pageSize: 100,
          specializationId: [String(spec)],
        } as ListFleetDriversQuery)
      ).items.map((row) => row.employeeId);
    expect(await listed(CASH_SPEC)).not.toContain(both);
    expect(await listed(ATM_SPEC)).not.toContain(both);
    // …and the two cards' figures together are the catalog's drivers only — he is in neither.
    expect(out.cash.drivers + out.atm.drivers).toBe(3);
    // A catalog specialization wins over a stale legacy value: e9 is no legacy driver.
    expect(out.cash.legacy).toBe(2);
  });
});

describe('registryDigest — the reader’s branches are HR branches, as `?branch=a,b`', () => {
  it('narrows every figure to the drivers placed there', async () => {
    const out = await digest([GIZA]);
    expect(out.total).toBe(3);
    expect(out.total).toBe(await listTotal({ branchId: [GIZA] }));
    expect(out.licence).toMatchObject({
      expired: 1,
      expiring: 1,
      soon: 0,
      notRecorded: 0,
      unregistered: 1,
    });
    expect(out.licence.expired).toBe(await listTotal({ ...expiredQuery, branchId: [GIZA] }));
    expect(out.cash).toEqual({ drivers: 1, legacy: 0 });
    expect(out.cash.drivers).toBe(
      await listTotal({ specializationId: [String(CASH_SPEC)], branchId: [GIZA] }),
    );
  });

  it('a driver the directory could not place is in no branch', async () => {
    const out = await digest([MAADI]);
    expect(out.total).toBe(10);
    expect(out.licence.unregistered).toBe(0);
  });

  it('«كل فروعي» — several branches are the drivers of any of them, as the list’s own `?branch=`', async () => {
    const out = await digest([MAADI, GIZA]);
    expect(out.total).toBe(13);
    expect(out.total).toBe(await listTotal({ branchId: [MAADI, GIZA] }));
    expect(out.licence.expired).toBe(await listTotal({ ...expiredQuery, branchId: [MAADI, GIZA] }));
    // The unplaced driver (no branch on file) is in neither.
    expect(out.total).toBe((await digest(null)).total - 1);
  });

  it('a reader with no branch to cover (`[]`) gets nobody — never the whole registry', async () => {
    const out = await digest([]);
    expect(out.total).toBe(0);
    expect(out.licence).toMatchObject({
      expired: 0,
      expiring: 0,
      soon: 0,
      notRecorded: 0,
      unregistered: 0,
      nearest: { rows: [], total: 0 },
    });
    expect(out.licence.months.every((month) => month.count === 0)).toBe(true);
    expect(out.cash).toEqual({ drivers: 0, legacy: 0 });
  });
});

describe('registryDigest — «التراخيص المستحقة للتجديد» and «أقرب رخص السائقين»', () => {
  it('12 month keys from today’s month, zeros kept, each the total of its month’s link', async () => {
    const out = await digest(null);
    expect(out.licence.months.map((month) => month.key)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
      '2027-07',
      '2027-08',
      '2027-09',
      '2027-10',
    ]);
    // November: e0 (stamped mid-morning on the 1st), e2, e11; December: e3, e4, e5; January: e6.
    expect(out.licence.months.slice(0, 4).map((month) => month.count)).toEqual([3, 3, 1, 0]);
    for (const month of out.licence.months) {
      const year = Number(month.key.slice(0, 4));
      const last = new Date(Date.UTC(year, Number(month.key.slice(5, 7)), 0)).getUTCDate();
      expect(month.count, month.key).toBe(
        await listTotal(
          between(`${month.key}-01`, `${month.key}-${String(last).padStart(2, '0')}`),
        ),
      );
    }
  });

  it('a month key rolls over the year: December’s twelve run to November', async () => {
    const out = await fleetDriverProfileService.registryDigest({
      today: '2026-12-31',
      warnDays: W,
      branchIds: null,
      cashSpecIds: [],
      atmSpecIds: [],
      nearestLimit: 0,
    });
    expect(out.licence.months[0]?.key).toBe('2026-12');
    expect(out.licence.months.at(-1)?.key).toBe('2027-11');
    expect(out.licence.nearest.rows).toEqual([]);
  });

  it('lists the files up to today + 60, the longest-expired first — the suspended one flagged', async () => {
    const out = await digest(null);
    const { nearest } = out.licence;
    expect(nearest.rows.map((row) => row.employeeId)).toEqual(
      [1, 10, 0, 2, 11, 3].map((i) => roster.employees[i]!.employeeId),
    );
    expect(nearest.rows[0]).toEqual({
      profileId: String(profiles[1]!._id),
      employeeId: roster.employees[1]!.employeeId,
      expiresAt: '2026-10-01',
      licenceTypeId: null,
      active: false,
    });
    expect(nearest.rows[2]).toMatchObject({
      expiresAt: '2026-11-01',
      licenceTypeId: String(FIRST_GRADE),
      active: true,
    });
  });

  it('total = the link’s total = expired + expiring + soon (suspended included)', async () => {
    for (const branchIds of [null, [GIZA], [MAADI, GIZA]]) {
      const out = await digest(branchIds);
      const { licence } = out;
      expect(licence.nearest.total).toBe(licence.expired + licence.expiring + licence.soon);
      expect(licence.nearest.total).toBe(
        await listTotal({
          licenseExpiresBefore: calendarDayBounds('2026-12-31', '2026-12-31').before,
          ...(branchIds === null ? {} : { branchId: [...branchIds] }),
        }),
      );
      expect(licence.nearest.rows.length).toBe(Math.min(6, licence.nearest.total));
    }
    expect((await digest([GIZA])).licence.nearest.rows.map((row) => row.employeeId)).toEqual([
      roster.employees[10]!.employeeId,
      roster.employees[11]!.employeeId,
    ]);
  });

  it('a seat-holder with no profile, or no date on file, is never one of the rows', async () => {
    const out = await digest(null);
    const listed = new Set(out.licence.nearest.rows.map((row) => row.employeeId));
    for (const i of [7, 8, 9, 12, 13]) {
      expect(listed.has(roster.employees[i]!.employeeId)).toBe(false);
    }
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
