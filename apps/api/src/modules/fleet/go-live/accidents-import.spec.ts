// The accidents book, read and turned into files — on rows, with no database.
import { describe, expect, it } from 'vitest';
import { accidentKey, isNobodyCulprit, NOT_STATED, parseAccidents, planAccidentsImport } from './accidents-import';
import { type FleetAccidentDoc } from '../accidents/accident.model';

const legacy = (over: Record<string, unknown>) => ({
  _id: { $oid: String(over['_id'] ?? '694a5ef6dc567fe78509c8e5') },
  date_accident: { $date: '2025-02-01T00:00:00.000Z' },
  car_code: '193',
  culprit: 'محمد مهدى',
  statement: 'فنوس امامى',
  amount_collected: '1400',
  finsh_status_color: '1',
  deleted: 0,
  company_account: '',
  notes: 'تم الاصلاح',
  paid: '1400',
  ...over,
});

describe('reading the export', () => {
  it('reads a file into the book’s own terms — the colour as a status, a blank amount as nothing', () => {
    const parsed = parseAccidents([legacy({})]);
    expect(parsed.rejected).toEqual([]);
    expect(parsed.accidents).toEqual([
      {
        id: '694a5ef6dc567fe78509c8e5',
        code: '193',
        occurredAt: new Date('2025-02-01T00:00:00.000Z'),
        culprit: 'محمد مهدى',
        statement: 'فنوس امامى',
        companyCost: null,
        amountCollected: 1400,
        paidAmount: 1400,
        status: 'closed',
        notes: 'تم الاصلاح',
        amountNotes: [],
        deletion: { isDeleted: false, deletedAt: null },
        unreadable: false,
      },
    ]);
  });

  it('reads a number followed by words for its number, and keeps the words to be listed', () => {
    const [file] = parseAccidents([legacy({ amount_collected: '4650 من عبدالرحمن', finsh_status_color: '0' })]).accidents;
    expect(file?.amountCollected).toBe(4650);
    expect(file?.amountNotes).toEqual(['amountCollected: من عبدالرحمن']);
    expect(file?.status).toBe('open');
  });

  it('a file with no date is read — and left for the planner to name', () => {
    expect(parseAccidents([legacy({ date_accident: null })]).accidents[0]?.occurredAt).toBeNull();
  });

  it('KEEPS a deleted file and every one it cannot read, and reports what could not be read', () => {
    const parsed = parseAccidents([
      legacy({ deleted: 1, deleted_date: { $date: '2025-12-31T13:24:01.727Z' } }),
      legacy({ _id: 'no-car', car_code: null }),
      legacy({ _id: 'no-culprit', culprit: ' ' }),
      legacy({ _id: 'bad-money', paid: 'x' }),
    ]);
    expect(parsed.keptDeleted).toBe(1);
    expect(parsed.accidents[0]?.deletion).toEqual({
      isDeleted: true,
      deletedAt: new Date('2025-12-31T13:24:01.727Z'),
    });
    expect(parsed.rejected, 'only a file that is not a list of rows is refused').toEqual([]);
    expect(parsed.unreadable).toEqual([
      { id: 'no-car', reason: 'no car code' },
      { id: 'no-culprit', reason: '193: no culprit' },
      { id: 'bad-money', reason: '193: paidAmount is not a number' },
    ]);
    expect(parsed.accidents.map((a) => a.id).slice(1)).toEqual(['no-car', 'no-culprit', 'bad-money']);
    expect(parsed.accidents[1]?.code, 'never an empty column').toBe('بدون كود');
    expect(parsed.accidents[2]?.culprit, 'nobody wrote down who').toBe(NOT_STATED);
    expect(parsed.accidents[3]).toMatchObject({
      paidAmount: null,
      notes: 'تم الاصلاح · المبلغ المدفوع فى الدفتر القديم: «x»',
      unreadable: true,
    });
  });
});

describe('a culprit that is not a name', () => {
  it.each(['-', '...', '0'])('%s is not asked of the directory', (name) => {
    expect(isNobodyCulprit(name)).toBe(true);
  });
  it('a name is', () => {
    expect(isNobodyCulprit('سائق تاكسي')).toBe(false);
  });
});

const oid = (n: number): string => n.toString(16).padStart(24, '0');
const V193 = oid(193);
const EMP_1 = oid(1001);
const REGISTRY = new Map([['193', V193]]);

describe('turning the book into files', () => {
  it('keeps the culprit’s name as written and fills in the employee where HR knows it', () => {
    const plan = planAccidentsImport(parseAccidents([legacy({})]).accidents, REGISTRY, new Map([['محمد مهدى', EMP_1]]));
    const doc = plan.vehicles[0]!.rows[0]!.doc;
    expect(doc.culprit).toBe('محمد مهدى');
    expect(String(doc.culpritEmployeeId)).toBe(EMP_1);
    expect(String(doc.vehicleId)).toBe(V193);
    expect(doc).toMatchObject({ statement: 'فنوس امامى', companyCost: 0, amountCollected: 1400, paidAmount: 1400, status: 'closed', notes: 'تم الاصلاح' });
    expect(plan.blankAmounts, 'the blank company cost, written as 0 and counted').toBe(1);
  });

  it('writes «غير مذكور» for a blank statement, and counts it', () => {
    const plan = planAccidentsImport(parseAccidents([legacy({ statement: '' })]).accidents, REGISTRY, new Map());
    expect(plan.vehicles[0]!.rows[0]!.doc.statement).toBe(NOT_STATED);
    expect(plan.statementFilled).toBe(1);
  });

  it('KEEPS a file with no date, and one on a car the registry lacks — and names both', () => {
    const plan = planAccidentsImport(
      parseAccidents([legacy({ date_accident: null }), legacy({ _id: 'x', car_code: 'تويوتا1' })]).accidents,
      REGISTRY,
      new Map(),
    );
    expect(plan.noDate).toEqual(['193: محمد مهدى']);
    expect(plan.unknownCars).toEqual(['تويوتا1 (1)']);
    expect(plan.vehicles.map((v) => [v.code, v.ref, v.rows.length])).toEqual([
      ['193', { vehicleId: V193 }, 1],
      ['تويوتا1', { vehicleId: null, vehicleCode: 'تويوتا1' }, 1],
    ]);
    expect(plan.vehicles[0]!.rows[0]!.doc.occurredAt).toBeNull();
    expect(plan.vehicles[1]!.rows[0]!.doc).toMatchObject({ vehicleId: null, vehicleCode: 'تويوتا1' });
  });

  it('lists the words written after an amount, by car and day', () => {
    const plan = planAccidentsImport(parseAccidents([legacy({ amount_collected: '4650 من عبدالرحمن' })]).accidents, REGISTRY, new Map());
    expect(plan.amountNotes).toEqual(['193 2025-02-01: amountCollected: من عبدالرحمن']);
  });

  it('tells a file from another by when, who and the three figures — never the status', () => {
    const doc = { occurredAt: new Date('2025-02-01T00:00:00.000Z'), culprit: 'محمد مهدى', companyCost: 0, amountCollected: 1400, paidAmount: 1400 };
    expect(accidentKey(doc as FleetAccidentDoc)).toBe('2025-02-01T00:00:00.000Z|محمد مهدى|0|1400|1400');
    expect(accidentKey({ ...doc, occurredAt: null } as FleetAccidentDoc), 'a file with no date').toBe('|محمد مهدى|0|1400|1400');
  });
});
