// The parser, read without a database.
//
// Everything here is about what the legacy export actually contains — four deleted rows sharing
// one code, eleven licence classes with a trailing space, two plates padded, a photo path that
// has to become a file name — because those are the things that would land silently.
import { describe, expect, it } from 'vitest';
import { parseCars } from './fleet-vehicles-import';

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  car_code: '150',
  car_type: 'مرسيدس اسبرانتر 515',
  plate_num: 'ف ع 8344',
  chassis_num: '250541',
  motor_num: '301866',
  joining_date: { $date: '2020-10-12T00:00:00.000Z' },
  expiry_date: { $date: '2026-09-04T00:00:00.000Z' },
  licens: 'برقاش م',
  branch: 'المهندسين',
  department: 'ATM',
  insurance_company: 'مصر للتأمين',
  deleted: 0,
  ...over,
});

describe('reading the legacy cars export', () => {
  it('drops the rows the export marks deleted, and counts them', () => {
    // All four carry code «3333» with plates like «255555555555555» — somebody's tests. Left in,
    // the registry's unique index on `code` would reject three of them MID-RUN, after real cars
    // had already been written.
    const result = parseCars([
      row(),
      row({ car_code: '3333', deleted: 1 }),
      row({ car_code: '3333', deleted: 1 }),
    ]);
    expect(result.cars).toHaveLength(1);
    expect(result.skippedDeleted).toBe(2);
    expect(result.rejected, 'and they are not reported as problems').toEqual([]);
  });

  it('trims every value, because the catalogs match names EXACTLY', () => {
    // Eleven rows arrived with «برقاش ت » — a trailing space. Untrimmed, that is a second licence
    // class beside «برقاش ت»: two rows that look identical in the dropdown, and two halves of
    // every filter that uses one. Two plates and one code arrived padded too.
    const [car] = parseCars([
      row({ car_code: 'فورتشنر 2 ', licens: 'برقاش ت ', plate_num: ' ج ى 3243' }),
    ]).cars;
    expect(car?.code).toBe('فورتشنر 2');
    expect(car?.licenseClass).toBe('برقاش ت');
    expect(car?.plateNumber).toBe('ج ى 3243');
  });

  it('turns an absent optional into null, never into an empty string', () => {
    // 37 cars have no radio, and `''` is not «no ISSI» — it is a stored answer that is wrong.
    const [car] = parseCars([row({ issi: '', sn_motorola: '   ', insurance_company: '' })]).cars;
    expect(car?.issi).toBeNull();
    expect(car?.motorolaSn).toBeNull();
    expect(car?.insurer).toBeNull();
  });

  it('takes only the FILE NAME out of the legacy photo path', () => {
    const [car] = parseCars([row({ license_photo: '/uploads/cars_license_photos/150.jpg' })]).cars;
    expect(car?.photo).toBe('150.jpg');
    // A row with no scan says so, rather than pointing at a file nobody will find.
    expect(parseCars([row()]).cars[0]?.photo).toBeNull();
    expect(parseCars([row({ license_photo: '' })]).cars[0]?.photo).toBeNull();
  });

  it('rejects a row it cannot read, naming every field that is missing', () => {
    const { cars, rejected } = parseCars([row({ car_code: '', branch: '', motor_num: '' })]);
    expect(cars).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toContain('car_code');
    expect(rejected[0]?.reason).toContain('branch');
    expect(rejected[0]?.reason).toContain('motor_num');
  });

  it('rejects an unreadable DATE rather than storing an Invalid Date', () => {
    // `new Date('nonsense')` is an Invalid Date, which reaches Mongo as null and makes a licence
    // that never expires — the one shape worse than refusing the row.
    const { cars, rejected } = parseCars([row({ expiry_date: { $date: 'nonsense' } })]);
    expect(cars).toHaveLength(0);
    expect(rejected[0]?.reason).toContain('expiry_date');
  });

  it('catches a duplicate code among the LIVE rows before anything is written', () => {
    // The registry's unique index would catch it halfway through, leaving a half-written import.
    const { rejected } = parseCars([row({ car_code: '150' }), row({ car_code: '150' })]);
    expect(rejected.some((r) => r.code === '150' && r.reason.includes('appears 2 times'))).toBe(
      true,
    );
  });

  it('maps each legacy field to the fact it is', () => {
    // The mapping the owner confirmed: `licens` is the licence CLASS and `department` is the
    // OPERATION — not the organisation's department, which is a different registry entirely.
    const [car] = parseCars([row()]).cars;
    expect(car?.licenseClass, 'licens → فئة الترخيص').toBe('برقاش م');
    expect(car?.operation, 'department → التشغيل').toBe('ATM');
    expect(car?.insurer).toBe('مصر للتأمين');
    expect(car?.branch, 'branch → the organisation registry').toBe('المهندسين');
    expect(car?.joinedAt.toISOString().slice(0, 10)).toBe('2020-10-12');
    expect(car?.licenseExpiresAt.toISOString().slice(0, 10)).toBe('2026-09-04');
  });
});
