// What the driver card says, and how each of its five facts is said when it is missing.
//
// «اقف على اسم السواق يجيب الاسم كامل والكود ورقم الفون والعربيه اللى متعين عليها والفرع». The
// costly mistake here is a GUESS — a car code the reader's board does not carry, «no car» for a
// reader who simply may not read the roster — so each of those is pinned.
import { describe, expect, it } from 'vitest';
import {
  type FleetPersonDto,
  type FleetRosterDayDto,
  type FleetRosterRowDto,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { driverCardFacts, vehicleOnRoster } from './driver-card';

const DRIVER = '64b1f0dddddddddddddddd01';
const OTHER = '64b1f0dddddddddddddddd02';
const CAIRO = '64b1f0bbbbbbbbbbbbbbbb01';

const person = (over: Partial<FleetPersonDto> = {}): FleetPersonDto => ({
  employeeId: DRIVER,
  code: '0100765',
  fullNameAr: 'ابراهيم السيد رزق جابر',
  status: 'active',
  branchId: CAIRO,
  address: null,
  governorate: null,
  phone: '01001234567',
  hiredAt: null,
  ...over,
});

const row = (over: Partial<FleetRosterRowDto> = {}): FleetRosterRowDto => ({
  vehicleId: 'v219',
  code: '219',
  plateNumber: 'ن ص ع 219',
  typeId: 't1',
  inMaintenance: false,
  planned: false,
  missionTypeId: null,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  notes: null,
  ...over,
});

const day = (over: Partial<FleetRosterDayDto> = {}): FleetRosterDayDto => ({
  date: '2026-10-11',
  rows: [],
  availableDrivers: [],
  unavailableDrivers: [],
  ...over,
});

const BRANCHES: OrgUnitOptionDto[] = [
  {
    id: CAIRO,
    code: 'CAI',
    name: { ar: 'فرع القاهرة', en: 'Cairo branch' },
    parentId: null,
    catalogId: null,
  },
];

const facts = (over: Partial<Parameters<typeof driverCardFacts>[0]> = {}) =>
  driverCardFacts({
    person: person(),
    branches: BRANCHES,
    roster: day({ rows: [row({ driver1EmployeeId: DRIVER })] }),
    locale: 'ar',
    ...over,
  });

describe('the car the driver is on today', () => {
  it('is the row that seats him, in either shift', () => {
    expect(vehicleOnRoster(day({ rows: [row({ driver1EmployeeId: DRIVER })] }), DRIVER)).toEqual({
      kind: 'car',
      code: '219',
    });
    expect(vehicleOnRoster(day({ rows: [row({ driver2EmployeeId: DRIVER })] }), DRIVER)).toEqual({
      kind: 'car',
      code: '219',
    });
  });

  it('is the pool’s car for a free driver the pool places on one', () => {
    const board = day({
      rows: [row(), row({ vehicleId: 'v295', code: '295' })],
      availableDrivers: [{ employeeId: DRIVER, assignedVehicleId: 'v295' }],
    });
    expect(vehicleOnRoster(board, DRIVER)).toEqual({ kind: 'car', code: '295' });
  });

  it('is «another car» — never a code — when that car is outside the reader’s board', () => {
    const board = day({
      rows: [row()],
      availableDrivers: [{ employeeId: DRIVER, assignedVehicleId: 'v-other-branch' }],
    });
    expect(vehicleOnRoster(board, DRIVER)).toEqual({ kind: 'elsewhere' });
  });

  it('is none for a driver nobody seated today', () => {
    const board = day({
      rows: [row({ driver1EmployeeId: OTHER })],
      availableDrivers: [{ employeeId: DRIVER, assignedVehicleId: null }],
    });
    expect(vehicleOnRoster(board, DRIVER)).toEqual({ kind: 'none' });
  });
});

describe('the card’s facts', () => {
  it('names the person whole, with the code, the phone, today’s car and the branch', () => {
    expect(facts()).toEqual({
      employeeId: DRIVER,
      name: 'ابراهيم السيد رزق جابر',
      code: '0100765',
      phone: '01001234567',
      branch: 'فرع القاهرة',
      vehicle: { kind: 'car', code: '219' },
    });
  });

  it('names the branch in the reader’s language', () => {
    expect(facts({ locale: 'en' }).branch).toBe('Cairo branch');
  });

  it('says a phone HR does not have as missing, not as an empty line', () => {
    expect(facts({ person: person({ phone: null }) }).phone).toBeNull();
    expect(facts({ person: person({ phone: '   ' }) }).phone).toBeNull();
  });

  it('has no branch for a person without one, or one the options do not list', () => {
    expect(facts({ person: person({ branchId: null }) }).branch).toBeNull();
    expect(facts({ person: person({ branchId: 'gone' }) }).branch).toBeNull();
    expect(facts({ branches: null }).branch, 'the options could not be read').toBeNull();
    expect(facts({ branches: 'loading' }).branch).toBe('loading');
    expect(
      facts({ branches: 'loading', person: person({ branchId: null }) }).branch,
      'nothing to wait for',
    ).toBeNull();
  });

  it('leaves the car out for a reader who may not read the roster — never «no car»', () => {
    expect(facts({ roster: 'hidden' }).vehicle).toEqual({ kind: 'hidden' });
    expect(facts({ roster: 'loading' }).vehicle).toEqual({ kind: 'loading' });
  });
});
