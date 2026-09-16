// The odometer book, read and turned into chains — on rows, with no database: the two repairs
// the import makes, the ones it refuses to make, and how a driver's name becomes an id.
import { describe, expect, it } from 'vitest';
import {
  day,
  isPlaceholderDriver,
  parseCarsLog,
  planOdometerImport,
  type ParsedLogRow,
} from './odometer-import';

const legacy = (over: Record<string, unknown>) => ({
  _id: { $oid: String(over['_id'] ?? '6925b5826d45d31087261e9e') },
  car_code: '150',
  date: { $date: '2025-11-25T00:00:00.000Z' },
  out_num: '141522',
  in_num: '141619',
  km: '97',
  deleted: 0,
  driver: 'امير محمد محمد احمدصالح',
  driver2: '',
  notes: '',
  ...over,
});

describe('reading the export', () => {
  it('reads a row into the book’s own terms — trimmed, numbers as numbers, blanks as nothing', () => {
    const parsed = parseCarsLog([legacy({ notes: ' اسوان ', driver2: '  ' })]);
    expect(parsed.rejected).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        id: '6925b5826d45d31087261e9e',
        code: '150',
        date: new Date('2025-11-25T00:00:00.000Z'),
        out: 141522,
        in: 141619,
        driver: 'امير محمد محمد احمدصالح',
        driver2: null,
        notes: 'اسوان',
      },
    ]);
  });

  it('skips a row the old system had deleted, and counts it', () => {
    const parsed = parseCarsLog([legacy({ deleted: 1 }), legacy({ _id: 'b' })]);
    expect(parsed.skippedDeleted).toBe(1);
    expect(parsed.rows.map((row) => row.id)).toEqual(['b']);
  });

  it('a blank reading is NO reading — not zero', () => {
    const [row] = parseCarsLog([legacy({ out_num: '', in_num: ' ' })]).rows;
    expect(row?.out).toBeNull();
    expect(row?.in).toBeNull();
  });

  it('REPORTS a row it cannot read, by legacy id, and reads the rest', () => {
    const parsed = parseCarsLog([
      legacy({ _id: 'garbage-date', date: { $date: { $numberLong: '-62071747200000' } } }),
      legacy({ _id: 'year-zero', date: '0000-12-31T00:00:00.000Z' }),
      legacy({ _id: 'no-car', car_code: '' }),
      legacy({ _id: 'not-a-number', out_num: '12a' }),
      legacy({ _id: 'fine' }),
    ]);
    expect(parsed.rejected.map((r) => r.id)).toEqual(['garbage-date', 'year-zero', 'no-car', 'not-a-number']);
    expect(parsed.rejected[0]?.reason).toBe('176: the date cannot be read'.replace('176', '150'));
    expect(parsed.rows.map((row) => row.id)).toEqual(['fine']);
  });

  it('refuses a file that is not an array', () => {
    expect(parseCarsLog({ rows: [] }).rejected).toEqual([{ id: 'file', reason: 'the export is not a JSON array' }]);
  });
});

describe('the «no driver» spellings', () => {
  it.each(['احتياطى', 'احتياطي', 'إحتياطى', 'التوكيل', 'توكيل'])('%s is nobody', (name) => {
    expect(isPlaceholderDriver(name)).toBe(true);
  });

  it('a person is not', () => {
    expect(isPlaceholderDriver('مصطفى عثمان محمود عثمان')).toBe(false);
  });
});

const row = (over: Partial<ParsedLogRow>): ParsedLogRow => ({
  id: 'r',
  code: '150',
  date: new Date('2025-11-25T00:00:00.000Z'),
  out: 100,
  in: 150,
  driver: null,
  driver2: null,
  notes: null,
  ...over,
});

const REGISTRY = new Map([['150', 'v150'], ['151', 'v151']]);

