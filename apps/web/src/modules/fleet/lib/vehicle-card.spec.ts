// What the car card says, and how each fact is said when it is missing.
//
// «عاوز لما اماوس يقف على كود عربيه يجيب بيانات زى اما اقف على اسم السواق» / «تمام وزود اخر عداد».
// The costly mistake is a GUESS — «no driver» for a reader who may not read the roster, a dash for
// a branch that was only closed, a reading on the wrong car — so each of those is pinned.
import { describe, expect, it } from 'vitest';
import { type FleetPersonDto, type FleetRosterDayDto } from '@ecms/contracts';
import {
  findCardVehicle,
  licenceState,
  vehicleCardFacts,
  vehicleCardRefKind,
  vehicleCodeKey,
  type CardVehicle,
} from './vehicle-card';

const CAR = 'v120';
const D1 = '64b1f0dddddddddddddddd01';
const D2 = '64b1f0dddddddddddddddd02';
// 2026-11-09 12:00 Cairo.
const NOW = Date.parse('2026-11-09T10:00:00Z');

const vehicle = (over: Partial<CardVehicle> = {}): CardVehicle => ({
  id: CAR,
  code: '120',
  typeId: 't1',
  plateNumber: 'ن ق ص 4821',
  branchId: 'b-closed',
  operationId: 'op1',
  licenseExpiresAt: '2027-03-15T00:00:00.000Z',
  status: 'active',
  inWorkshop: false,
  ...over,
});

const named = (id: string, ar: string, en = '') => ({ id, name: { ar, en } });
const TYPES = [named('t1', 'مصفحة نقل أموال', 'Armoured van')];
const OPERATIONS = [named('op1', 'نقل أموال', 'Cash transport')];
const BRANCHES = [named('b-closed', 'فرع مغلق', 'Closed branch')];

const person = (employeeId: string, fullNameAr: string): FleetPersonDto => ({
  employeeId,
  code: employeeId.slice(-4),
  fullNameAr,
  status: 'active',
  branchId: null,
  address: null,
  governorate: null,
  phone: null,
  hiredAt: null,
});
const PEOPLE = [person(D1, 'سامر عادل منصور'), person(D2, 'محمود سعيد عبد الحميد')];

const day = (driver1: string | null, driver2: string | null): FleetRosterDayDto => ({
  date: '2026-11-09',
  rows: [
    {
      vehicleId: CAR,
      code: '120',
      plateNumber: 'ن ق ص 4821',
      typeId: 't1',
      inMaintenance: false,
      planned: true,
      missionTypeId: null,
      driver1EmployeeId: driver1,
      driver2EmployeeId: driver2,
      notes: null,
    },
  ],
  availableDrivers: [],
  unavailableDrivers: [],
});

const READINGS = [
  { vehicleId: CAR, latestReading: 154320, latestReadingAt: '2026-11-07' },
  { vehicleId: 'v999', latestReading: 1, latestReadingAt: '2026-01-01' },
];

const facts = (over: Partial<Parameters<typeof vehicleCardFacts>[0]> = {}) =>
  vehicleCardFacts({
    vehicle: vehicle(),
    types: TYPES,
    operations: OPERATIONS,
    branches: BRANCHES,
    roster: day(D1, D2),
    people: PEOPLE,
    readings: READINGS,
    locale: 'ar',
    now: NOW,
    ...over,
  });

