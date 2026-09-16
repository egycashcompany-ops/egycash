// The registry is a JOIN, and every rule below is about the half that may be missing.
//
// A driver is on the registry because of their SEAT — their job title requires a driving test — so
// a row exists before anybody records a licence for them. That is the whole point of the change:
// membership used to BE the profile, and since the only endpoint that could create one had no
// caller, the registry showed nothing however many drivers were hired.
//
// What that leaves is a set of decisions about what each filter MEANS for a driver nobody has
// recorded anything about. Each one is easy to answer wrongly in a way nothing would report.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  DRIVER_SORTABLE_COLUMNS,
  matchesFleetFilters,
  matchesRosterBranch,
  sortDriverRows,
  type DriverProfileFacts,
} from './driver-roster';

const profile = (over: Partial<DriverProfileFacts> = {}): DriverProfileFacts => ({
  licenseNumber: 'DL-100',
  licenseExpiresAt: new Date('2027-06-01'),
  specialization: 'cashTransport',
  area: 'المعادي',
  isActive: true,
  licenseImage: null,
  createdAt: new Date('2026-01-01'),
  ...over,
});

describe('what a filter means for a driver with nothing recorded', () => {
  it('an UNFILTERED registry shows them — that is why they are here', () => {
    expect(matchesFleetFilters(null, {})).toBe(true);
  });

  it('but no Fleet filter matches them, because every one asks about the profile', () => {
    // «Licences expiring before March» is not a question about somebody whose licence was never
    // entered. Including them would be a false positive on the screen people use to catch a
    // licence about to lapse — the one job this filter has.
    expect(matchesFleetFilters(null, { licenseExpiresBefore: new Date('2030-01-01') })).toBe(false);
    expect(matchesFleetFilters(null, { specialization: 'cashTransport' })).toBe(false);
    expect(matchesFleetFilters(null, { isActive: true })).toBe(false);
    expect(matchesFleetFilters(null, { search: 'DL' })).toBe(false);
    expect(matchesFleetFilters(null, { area: 'المعادي' })).toBe(false);
    expect(matchesFleetFilters(null, { hasLicenseImage: false })).toBe(false);
  });

  it('and «has no licence scan» does NOT quietly collect them', () => {
    // The trap: "no scan on file" reads as if it should include somebody with no profile at all.
    // It must not — they have no scan because they have no profile, which is a different fact and
    // a different fix. `notRecorded` on the row is what says so.
    expect(matchesFleetFilters(null, { hasLicenseImage: false })).toBe(false);
    expect(matchesFleetFilters(profile({ licenseImage: null }), { hasLicenseImage: false })).toBe(
      true,
    );
  });
});

describe('the Fleet half of the filter bar', () => {
  it('matches the licence number as a substring, case-insensitively', () => {
    expect(matchesFleetFilters(profile(), { search: 'dl-1' })).toBe(true);
    expect(matchesFleetFilters(profile(), { search: 'ZZ' })).toBe(false);
  });

  it('matches the area as a substring', () => {
    expect(matchesFleetFilters(profile(), { area: 'معاد' })).toBe(true);
    expect(matchesFleetFilters(profile({ area: null }), { area: 'معاد' })).toBe(false);
  });

  it('reads «expiring before» as on-or-before, so the boundary day is included', () => {
    const at = new Date('2027-06-01');
    expect(matchesFleetFilters(profile(), { licenseExpiresBefore: at })).toBe(true);
    expect(
      matchesFleetFilters(profile(), { licenseExpiresBefore: new Date('2027-05-31') }),
    ).toBe(false);
  });

  it('ANDs the filters, as a filter bar does', () => {
    expect(
      matchesFleetFilters(profile(), { specialization: 'cashTransport', isActive: true }),
    ).toBe(true);
    expect(
      matchesFleetFilters(profile(), { specialization: 'cashTransport', isActive: false }),
    ).toBe(false);
  });

  it('treats an absent licence image the same as an explicitly null one', () => {
    expect(matchesFleetFilters(profile({ licenseImage: undefined }), { hasLicenseImage: false })).toBe(
      true,
    );
    expect(matchesFleetFilters(profile({ licenseImage: { id: 'f' } }), { hasLicenseImage: true })).toBe(
      true,
    );
  });
});