describe('turning the ledger into a chain', () => {
  it('orders a car’s rows by date, then by reading, and keeps what the book wrote', () => {
    const plan = planOdometerImport(
      [
        row({ id: 'b', date: new Date('2025-11-26T00:00:00.000Z'), out: 150, in: 200 }),
        row({ id: 'a', date: new Date('2025-11-25T00:00:00.000Z'), out: 100, in: 150 }),
        row({ id: 'c', date: new Date('2025-11-26T00:00:00.000Z'), out: 200, in: 260 }),
      ],
      REGISTRY,
      new Map(),
    );
    expect(plan.vehicles).toHaveLength(1);
    expect(plan.vehicles[0]?.ref).toEqual({ vehicleId: 'v150' });
    expect(plan.vehicles[0]?.rows.map((r) => [r.out, r.in])).toEqual([[100, 150], [150, 200], [200, 260]]);
  });

  it('a link that does not meet is left as the book wrote it — the correction flow’s job, not this one’s', () => {
    const plan = planOdometerImport(
      [row({ id: 'a', out: 100, in: 150 }), row({ id: 'b', date: new Date('2025-11-26T00:00:00.000Z'), out: 160, in: 200 })],
      REGISTRY,
      new Map(),
    );
    expect(plan.vehicles[0]?.rows.map((r) => [r.out, r.in])).toEqual([[100, 150], [160, 200]]);
    expect(plan.closedByNext).toBe(0);
  });

  it('closes a row with NO closing reading with the next row’s opening one, and counts it', () => {
    const plan = planOdometerImport(
      [row({ id: 'a', out: 100, in: null }), row({ id: 'b', date: new Date('2025-11-26T00:00:00.000Z'), out: 150, in: 200 })],
      REGISTRY,
      new Map(),
    );
    expect(plan.vehicles[0]?.rows.map((r) => [r.out, r.in])).toEqual([[100, 150], [150, 200]]);
    expect(plan.closedByNext).toBe(1);
  });

  it('a closing reading BELOW the opening one is no reading — «0» — and is closed the same way', () => {
    const plan = planOdometerImport(
      [row({ id: 'a', out: 100, in: 0 }), row({ id: 'b', date: new Date('2025-11-26T00:00:00.000Z'), out: 150, in: 200 })],
      REGISTRY,
      new Map(),
    );
    expect(plan.vehicles[0]?.rows[0]?.in).toBe(150);
    expect(plan.badInReading).toBe(1);
    expect(plan.closedByNext).toBe(1);
  });

  it('the LAST row of a car stays open — the model’s own open period, one per car', () => {
    const plan = planOdometerImport(
      [row({ id: 'a', out: 100, in: 150 }), row({ id: 'b', date: new Date('2025-11-26T00:00:00.000Z'), out: 150, in: null })],
      REGISTRY,
      new Map(),
    );
    expect(plan.vehicles[0]?.rows[1]?.in).toBeNull();
    expect(plan.closedByNext).toBe(0);
  });

  it('a row with NO opening reading cannot be a period — skipped, counted and named', () => {
    const plan = planOdometerImport(
      [row({ id: 'a', out: null, in: 150 }), row({ id: 'b', date: new Date('2025-11-26T00:00:00.000Z'), out: 150, in: 200 })],
      REGISTRY,
      new Map(),
    );
    expect(plan.noOutReading).toBe(1);
    expect(plan.noOutReadingRows).toEqual(['150 2025-11-25']);
    expect(plan.vehicles[0]?.rows).toHaveLength(1);
  });

  it('a car the registry does not have KEEPS its rows, by the book’s code, and is listed with its row count', () => {
    const plan = planOdometerImport(
      [row({ id: 'a', code: 'تويوتا1' }), row({ id: 'b', code: 'تويوتا1', date: new Date('2025-11-26T00:00:00.000Z'), out: 150, in: null }), row({ id: 'c', code: '194' }), row({ id: 'd' })],
      REGISTRY,
      new Map(),
    );
    expect(plan.unknownCars).toEqual(['194 (1)', 'تويوتا1 (2)']);
    expect(plan.vehicles.map((v) => [v.code, v.ref])).toEqual([
      ['150', { vehicleId: 'v150' }],
      ['194', { vehicleId: null, vehicleCode: '194' }],
      ['تويوتا1', { vehicleId: null, vehicleCode: 'تويوتا1' }],
    ]);
    expect(plan.vehicles[2]?.rows.map((r) => [r.out, r.in]), 'the book’s own chain, closed by the next row like any other').toEqual([[100, 150], [150, null]]);
  });

  it('puts the matched driver’s id on the row, and nothing for a name with no id', () => {
    const plan = planOdometerImport(
      [row({ id: 'a', driver: 'مصطفى عثمان محمود عثمان', driver2: 'احتياطى' })],
      REGISTRY,
      new Map([['مصطفى عثمان محمود عثمان', 'emp-1']]),
    );
    expect(plan.vehicles[0]?.rows[0]?.driver1).toEqual({ id: 'emp-1', name: null });
    expect(plan.vehicles[0]?.rows[0]?.driver2, '«احتياطى» is nobody').toEqual({ id: null, name: null });
  });

  it('keeps a name HR does not know AS TEXT on the row — a driver who was there and has gone', () => {
    const plan = planOdometerImport([row({ id: 'a', driver: 'سائق غير موجود' })], REGISTRY, new Map());
    expect(plan.vehicles[0]?.rows[0]?.driver1).toEqual({ id: null, name: 'سائق غير موجود' });
  });

  it('names a row by car and day', () => {
    expect(day(new Date('2025-11-25T13:00:00.000Z'))).toBe('2025-11-25');
  });
});
