// The violations book, read into its two shapes and turned into rows — on rows, with no database.
import { describe, expect, it } from 'vitest';
import {
  DRIVER_TYPE_ALIASES,
  parseViolations,
  planViolationsImport,
  violationKey,
  type ViolationTypeIndex,
} from './violations-import';
import { fold } from './vehicles-import';
import { type FleetViolationDoc } from '../violations/violation.model';

const company = (over: Record<string, unknown>) => ({
  _id: { $oid: String(over['_id'] ?? '694d465224bc82fd3d28a05d') },
  car_code: '175',
  date_car: { $date: '2025-12-25T00:00:00.000Z' },
  violation_car: 'الانتظار في الممنوع',
  type: 'الانتظار في الممنوع',
  num: '9',
  value_violationCar: '20',
  amount: '180',
  added_by: 'system',
  deleted: 0,
  total_before_grievance: '0',
  done: 1,
  ...over,
});
const driver = (over: Record<string, unknown>) => ({
  _id: { $oid: String(over['_id'] ?? '694d46d324bc82fd3d28a06b') },
  car_code: '175',
  date_driver: { $date: '2025-03-06T00:00:00.000Z' },
  driver: 'احمد جمال عطية',
  amount: '700',
  violation_driver: 'سرعة',
  done: null,
  ...over,
});

describe('reading the export', () => {
  it('tells the two shapes apart by their keys and reads each in its own terms', () => {
    const parsed = parseViolations([company({}), driver({})]);
    expect(parsed.rejected).toEqual([]);
    expect(parsed.company).toEqual([
      { id: '694d465224bc82fd3d28a05d', code: '175', year: 2025, type: 'الانتظار في الممنوع', count: 9, unitValue: 20, collected: true, grievance: 0 },
    ]);
    expect(parsed.driver).toEqual([
      { id: '694d46d324bc82fd3d28a06b', code: '175', date: new Date('2025-03-06T00:00:00.000Z'), type: 'سرعة', amount: 700, driver: 'احمد جمال عطية', collected: false },
    ]);
  });

  it('reads a value with piastres, a blank type, and the grievance figure', () => {
    const [row] = parseViolations([company({ value_violationCar: '117.85', amount: '117.85', num: '1', type: '', total_before_grievance: '5000' })]).company;
    expect(row).toMatchObject({ unitValue: 117.85, count: 1, type: null, grievance: 5000 });
  });

  it('skips a deleted row and REPORTS one it cannot read', () => {
    const parsed = parseViolations([
      company({ deleted: 1 }),
      company({ _id: 'no-car', car_code: '' }),
      company({ _id: 'bad-num', num: 'x' }),
      driver({ _id: 'bad-date', date_driver: null }),
      driver({ _id: 'bad-amount', amount: '' }),
    ]);
    expect(parsed.skippedDeleted).toBe(1);
    expect(parsed.rejected.map((r) => r.id)).toEqual(['no-car', 'bad-num', 'bad-date', 'bad-amount']);
  });
});

/** Ids the planner can turn into ObjectIds — 24 hex characters, numbered for readability. */
const oid = (n: number): string => n.toString(16).padStart(24, '0');
const V175 = oid(175);
const V179 = oid(179);
const T_PARK = oid(1);
const T_FEE = oid(2);
const T_SPEED = oid(3);
const T_PHONE = oid(4);
const T_BELT = oid(5);
const EMP_1 = oid(1001);
const REGISTRY = new Map([['175', V175], ['179', V179]]);
const TYPES: ViolationTypeIndex = {
  byName: new Map([
    [fold('الانتظار في الممنوع'), { id: T_PARK, side: 'company' }],
    [fold('رسوم خدمة'), { id: T_FEE, side: 'company' }],
    [fold('سرعة'), { id: T_SPEED, side: 'driver' }],
    [fold('تليفون'), { id: T_PHONE, side: 'driver' }],
    [fold('حزام'), { id: T_BELT, side: 'driver' }],
  ]),
};

