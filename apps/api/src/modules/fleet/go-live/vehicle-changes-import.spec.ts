// The owner's second cars export, compared with the first and decided field by field — on rows,
// with no database: which fields changed, which rule each change meets on ECMS, and exactly what
// the new export changes on the real registry.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  decideChange,
  ecmsKeyOf,
  planVehicleChanges,
  updateBodyFor,
  VEHICLE_CHANGE_FIELDS,
  type VehicleChangesPlan,
} from './vehicle-changes-import';
import {
  VEHICLE_CHANGES_GO_LIVE_MARK,
  VEHICLE_CHANGES_NEW_FILE,
  VEHICLE_CHANGES_OLD_FILE,
} from './vehicle-changes';
import { resolveGoLiveDataDir } from './vehicles';
import { parseCars } from './vehicles-import';

/** One legacy row in the export's own shape. */
const legacy = (over: Record<string, unknown>) => ({
  car_type: 'سوزوكى',
  car_code: '151',
  plate_num: 'ج ك ق 4719',
  chassis_num: '259836',
  motor_num: '1273343',
  joining_date: { $date: '2025-02-24T00:00:00.000Z' },
  expiry_date: { $date: '2026-09-04T00:00:00.000Z' },
  licens: 'برقاش م',
  branch: 'المهندسين',
  department: 'نقل اموال',
  insurance_company: 'مصر للتأمين',
  issi: '',
  sn_motorola: '',
  deleted: 0,
  status: 1,
  ...over,
});

const plan = (oldRows: unknown[], newRows: unknown[]): VehicleChangesPlan =>
  planVehicleChanges(parseCars(oldRows).cars, parseCars(newRows).cars);

describe('the three-way rule', () => {
  it('applies the new value where ECMS still holds what the import wrote from the old export', () => {
    expect(decideChange('برقاش م', 'برقاش م', 'برقاش ت')).toBe('apply');
    expect(decideChange('2026-09-04', '2026-09-04', '2026-12-03')).toBe('apply');
    // Nothing on either side is still a value: an empty field the import left empty takes the new one.
    expect(decideChange(null, null, 'ISSI-1')).toBe('apply');
  });

  it('counts a field ECMS already carries the new value of — a person made it, or an earlier attempt did', () => {
    expect(decideChange('برقاش ت', 'برقاش م', 'برقاش ت')).toBe('alreadyNew');
    expect(decideChange(null, 'ISSI-1', null)).toBe('alreadyNew');
  });

  it('KEEPS a value somebody typed on ECMS since the import — never overwritten', () => {
    expect(decideChange('2026-10-01', '2026-09-04', '2026-12-03')).toBe('keptEcmsEdit');
    expect(decideChange(null, 'ISSI-1', 'ISSI-2')).toBe('keptEcmsEdit');
    expect(decideChange('ISSI-3', null, 'ISSI-2')).toBe('keptEcmsEdit');
  });

  it('a name ECMS cannot resolve proves nothing — an old catalog name renamed since is a kept edit', () => {
    // `undefined` is «this name is no row on ECMS». The car still points at the row the import
    // wrote, but nothing can show that row is the one the old export named, so it is left alone.
    expect(decideChange('id-of-renamed', undefined, 'id-new')).toBe('keptEcmsEdit');
    // …and a NEW name not created yet is still applied where the field is untouched — the
    // resolver creates it at write time, exactly as the vehicle import would have.
    expect(decideChange('id-old', 'id-old', undefined)).toBe('apply');
    // Two unresolvable names are not «the same» either.
    expect(decideChange(undefined, undefined, 'x')).toBe('keptEcmsEdit');
  });

  it('asks «already new» first — a field equal to both sides is counted, never written', () => {
    expect(decideChange('x', 'x', 'x')).toBe('alreadyNew');
  });
});