describe('the registry’s order', () => {
  const row = (employeeId: string, p: DriverProfileFacts | null) => ({ employeeId, profile: p });

  it('sorts a driver with NO profile last, in both directions', () => {
    // Ascending by expiry means "soonest to lapse first". Somebody whose licence was never
    // recorded is not the most urgent — they are a different problem, and putting them at the top
    // would bury the real one.
    const rows = [
      row('b', null),
      row('a', profile({ licenseExpiresAt: new Date('2027-01-01') })),
      row('c', profile({ licenseExpiresAt: new Date('2028-01-01') })),
    ];
    expect(sortDriverRows(rows, 'licenseExpiresAt', 'asc').map((r) => r.employeeId)).toEqual([
      'a',
      'c',
      'b',
    ]);
    expect(sortDriverRows(rows, 'licenseExpiresAt', 'desc').map((r) => r.employeeId)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('is stable and total, so a page boundary cannot drop or repeat a driver', () => {
    // Two drivers whose licences expire on the same day must still have ONE order, or paging
    // through the registry could show the same person twice and never show another.
    const same = new Date('2027-01-01');
    const rows = [
      row('b', profile({ licenseExpiresAt: same })),
      row('a', profile({ licenseExpiresAt: same })),
    ];
    expect(sortDriverRows(rows, 'licenseExpiresAt', 'asc').map((r) => r.employeeId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('orders profile-less drivers among themselves rather than arbitrarily', () => {
    const rows = [row('b', null), row('a', null)];
    expect(sortDriverRows(rows, 'createdAt', 'desc').map((r) => r.employeeId)).toEqual(['a', 'b']);
  });

  it('does not mutate what it was given', () => {
    const rows = [row('b', null), row('a', profile())];
    sortDriverRows(rows, 'createdAt', 'asc');
    expect(rows.map((r) => r.employeeId)).toEqual(['b', 'a']);
  });
});

// ── the HR columns ─────────────────────────────────────────────────────────
//
// «عاوز هنا يكون فيه سهم ... اسم السائق و كود الموظف و المحافظة رقم الموبايل تاريخ التعيين».
//
// These five are HR's facts, and the registry is paged HERE — the roster comes from the org chart
// and the profiles from Fleet, so the join and the page both happen in memory. That is what makes
// ordering by them possible at all, and it is also why each one has to be proved: the browser
// shows these columns from HR's own endpoint, one page at a time, so a column whose value never
// reached this function would sort by nothing at all and look like it had worked.

describe('the registry’s order, on the columns HR owns', () => {
  const hrRow = (
    employeeId: string,
    hr: Partial<{
      fullNameAr: string | null;
      code: string | null;
      governorate: string | null;
      phone: string | null;
      hiredAt: Date | null;
    }> = {},
  ) => ({
    employeeId,
    profile: profile(),
    hr: {
      fullNameAr: null,
      code: null,
      governorate: null,
      phone: null,
      hiredAt: null,
      ...hr,
    },
  });

  const order = (rows: ReturnType<typeof hrRow>[], by: string, dir: 'asc' | 'desc'): string[] =>
    sortDriverRows(rows, undefined, undefined, [{ by, dir }]).map((r) => r.employeeId);

  it('orders the names as WORDS, not as code points', () => {
    // `'أحمد' < 'محمد'` is true of an Arabic alphabet and false of a naive `<`, and this is the
    // column a reader scans down looking for somebody.
    const rows = [
      hrRow('m', { fullNameAr: 'محمد حاتم' }),
      hrRow('a', { fullNameAr: 'أحمد سعيد' }),
      hrRow('s', { fullNameAr: 'سعيد علي' }),
    ];
    expect(order(rows, 'driver', 'asc')).toEqual(['a', 's', 'm']);
    expect(order(rows, 'driver', 'desc')).toEqual(['m', 's', 'a']);
  });

  it('orders by employee code, by governorate and by phone', () => {
    const rows = [
      hrRow('b', { code: '0200010', governorate: 'الجيزة', phone: '0102' }),
      hrRow('a', { code: '0100026', governorate: 'أسيوط', phone: '0101' }),
    ];
    expect(order(rows, 'employeeCode', 'asc')).toEqual(['a', 'b']);
    expect(order(rows, 'governorate', 'asc')).toEqual(['a', 'b']);
    expect(order(rows, 'phone', 'desc')).toEqual(['b', 'a']);
  });

  it('orders by hire date as a DATE — oldest first ascending', () => {
    const rows = [
      hrRow('new', { hiredAt: new Date('2026-01-01') }),
      hrRow('old', { hiredAt: new Date('2019-05-01') }),
    ];
    expect(order(rows, 'hiredAt', 'asc')).toEqual(['old', 'new']);
    expect(order(rows, 'hiredAt', 'desc')).toEqual(['new', 'old']);
  });

  it('sorts a driver HR has no answer for LAST, in both directions', () => {
    // A driver with no phone on file is not the first in the phone book, and not the last either
    // — they are a row with nothing to order by, and it belongs at the end whichever way the
    // arrow points. The same rule a missing licence expiry already follows.
    const rows = [
      hrRow('none', { phone: null }),
      hrRow('a', { phone: '0101' }),
      hrRow('b', { phone: '0102' }),
    ];
    expect(order(rows, 'phone', 'asc')).toEqual(['a', 'b', 'none']);
    expect(order(rows, 'phone', 'desc')).toEqual(['b', 'a', 'none']);
  });

  it('still shows a driver with NO fleet profile when the column is HR’s', () => {
    // The old rule sorted a profile-less driver last whatever the column was. That is right for
    // «انتهاء الترخيص» and wrong for «اسم السائق»: a new hire nobody has recorded a licence for
    // still has a name, and burying every one of them at the bottom of an alphabet would hide
    // exactly the drivers somebody is looking for.
    const rows = [
      { employeeId: 'z', profile: null, hr: { fullNameAr: 'أحمد', code: null, governorate: null, phone: null, hiredAt: null } },
      hrRow('a', { fullNameAr: 'محمد' }),
    ];
    expect(sortDriverRows(rows, undefined, undefined, [{ by: 'driver', dir: 'asc' }]).map((r) => r.employeeId)).toEqual([
      'z',
      'a',
    ]);
  });

  it('lets a SECOND column break the first one’s ties', () => {
    const rows = [
      hrRow('b', { governorate: 'الجيزة', code: '0200' }),
      hrRow('a', { governorate: 'الجيزة', code: '0100' }),
    ];
    expect(
      order(rows, 'governorate', 'asc'),
      'the tie is closed by the employee id, deterministically',
    ).toEqual(['a', 'b']);
    expect(
      sortDriverRows(rows, undefined, undefined, [
        { by: 'governorate', dir: 'asc' },
        { by: 'employeeCode', dir: 'desc' },
      ]).map((r) => r.employeeId),
    ).toEqual(['b', 'a']);
  });

  it('publishes exactly the columns a `?sort=` may name', () => {
    // The whitelist IS the list of arrows the screen is allowed to draw; anything else falls back
    // to `createdAt` rather than answering 400 or leaving the page unsorted.
    expect(DRIVER_SORTABLE_COLUMNS.sort()).toEqual([
      'createdAt',
      'driver',
      'employeeCode',
      'governorate',
      'hiredAt',
      'licenseExpiresAt',
      'phone',
    ]);
    expect(order([hrRow('b'), hrRow('a')], 'nonsense', 'asc'), 'no crash, no 400').toEqual([
      'a',
      'b',
    ]);
  });
});

// ── The three catalog references ────────────────────────────────────────────

const JOB = new Types.ObjectId();
const SPEC = new Types.ObjectId();
const LICENCE = new Types.ObjectId();

describe('«الوظيفة / التخصص / الرخصة» — the catalog references', () => {
  const classified = profile({
    jobId: JOB,
    specializationId: SPEC,
    licenseTypeId: LICENCE,
  });

  it('matches the driver whose profile points at the item asked for', () => {
    expect(matchesFleetFilters(classified, { jobId: [String(JOB)] })).toBe(true);
    expect(matchesFleetFilters(classified, { specializationId: [String(SPEC)] })).toBe(true);
    expect(matchesFleetFilters(classified, { licenseTypeId: [String(LICENCE)] })).toBe(true);
  });

  it('compares an ObjectId to the string the query carries — the shapes really differ', () => {
    // The stored value is a BSON ObjectId and the query parameter is a 24-character string, so a
    // `===` here would match nothing at all while looking perfectly reasonable.
    expect(String(JOB)).not.toBe(JOB);
    expect(matchesFleetFilters(classified, { jobId: [String(JOB)] })).toBe(true);
  });

  it('misses a driver pointed at a DIFFERENT item', () => {
    expect(matchesFleetFilters(classified, { jobId: [String(new Types.ObjectId())] })).toBe(false);
  });

  it('misses a driver nobody has classified — «grade A» is not a question about them', () => {
    // The same rule the whole file is about, one level down: an unclassified driver is not a
    // grade-A driver, and counting them as one would inflate every grade the house filters by.
    const unclassified = profile({ jobId: null, specializationId: null, licenseTypeId: null });
    expect(matchesFleetFilters(unclassified, { jobId: [String(JOB)] })).toBe(false);
    expect(matchesFleetFilters(unclassified, { specializationId: [String(SPEC)] })).toBe(false);
    expect(matchesFleetFilters(unclassified, { licenseTypeId: [String(LICENCE)] })).toBe(false);
  });

  it('misses a profile written before the field existed, where the key is simply ABSENT', () => {
    const legacy = profile();
    expect(legacy.jobId).toBeUndefined();
    expect(matchesFleetFilters(legacy, { jobId: [String(JOB)] })).toBe(false);
  });

  it('shows an unclassified driver on an unfiltered registry, as before', () => {
    expect(matchesFleetFilters(profile({ jobId: null }), {})).toBe(true);
  });

  it('ANDs with the other filters rather than replacing them', () => {
    expect(matchesFleetFilters(classified, { jobId: [String(JOB)], isActive: false })).toBe(false);
    expect(matchesFleetFilters(classified, { jobId: [String(JOB)], area: 'المعادي' })).toBe(true);
  });

  it('takes SEVERAL grades at once, and ORs them — «سائق أ أو سائق ب»', () => {
    // The whole point of the multi-select: one question about the registry, answered once.
    const other = new Types.ObjectId();
    expect(matchesFleetFilters(classified, { jobId: [String(other), String(JOB)] })).toBe(true);
    expect(matchesFleetFilters(classified, { jobId: [String(other)] })).toBe(false);
    expect(
      matchesFleetFilters(classified, {
        specializationId: [String(SPEC), String(other)],
        licenseTypeId: [String(LICENCE)],
      }),
      'each reference ORs inside itself and ANDs with the others',
    ).toBe(true);
  });
});

// ── «الفرع» ────────────────────────────────────────────────────────────────

describe('the branch filter, on the roster row rather than through HR', () => {
  it('asking for NO branch shows everyone, including a driver the directory could not place', () => {
    expect(matchesRosterBranch('b1', undefined)).toBe(true);
    expect(matchesRosterBranch(null, undefined)).toBe(true);
    // An empty list is «nobody asked», not «match nothing» — `listQuery` never produces one, and
    // reading it as a filter would empty the registry for a URL that says nothing.
    expect(matchesRosterBranch('b1', [])).toBe(true);
  });

  it('matches a driver placed in the branch asked for', () => {
    expect(matchesRosterBranch('b1', ['b1'])).toBe(true);
  });

  it('misses a driver placed somewhere else', () => {
    expect(matchesRosterBranch('b2', ['b1'])).toBe(false);
  });

  it('accepts several branches at once, ORed', () => {
    expect(matchesRosterBranch('b2', ['b1', 'b2'])).toBe(true);
    expect(matchesRosterBranch('b3', ['b1', 'b2'])).toBe(false);
  });

  it('misses an UNPLACED driver once a branch is asked for', () => {
    // Same shape as the profile rules above: a driver with no branch on file is not in Maadi, and
    // putting them in Maadi's list would be a false positive on a page somebody counts from.
    expect(matchesRosterBranch(null, ['b1'])).toBe(false);
  });
});

describe('sorting keeps the whole row, not just the two fields it orders by', () => {
  it('hands back the branch the caller put on the row', () => {
    // The registry filters by branch AFTER the join and sorts afterwards; a sort that narrowed the
    // row to its interface would drop the branch on the floor and the filter would silently stop.
    const rows = [
      { employeeId: 'a', branchId: 'b1', profile: profile() },
      { employeeId: 'b', branchId: 'b2', profile: profile() },
    ];
    expect(sortDriverRows(rows, 'createdAt', 'asc').map((r) => r.branchId)).toEqual(['b1', 'b2']);
  });
});