describe('the car card’s facts', () => {
  it('names every fact from its shared list', () => {
    expect(facts()).toEqual({
      vehicleId: CAR,
      code: '120',
      type: 'مصفحة نقل أموال',
      plate: 'ن ق ص 4821',
      status: 'active',
      inWorkshop: false,
      branch: 'فرع مغلق',
      operation: 'نقل أموال',
      drivers: { kind: 'names', names: ['سامر عادل منصور', 'محمود سعيد عبد الحميد'] },
      licence: { date: '2027-03-15T00:00:00.000Z', state: 'valid' },
      reading: { kind: 'reading', km: 154320, at: '2026-11-07' },
    });
  });

  it('in the reader’s language, falling back to Arabic', () => {
    expect(facts({ locale: 'en' }).type).toBe('Armoured van');
    expect(facts({ locale: 'en', operations: [named('op1', 'نقل أموال')] }).operation).toBe(
      'نقل أموال',
    );
  });

  it('the CAR’s branch — a branch closed since is still named, never a dash', () => {
    // The list it is named from carries the inactive branches (`useBranchNames`).
    expect(facts().branch).toBe('فرع مغلق');
    expect(facts({ branches: [] }).branch, 'one the list does not carry').toBeNull();
    expect(facts({ vehicle: vehicle({ branchId: null }) }).branch).toBeNull();
  });

  it('a list on its way as `loading`; one that failed, or a fact not on file, as missing', () => {
    const waiting = facts({ types: 'loading', operations: 'loading', branches: 'loading' });
    expect([waiting.type, waiting.operation, waiting.branch]).toEqual([
      'loading',
      'loading',
      'loading',
    ]);
    const failed = facts({ types: null, operations: null, branches: null });
    expect([failed.type, failed.operation, failed.branch]).toEqual([null, null, null]);
    expect(facts({ vehicle: vehicle({ operationId: null }) }).operation).toBeNull();
    expect(facts({ vehicle: vehicle({ plateNumber: '  ' }) }).plate).toBeNull();
  });

  describe('today’s drivers', () => {
    it('the first and the second, in order — one when only one is seated', () => {
      expect(facts({ roster: day(D2, D1) }).drivers).toEqual({
        kind: 'names',
        names: ['محمود سعيد عبد الحميد', 'سامر عادل منصور'],
      });
      expect(facts({ roster: day(null, D2) }).drivers).toEqual({
        kind: 'names',
        names: ['محمود سعيد عبد الحميد'],
      });
    });

    it('nobody seated, or the car not on today’s board: none — drawn as a dash', () => {
      expect(facts({ roster: day(null, null) }).drivers).toEqual({ kind: 'names', names: [] });
      expect(facts({ vehicle: vehicle({ id: 'v214' }) }).drivers).toEqual({
        kind: 'names',
        names: [],
      });
    });

    it('hidden — never «none» — for a reader who may not read the roster or name its drivers', () => {
      expect(facts({ roster: 'hidden' }).drivers).toEqual({ kind: 'hidden' });
      expect(facts({ people: 'hidden' }).drivers).toEqual({ kind: 'hidden' });
    });

    it('loading while either list is on its way', () => {
      expect(facts({ roster: 'loading' }).drivers).toEqual({ kind: 'loading' });
      expect(facts({ people: 'loading' }).drivers).toEqual({ kind: 'loading' });
    });
  });

  describe('the last odometer reading («وزود اخر عداد»)', () => {
    it('the car’s own reading and its day — never another car’s', () => {
      expect(facts().reading).toEqual({ kind: 'reading', km: 154320, at: '2026-11-07' });
      expect(facts({ vehicle: vehicle({ id: 'v214' }) }).reading).toEqual({ kind: 'none' });
    });

    it('none on file: a dash', () => {
      expect(
        facts({ readings: [{ vehicleId: CAR, latestReading: null, latestReadingAt: null }] })
          .reading,
      ).toEqual({ kind: 'none' });
    });

    it('an out-of-service or disposed car with readings shows its reading — never a false «—»', () => {
      // The list covers EVERY car, any status (the alarms covered active cars only, so a car taken
      // out of service after an accident read «—» although its log had readings).
      for (const status of ['outOfService', 'disposed'] as const) {
        expect(facts({ vehicle: vehicle({ status }) }).reading, status).toEqual({
          kind: 'reading',
          km: 154320,
          at: '2026-11-07',
        });
      }
    });

    it('hidden for a reader without the alarms’ permission; loading while it loads', () => {
      expect(facts({ readings: 'hidden' }).reading).toEqual({ kind: 'hidden' });
      expect(facts({ readings: 'loading' }).reading).toEqual({ kind: 'loading' });
    });
  });

  it('the licence by the vehicles board’s rule: the Cairo day, expired ON its day, soon within 30', () => {
    expect(licenceState('2026-11-09T00:00:00.000Z', NOW)).toBe('expired');
    expect(licenceState('2026-11-25T00:00:00.000Z', NOW)).toBe('soon');
    expect(licenceState('2027-03-15T00:00:00.000Z', NOW)).toBe('valid');
    expect(licenceState(null, NOW)).toBe('unknown');
    expect(facts({ vehicle: vehicle({ licenseExpiresAt: '' }) }).licence).toEqual({
      date: null,
      state: 'unknown',
    });
  });
});

describe('which car a code on a board is', () => {
  const CARS = [
    { id: 'v1', code: 'فورتشنر 2', status: 'disposed' as const },
    { id: 'v2', code: 'فورتشنر 2', status: 'active' as const },
    { id: 'v3', code: 'MG 5', status: 'active' as const },
  ];

  it('a row linked to the registry by its id — `null` (the old books) names none', () => {
    expect(vehicleCardRefKind({ vehicleId: 'v1' })).toBe('id');
    expect(vehicleCardRefKind({ vehicleId: null, code: '120' }), 'the code does not win').toBe(
      null,
    );
    expect(findCardVehicle(CARS, { vehicleId: 'v1' })?.id).toBe('v1');
    expect(findCardVehicle(CARS, { vehicleId: 'v404' }), 'deleted since').toBeUndefined();
  });

  it('a code-only chip by its code, spelled as the registry means it', () => {
    expect(vehicleCardRefKind({ code: ' ' })).toBe(null);
    expect(vehicleCardRefKind({ code: '120' })).toBe('code');
    expect(vehicleCodeKey('  mg   5 ')).toBe(vehicleCodeKey('MG 5'));
    expect(findCardVehicle(CARS, { code: 'mg  5' })?.id).toBe('v3');
    expect(findCardVehicle(CARS, { code: '404' })).toBeUndefined();
  });

  it('the active car when a retired one once wore the same code', () => {
    expect(findCardVehicle(CARS, { code: 'فورتشنر  2 ' })?.id).toBe('v2');
  });
});