describe('comparing the two exports', () => {
  it('names exactly the fields that differ, with both exports’ values, in the form’s order', () => {
    const result = plan(
      [legacy({})],
      [
        legacy({
          licens: 'برقاش ت',
          expiry_date: { $date: '2026-12-03T00:00:00.000Z' },
          branch: 'أكتوبر',
          department: 'ATM',
          issi: '1234',
        }),
      ],
    );
    expect(result.cars).toBe(1);
    expect(result.changes).toEqual([
      {
        code: '151',
        fields: [
          {
            field: 'licenseExpiresAt',
            old: new Date('2026-09-04T00:00:00.000Z'),
            next: new Date('2026-12-03T00:00:00.000Z'),
          },
          { field: 'licenseClass', old: 'برقاش م', next: 'برقاش ت' },
          { field: 'branch', old: 'المهندسين', next: 'أكتوبر' },
          { field: 'operation', old: 'نقل اموال', next: 'ATM' },
          { field: 'issi', old: null, next: '1234' },
        ],
        photo: null,
      },
    ]);
    expect(result.inExport).toEqual({
      licenseExpiresAt: 1,
      licenseClass: 1,
      branch: 1,
      operation: 1,
      issi: 1,
    });
  });

  it('a trailing space the old system dropped is NOT a change — both became one catalog row', () => {
    const result = plan([legacy({ licens: 'برقاش م ' })], [legacy({ licens: 'برقاش م' })]);
    expect(result.changes).toEqual([]);
  });

  it('…but a trailing space AND a different class is a change, compared trimmed', () => {
    const result = plan([legacy({ licens: 'برقاش م ' })], [legacy({ licens: 'برقاش ت' })]);
    expect(result.changes[0]?.fields).toEqual([
      { field: 'licenseClass', old: 'برقاش م', next: 'برقاش ت' },
    ]);
  });

  it('a date is compared as a day — the same day at another hour is not a change', () => {
    const result = plan(
      [legacy({ expiry_date: { $date: '2026-09-04T00:00:00.000Z' } })],
      [legacy({ expiry_date: { $date: '2026-09-04T09:30:00.000Z' } })],
    );
    expect(result.changes).toEqual([]);
  });

  it('a scan the new export names is a photo change, by file name; the same scan is none', () => {
    const result = plan(
      [
        legacy({ car_code: '170' }),
        legacy({ car_code: '150', license_photo: '/uploads/cars_license_photos/150.jpg' }),
      ],
      [
        legacy({ car_code: '170', license_photo: '/uploads/cars_license_photos/170.jpg' }),
        legacy({ car_code: '150', license_photo: '/uploads/cars_license_photos/150.jpg' }),
      ],
    );
    expect(result.changes).toEqual([
      { code: '170', fields: [], photo: { old: null, next: '170.jpg' } },
    ]);
    expect(result.inExport).toEqual({ photo: 1 });
  });

  it('a scan the new export no longer names is reported as dropped — the plan says so, nothing more', () => {
    const result = plan(
      [legacy({ license_photo: '/uploads/cars_license_photos/151.jpg' })],
      [legacy({})],
    );
    expect(result.changes).toEqual([
      { code: '151', fields: [], photo: { old: '151.jpg', next: null } },
    ]);
  });

  it('REPORTS a car only one export has — it neither creates nor deletes one', () => {
    const result = plan(
      [legacy({ car_code: '151' }), legacy({ car_code: 'GONE' })],
      [
        legacy({ car_code: '151' }),
        legacy({ car_code: 'NEW', plate_num: 'x', chassis_num: 'y', motor_num: 'z' }),
      ],
    );
    expect(result.newCars).toEqual(['NEW']);
    expect(result.goneFromExport).toEqual(['GONE']);
    expect(result.changes).toEqual([]);
    expect(result.cars).toBe(2);
  });

  it('a row either export deleted is test data to both — the reader drops it before the diff', () => {
    const result = plan(
      [legacy({}), legacy({ car_code: '3333', deleted: 1 })],
      [legacy({}), legacy({ car_code: '3333', deleted: 1, licens: 'العجوزة ت' })],
    );
    expect(result.changes).toEqual([]);
    expect(result.newCars).toEqual([]);
    expect(result.goneFromExport).toEqual([]);
  });
});

