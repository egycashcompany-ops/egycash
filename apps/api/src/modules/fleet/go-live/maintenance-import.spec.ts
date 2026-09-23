// The workshop book, read and turned into visits — on rows, with no database: what is read, what
// is skipped and named, and which spellings mean nobody.
import { describe, expect, it } from 'vitest';
import { isNobodyInWorkshop, parseVisits, planMaintenanceImport, type ParsedVisit } from './maintenance-import';

const legacy = (over: Record<string, unknown>) => ({
  _id: { $oid: String(over['_id'] ?? '69244af87db333ddf88f339c') },
  in_date: '2024-10-13',
  out_date: '2025-01-06',
  car_code: '223',
  driver: 'احمد فرج',
  driver2: '-',
  destination: 'mcv',
  works: 'إصلاح',
  spare_parts: ['زيت', ' فلتر زيت '],
  counter: '141522',
  notes: 'تغير عامود دريكسيون',
  deleted: 0,
  ...over,
});

describe('reading the export', () => {
  it('reads a visit into the book’s own terms — dates at midnight UTC, parts trimmed, the counter a number', () => {
    const parsed = parseVisits([legacy({})]);
    expect(parsed.rejected).toEqual([]);
    expect(parsed.visits).toEqual([
      {
        id: '69244af87db333ddf88f339c',
        code: '223',
        inDate: new Date('2024-10-13T00:00:00.000Z'),
        outDate: new Date('2025-01-06T00:00:00.000Z'),
        workshop: 'mcv',
        workType: 'إصلاح',
        parts: ['زيت', 'فلتر زيت'],
        counter: 141522,
        driver: 'احمد فرج',
        driver2: '-',
        notes: 'تغير عامود دريكسيون',
        deletion: { isDeleted: false, deletedAt: null },
        unreadable: false,
      },
    ]);
  });

  it('an open visit has no out-date; a blank workshop, work type or counter is nothing', () => {
    const [visit] = parseVisits([legacy({ out_date: null, destination: '', works: undefined, counter: '', spare_parts: undefined })]).visits;
    expect(visit?.outDate).toBeNull();
    expect(visit?.workshop).toBeNull();
    expect(visit?.workType).toBeNull();
    expect(visit?.counter).toBeNull();
    expect(visit?.parts).toEqual([]);
  });

  it('KEEPS a visit the old system had deleted, carrying its deletion and the day of it', () => {
    const parsed = parseVisits([
      legacy({ deleted: 1, deleted_date: { $date: '2025-11-26T15:01:23.514Z' } }),
      legacy({ _id: 'b' }),
    ]);
    expect(parsed.keptDeleted).toBe(1);
    expect(parsed.visits.map((v) => v.id)).toEqual(['69244af87db333ddf88f339c', 'b']);
    expect(parsed.visits[0]?.deletion).toEqual({
      isDeleted: true,
      deletedAt: new Date('2025-11-26T15:01:23.514Z'),
    });
  });

  it('KEEPS a visit it cannot read — every one of them — and reports what could not be read', () => {
    const parsed = parseVisits([
      legacy({ _id: 'no-car', car_code: ' ' }),
      legacy({ _id: 'bad-out', out_date: '6/4/20205' }),
      legacy({ _id: 'bad-in', in_date: '2025-13-45', added_date: { $date: '2024-10-13T00:00:00.000Z' } }),
      legacy({ _id: 'bad-counter', counter: '12a' }),
      legacy({ _id: 'fine' }),
    ]);
    expect(parsed.unreadable).toEqual([
      { id: 'no-car', reason: 'no car code' },
      { id: 'bad-out', reason: '223 2024-10-13: the out-date cannot be read' },
      { id: 'bad-in', reason: '223: the in-date cannot be read' },
      { id: 'bad-counter', reason: '223 2024-10-13: the counter is not a number' },
    ]);
    expect(parsed.rejected, 'only a file that is not a list of rows is refused').toEqual([]);
    expect(parsed.visits.map((v) => v.id)).toEqual(['no-car', 'bad-out', 'bad-in', 'bad-counter', 'fine']);
  });

  it('keeps the book’s own words for a date or a counter the model cannot hold', () => {
    const [noCar, badOut, badIn, badCounter] = parseVisits([
      legacy({ _id: 'no-car', car_code: ' ' }),
      legacy({ _id: 'bad-out', out_date: '6/4/20205' }),
      legacy({ _id: 'bad-in', in_date: '2025-13-45', added_date: { $date: '2024-10-13T00:00:00.000Z' } }),
      legacy({ _id: 'bad-counter', counter: '12a', notes: '' }),
    ]).visits;
    expect(noCar?.code, 'never an empty column').toBe('بدون كود');
    expect(badOut?.outDate, 'a car is never shown in two workshops over a word nobody can read').toBeNull();
    expect(badOut?.notes).toBe('تغير عامود دريكسيون · تاريخ الخروج في الدفتر القديم: «6/4/20205»');
    expect(badIn?.inDate, 'the day the row was added is the nearest thing the export has').toEqual(
      new Date('2024-10-13T00:00:00.000Z'),
    );
    expect(badCounter?.counter).toBeNull();
    expect(badCounter?.notes).toBe('العداد في الدفتر القديم: «12a»');
    expect([noCar, badOut, badIn].map((v) => v?.unreadable)).toEqual([true, true, true]);
    expect(badCounter?.unreadable, 'a counter the chain can supply does not bury the visit').toBe(false);
  });
});