describe('turning the book into rows', () => {
  it('a statement row: the year, the count, the value, the amount derived; a fine: the date, the driver by name', () => {
    const plan = planViolationsImport(
      parseViolations([company({ num: '1', value_violationCar: '117.85', amount: '117.85' }), driver({})]),
      REGISTRY,
      TYPES,
      new Map([['احمد جمال عطية', EMP_1]]),
    );
    expect(plan.vehicles).toHaveLength(1);
    const [statement, fine] = plan.vehicles[0]!.rows.map((r) => r.doc);
    expect(statement).toMatchObject({ kind: 'vehicle', year: 2025, count: 1, unitValue: 117.85, amount: 117.85, collected: true, date: null });
    expect(String(statement!.violationTypeId)).toBe(T_PARK);
    expect(String(statement!.vehicleId)).toBe(V175);
    expect(fine).toMatchObject({ kind: 'driver', amount: 700, collected: false, year: null });
    expect(fine!.date).toEqual(new Date('2025-03-06T00:00:00.000Z'));
    expect(String(fine!.violationTypeId)).toBe(T_SPEED);
    expect(String(fine!.driverEmployeeId)).toBe(EMP_1);
  });

  it('writes the old one-letter shorthand out — «ت» is «تليفون», «ح» is «حزام»', () => {
    expect(DRIVER_TYPE_ALIASES).toEqual({ ت: 'تليفون', ح: 'حزام' });
    const plan = planViolationsImport(parseViolations([driver({ violation_driver: 'ت' }), driver({ _id: 'h', violation_driver: 'ح' })]), REGISTRY, TYPES, new Map());
    expect(plan.unknownTypes).toEqual([]);
    expect(plan.vehicles[0]!.rows).toHaveLength(2);
  });

  it('skips and names: a count of zero, a blank type, a type on the wrong side — and KEEPS a car the registry lacks, by code', () => {
    const plan = planViolationsImport(
      parseViolations([
        company({ num: '0', amount: '0' }),
        company({ _id: 'blank', type: '' }),
        company({ _id: 'wrong', type: 'سرعة' }),
        driver({ _id: 'd-wrong', violation_driver: 'رسوم خدمة' }),
        company({ _id: 'bus', car_code: 'كوستر' }),
      ]),
      REGISTRY,
      TYPES,
      new Map(),
    );
    expect(plan.zeroCount).toEqual(['175 2025']);
    expect(plan.unknownTypes).toEqual(['175 2025: —', '175 2025: سرعة', '175 2025-03-06: رسوم خدمة']);
    expect(plan.unknownCars).toEqual(['كوستر (1)']);
    expect(plan.vehicles.map((v) => [v.code, v.ref, v.rows.length])).toEqual([['كوستر', { vehicleId: null, vehicleCode: 'كوستر' }, 1]]);
    expect(plan.vehicles[0]!.rows[0]!.doc).toMatchObject({ vehicleId: null, vehicleCode: 'كوستر', year: 2025 });
  });

  it('a grievance figure on a car the registry lacks has no vehicle to hang on — listed, not written', () => {
    const plan = planViolationsImport(parseViolations([company({ car_code: 'كوستر', total_before_grievance: '5000' })]), REGISTRY, TYPES, new Map());
    expect(plan.grievances).toEqual([]);
    expect(plan.grievancesUnplaced).toEqual(['كوستر 2025: 5000']);
  });

  it('writes the grievance figure ONCE per (vehicle, year), and reports a year stamped with two', () => {
    const plan = planViolationsImport(
      parseViolations([
        company({ car_code: '179', total_before_grievance: '5000' }),
        company({ _id: 'b', car_code: '179', total_before_grievance: '5000' }),
        company({ _id: 'c', car_code: '175', total_before_grievance: '100' }),
        company({ _id: 'd', car_code: '175', total_before_grievance: '200' }),
      ]),
      REGISTRY,
      TYPES,
      new Map(),
    );
    expect(plan.grievances).toEqual([
      { vehicleId: V179, code: '179', year: 2025, totalBeforeGrievance: 5000 },
      { vehicleId: V175, code: '175', year: 2025, totalBeforeGrievance: 100 },
    ]);
    expect(plan.grievanceConflicts).toEqual(['175 2025: 100 / 200']);
  });

  it('a fine whose driver HR does not know is still a fine — the name kept as text', () => {
    const plan = planViolationsImport(parseViolations([driver({ driver: 'سائق مجهول' })]), REGISTRY, TYPES, new Map());
    expect(plan.vehicles[0]!.rows[0]!.doc).toMatchObject({ driverEmployeeId: null, driverName: 'سائق مجهول' });
  });
});

describe('how a row is told from another', () => {
  it('by its facts, never by `collected` — a person may tick that later', () => {
    const base = { violationTypeId: T_PARK, year: 2025, count: 2, unitValue: 20, date: null, amount: 40, driverEmployeeId: null };
    expect(violationKey({ kind: 'vehicle', ...base } as unknown as FleetViolationDoc)).toBe(`v|2025|${T_PARK}|2|20`);
    const fine = { kind: 'driver', violationTypeId: T_SPEED, year: null, count: null, unitValue: null, date: new Date('2025-03-06T00:00:00.000Z'), amount: 700, driverEmployeeId: null };
    expect(violationKey(fine as unknown as FleetViolationDoc)).toBe(`d|2025-03-06T00:00:00.000Z|${T_SPEED}|700|`);
  });
});