describe('ECMS’s side, and the body that is written', () => {
  const vehicle = {
    typeId: new Types.ObjectId('650000000000000000000001'),
    plateNumber: 'ج ك ق 4719',
    chassisNumber: '259836',
    motorNumber: '1273343',
    joinedAt: new Date('2025-02-24T00:00:00.000Z'),
    licenseExpiresAt: new Date('2026-09-04T00:00:00.000Z'),
    licenseClassId: new Types.ObjectId('650000000000000000000002'),
    branchId: new Types.ObjectId('650000000000000000000003'),
    operationId: null,
    insuranceCompanyId: new Types.ObjectId('650000000000000000000004'),
    radio: { issi: null, motorolaSn: 'SN-9' },
  };

  it('reads every field ECMS holds as the key the rule compares — ids, days, text, nothing', () => {
    expect(
      Object.fromEntries(VEHICLE_CHANGE_FIELDS.map((field) => [field, ecmsKeyOf(vehicle, field)])),
    ).toEqual({
      type: '650000000000000000000001',
      plateNumber: 'ج ك ق 4719',
      chassisNumber: '259836',
      motorNumber: '1273343',
      joinedAt: '2025-02-24',
      licenseExpiresAt: '2026-09-04',
      licenseClass: '650000000000000000000002',
      branch: '650000000000000000000003',
      operation: null,
      insurer: '650000000000000000000004',
      issi: null,
      motorolaSn: 'SN-9',
    });
  });

  it('a row written before the radio existed reads as no radio, not as a crash', () => {
    const legacyRow = { ...vehicle, radio: undefined as unknown as typeof vehicle.radio };
    expect(ecmsKeyOf(legacyRow, 'issi')).toBeNull();
    expect(ecmsKeyOf(legacyRow, 'motorolaSn')).toBeNull();
  });

  it('writes the changed fields ONLY — each under the name the model stores it by', () => {
    expect(
      updateBodyFor(
        [
          { field: 'licenseClass', value: 'id-class' },
          { field: 'licenseExpiresAt', value: new Date('2026-12-03T00:00:00.000Z') },
          { field: 'branch', value: 'id-branch' },
          { field: 'operation', value: 'id-operation' },
        ],
        vehicle,
      ),
    ).toEqual({
      licenseClassId: 'id-class',
      licenseExpiresAt: new Date('2026-12-03T00:00:00.000Z'),
      branchId: 'id-branch',
      operationId: 'id-operation',
    });
    expect(updateBodyFor([{ field: 'type', value: 'id-type' }], vehicle)).toEqual({
      typeId: 'id-type',
    });
    expect(updateBodyFor([{ field: 'insurer', value: null }], vehicle)).toEqual({
      insuranceCompanyId: null,
    });
    expect(updateBodyFor([{ field: 'plateNumber', value: 'ص ح ح 1' }], vehicle)).toEqual({
      plateNumber: 'ص ح ح 1',
    });
  });

  it('a radio change carries the OTHER half as ECMS has it — the ISSI alone never blanks the serial', () => {
    expect(updateBodyFor([{ field: 'issi', value: '1234' }], vehicle)).toEqual({
      radio: { issi: '1234', motorolaSn: 'SN-9' },
    });
    expect(updateBodyFor([{ field: 'motorolaSn', value: null }], vehicle)).toEqual({
      radio: { issi: null, motorolaSn: null },
    });
  });

  it('nothing to apply is an empty body — and the step writes nothing for it', () => {
    expect(updateBodyFor([], vehicle)).toEqual({});
  });
});