describe('the workshop book’s spellings for «nobody»', () => {
  it.each(['-', '+', '...', '0000', 'ونش', 'جراج', 'احتياطى', 'التوكيل'])('%s is nobody', (name) => {
    expect(isNobodyInWorkshop(name)).toBe(true);
  });

  it('a person is not — nor is a city, which is simply a name HR will not have', () => {
    expect(isNobodyInWorkshop('اشرف نصحى')).toBe(false);
    expect(isNobodyInWorkshop('أسيوط')).toBe(false);
  });
});

const visit = (over: Partial<ParsedVisit>): ParsedVisit => ({
  id: 'v',
  code: '223',
  inDate: new Date('2025-01-13T00:00:00.000Z'),
  outDate: new Date('2025-01-20T00:00:00.000Z'),
  workshop: 'mcv',
  workType: 'صيانة',
  parts: ['زيت'],
  counter: 1000,
  driver: null,
  driver2: null,
  notes: null,
  deletion: { isDeleted: false, deletedAt: null },
  unreadable: false,
  ...over,
});

const REGISTRY = new Map([['223', 'v223'], ['161', 'v161']]);

describe('turning the ledger into visits', () => {
  it('groups by car, orders by the day in, and resolves both drivers by name', () => {
    const plan = planMaintenanceImport(
      [
        visit({ id: 'b', inDate: new Date('2025-02-01T00:00:00.000Z'), outDate: new Date('2025-02-05T00:00:00.000Z'), driver: 'اشرف نصحى' }),
        visit({ id: 'a', driver2: 'محمد عبدالله' }),
        visit({ id: 'c', code: '161' }),
      ],
      REGISTRY,
      new Map([['اشرف نصحى', 'emp-1']]),
    );
    expect(plan.vehicles.map((v) => v.code)).toEqual(['161', '223']);
    const car = plan.vehicles[1];
    expect(car?.visits.map((v) => v.id)).toEqual(['a', 'b']);
    expect(car?.visits[1]?.driverIn).toEqual({ id: 'emp-1', name: null });
    expect(car?.visits[0]?.driverOut, 'a name HR does not know is kept as text').toEqual({ id: null, name: 'محمد عبدالله' });
    expect(car?.visits[0]?.driverIn, 'nothing written is nobody').toEqual({ id: null, name: null });
  });

  it('KEEPS a visit that left before it arrived, both dates as the book wrote them, and names it', () => {
    const plan = planMaintenanceImport(
      [visit({ id: 'a', code: '161', inDate: new Date('2025-01-13T00:00:00.000Z'), outDate: new Date('2025-01-11T00:00:00.000Z') })],
      REGISTRY,
      new Map(),
    );
    expect(plan.outBeforeIn).toEqual(['161 2025-01-13 → 2025-01-11']);
    expect(plan.vehicles[0]?.visits.map((v) => [v.inDate, v.outDate, v.deleted])).toEqual([
      [new Date('2025-01-13T00:00:00.000Z'), new Date('2025-01-11T00:00:00.000Z'), false],
    ]);
  });

  it('a visit the old system deleted, or one the model cannot hold, is kept and written deleted', () => {
    const plan = planMaintenanceImport(
      [
        visit({ id: 'a' }),
        visit({ id: 'gone', deletion: { isDeleted: true, deletedAt: new Date('2025-11-26T00:00:00.000Z') } }),
        visit({ id: 'unreadable', unreadable: true }),
      ],
      REGISTRY,
      new Map(),
    );
    expect(plan.vehicles[0]?.visits.map((v) => [v.id, v.deleted])).toEqual([
      ['a', false],
      ['gone', true],
      ['unreadable', true],
    ]);
    expect(plan.deleted).toBe(2);
  });

  it('a car the registry does not have KEEPS its visits, by the book’s code, and is listed with its row count', () => {
    const plan = planMaintenanceImport([visit({ code: 'بجو' }), visit({ id: 'x', code: 'بجو' })], REGISTRY, new Map());
    expect(plan.unknownCars).toEqual(['بجو (2)']);
    expect(plan.vehicles.map((v) => [v.code, v.ref, v.visits.length])).toEqual([['بجو', { vehicleId: null, vehicleCode: 'بجو' }, 2]]);
  });

  it('collects the book’s own words for the catalog, distinct, in order of first use', () => {
    const plan = planMaintenanceImport(
      [
        visit({ id: 'a', workshop: 'mcv', workType: 'إصلاح', parts: ['زيت', 'فلتر زيت'] }),
        visit({ id: 'b', workshop: 'تويوتا 2', workType: null, parts: ['زيت'] }),
        visit({ id: 'c', workshop: null, workType: 'إصلاح', parts: [] }),
      ],
      REGISTRY,
      new Map(),
    );
    expect(plan.names).toEqual({ workshop: ['mcv', 'تويوتا 2'], workType: ['إصلاح'], sparePart: ['زيت', 'فلتر زيت'] });
    expect(plan.blanks, 'and how many visits will need «غير محدد», per kind').toEqual({ workshop: 1, workType: 1 });
  });
});