describe('the two real exports', () => {
  const dir = resolveGoLiveDataDir() as string;
  const oldParsed = parseCars(
    JSON.parse(readFileSync(join(dir, VEHICLE_CHANGES_OLD_FILE), 'utf8')),
  );
  const newParsed = parseCars(
    JSON.parse(readFileSync(join(dir, VEHICLE_CHANGES_NEW_FILE), 'utf8')),
  );
  const result = planVehicleChanges(oldParsed.cars, newParsed.cars);
  const codesOf = (field: string): string[] =>
    result.changes
      .filter((car) =>
        field === 'photo'
          ? car.photo !== null
          : car.fields.some((change) => change.field === field),
      )
      .map((car) => car.code)
      .sort();
  const sorted = (codes: string[]): string[] => [...codes].sort();

  /** The 36 cars whose licence was renewed — class and expiry both moved. */
  const RENEWED = [
    '151',
    '152',
    '153',
    '156',
    '158',
    '170',
    '180',
    '193',
    '288',
    '208',
    '210',
    '211',
    '243',
    '250',
    '254',
    '255',
    '256',
    '257',
    '258',
    '259',
    '260',
    '271',
    '282',
    '285',
    '500',
    '503',
    '520',
    '525',
    '526',
    '528',
    '529',
    '800',
    'تويوتا 2',
    '534',
    '296',
    '536',
  ];

  it('both read cleanly — no rejected row, the same four deleted test rows, the same 209 cars', () => {
    expect(oldParsed.rejected).toEqual([]);
    expect(newParsed.rejected).toEqual([]);
    expect(oldParsed.skippedDeleted).toBe(4);
    expect(newParsed.skippedDeleted).toBe(4);
    expect(result.cars).toBe(209);
    expect(result.newCars).toEqual([]);
    expect(result.goneFromExport).toEqual([]);
  });

  it('changes five things on 44 cars, and nothing else', () => {
    expect(result.inExport).toEqual({
      licenseClass: 38,
      licenseExpiresAt: 36,
      photo: 31,
      branch: 3,
      operation: 1,
    });
    expect(result.changes).toHaveLength(44);
  });

  it('38 licence classes — the 36 renewals, and 204 and 806, whose old class carried a trailing space', () => {
    expect(codesOf('licenseClass')).toEqual(sorted([...RENEWED, '204', '806']));
    const byCode = new Map(result.changes.map((car) => [car.code, car]));
    expect(byCode.get('204')?.fields).toEqual([
      { field: 'licenseClass', old: 'برقاش م', next: 'برقاش ت' },
    ]);
    expect(byCode.get('806')?.fields).toEqual([
      { field: 'licenseClass', old: 'برقاش م', next: 'برقاش ت' },
    ]);
    // Every one of them is a swap between the two Barqash classes, and nothing but that.
    const swaps = result.changes.flatMap((car) =>
      car.fields.filter((change) => change.field === 'licenseClass'),
    );
    expect(
      new Set(swaps.map((change) => `${String(change.old)} → ${String(change.next)}`)),
    ).toEqual(new Set(['برقاش م → برقاش ت', 'برقاش ت → برقاش م']));
  });

  it('36 licence expiry dates, every one moved LATER', () => {
    expect(codesOf('licenseExpiresAt')).toEqual(sorted(RENEWED));
    const expiries = result.changes.flatMap((car) =>
      car.fields.filter((change) => change.field === 'licenseExpiresAt'),
    );
    expect(expiries.every((change) => (change.next as Date) > (change.old as Date))).toBe(true);
    const byCode = new Map(result.changes.map((car) => [car.code, car]));
    expect(byCode.get('170')?.fields.find((change) => change.field === 'licenseExpiresAt')).toEqual(
      {
        field: 'licenseExpiresAt',
        old: new Date('2026-08-04T00:00:00.000Z'),
        next: new Date('2027-02-17T00:00:00.000Z'),
      },
    );
  });

  it('three cars change branch and one changes operation — 260 moves on both', () => {
    const byCode = new Map(result.changes.map((car) => [car.code, car]));
    expect(codesOf('branch')).toEqual(sorted(['260', '530', '301']));
    expect(
      byCode.get('260')?.fields.filter((c) => c.field === 'branch' || c.field === 'operation'),
    ).toEqual([
      { field: 'branch', old: 'المهندسين', next: 'أكتوبر' },
      { field: 'operation', old: 'نقل اموال', next: 'ATM' },
    ]);
    expect(byCode.get('530')?.fields).toEqual([
      { field: 'branch', old: 'المهندسين', next: 'الشروق' },
    ]);
    expect(byCode.get('301')?.fields).toEqual([
      { field: 'branch', old: 'المهندسين', next: 'الشروق' },
    ]);
    expect(codesOf('operation')).toEqual(['260']);
  });

  it('31 cars name a licence scan for the first time — and this build carries none of the 31 files', () => {
    expect(codesOf('photo')).toEqual(
      sorted([
        '170',
        '187',
        '188',
        '193',
        '288',
        '208',
        '210',
        '211',
        '254',
        '255',
        '256',
        '257',
        '258',
        '259',
        '260',
        '282',
        '285',
        '500',
        '503',
        '520',
        '525',
        '526',
        '528',
        '529',
        '800',
        'تويوتا 2',
        '296',
        '536',
        '301',
        '302',
        '303',
      ]),
    );
    const photos = result.changes.flatMap((car) => (car.photo === null ? [] : [car.photo]));
    expect(photos.every((photo) => photo.old === null && photo.next !== null)).toBe(true);
    expect(photos.find((photo) => photo.next?.startsWith('تويوتا'))?.next).toBe('تويوتا_2.jpg');
    // The files were not sent with the export — every one is listed on the run, none is guessed.
    const inBuild = new Set(readdirSync(join(dir, 'license-photos')));
    expect(photos.filter((photo) => inBuild.has(photo.next as string))).toEqual([]);
  });

  it('nothing else moved — no plate, chassis, motor, type, joining date, insurer or radio', () => {
    for (const field of [
      'type',
      'plateNumber',
      'chassisNumber',
      'motorNumber',
      'joinedAt',
      'insurer',
      'issi',
      'motorolaSn',
    ]) {
      expect(codesOf(field), field).toEqual([]);
    }
  });
});

describe('the step itself — its payload and its order', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  /** The source with its comments removed — naming a call to describe it must not keep this green. */
  const source = readFileSync(join(HERE, 'vehicle-changes.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const dir = resolveGoLiveDataDir() as string;
  const sha256 = (file: string): string =>
    createHash('sha256')
      .update(readFileSync(join(dir, file)))
      .digest('hex');

  it('carries BOTH exports byte for byte — the old one is the rule’s old side and never edited', () => {
    // `cars.json` is what `go-live:vehicles:v3` imported. Edit it and every «ECMS = OLD» below
    // stops meaning «nobody touched this since the import» — so it is pinned, not merely present.
    expect(sha256(VEHICLE_CHANGES_OLD_FILE)).toBe(
      '2916d9b618107e39fbc478e03511199280c6b18155731a6d989d237cde23e4cf',
    );
    // The owner's file as sent on 2026-09-29, unedited.
    expect(sha256(VEHICLE_CHANGES_NEW_FILE)).toBe(
      '61738e21728fbef8adc6090c3a2d80022440f9e8b5bce1b6acbe8cabf505ce68',
    );
  });

  it('is its own run, versioned, and waits for the cars before it decides anything', () => {
    expect(VEHICLE_CHANGES_GO_LIVE_MARK).toBe('go-live:vehicle-changes:v1');
    expect(source).toContain('waitForGoLiveRuns([VEHICLE_GO_LIVE_MARK])');
  });

  it('refuses before its claim — every condition an operator fixes and redeploys', () => {
    const claim = source.indexOf('claimGoLiveRun(VEHICLE_CHANGES_GO_LIVE_MARK');
    expect(claim).toBeGreaterThan(-1);
    for (const refusal of [
      'dir === null',
      '!existsSync(oldFile) || !existsSync(newFile)',
      'waitForGoLiveRuns(',
      'rejected.length > 0',
      'admin === null',
      'blockers.missingBranches.length > 0',
      'blockers.inactiveBranches.length > 0',
      'blockers.identifierClashes.length > 0',
    ]) {
      expect(source.indexOf(refusal), `${refusal} is checked`).toBeGreaterThan(-1);
      expect(source.indexOf(refusal), `${refusal} is checked before the claim`).toBeLessThan(claim);
    }
  });

  it('a run with failures is left unfinished — recorded, never marked done', () => {
    const failed = source.indexOf('if (outcome.failures.length > 0)');
    const recorded = source.indexOf('recordGoLiveFailure(VEHICLE_CHANGES_GO_LIVE_MARK', failed);
    const finished = source.indexOf('finishGoLiveRun(VEHICLE_CHANGES_GO_LIVE_MARK');
    expect(failed).toBeGreaterThan(-1);
    expect(recorded).toBeGreaterThan(failed);
    expect(source.slice(recorded, finished)).toContain('return;');
    expect(finished).toBeGreaterThan(recorded);
  });

  it('the boot starts it without waiting, and never under test', () => {
    expect(source).toMatch(
      /startVehicleChangesGoLive\s*=\s*\(\):\s*void\s*=>\s*\{\s*\n\s*if \(isTest\) return;/,
    );
    expect(source).toContain('void runVehicleChangesGoLive().catch(');
  });
});
