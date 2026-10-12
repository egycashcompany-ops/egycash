// The custody ledger's arrows: each column orders by what it SAYS, several at once, a missing
// value last both ways, and where the columns cannot decide, the ledger's own date order in the
// last column's direction.
import { describe, expect, it } from 'vitest';
import { CUSTODY_SORTABLE, sortCustodyMovements, type CustodySortRow } from './custody-sort';

type Row = CustodySortRow & { id: string };

const row = (id: string, over: Partial<CustodySortRow> = {}): Row => ({
  id,
  date: new Date('2026-10-01T00:00:00.000Z'),
  vehicleCode: '150',
  source: 'fuel',
  driverName: 'محمد',
  ref: 'receipt',
  amount: 100,
  ...over,
});

const ids = (rows: readonly Row[]): string[] => rows.map((r) => r.id);

describe('sortCustodyMovements', () => {
  it('whitelists the six columns of «كل الحركات»', () => {
    expect(CUSTODY_SORTABLE).toEqual([
      'date',
      'vehicleCode',
      'source',
      'driverName',
      'ref',
      'amount',
    ]);
  });

  it('keeps the ledger’s own order when no column is chosen', () => {
    const rows = [row('a'), row('b'), row('c')];
    const sorted = sortCustodyMovements(rows, []);
    expect(ids(sorted)).toEqual(['a', 'b', 'c']);
    expect(sorted, 'a copy, never the caller’s array').not.toBe(rows);
  });

  it('drops a column the ledger does not know, rather than failing', () => {
    const rows = [row('a', { amount: 3 }), row('b', { amount: 1 }), row('c', { amount: 2 })];
    expect(ids(sortCustodyMovements(rows, [{ by: 'nope', dir: 'asc' }]))).toEqual(['a', 'b', 'c']);
    expect(
      ids(
        sortCustodyMovements(rows, [
          { by: 'nope', dir: 'asc' },
          { by: 'amount', dir: 'asc' },
        ]),
      ),
    ).toEqual(['b', 'c', 'a']);
  });

  it('orders by the date, either way', () => {
    const rows = [
      row('mid', { date: new Date('2026-10-02') }),
      row('old', { date: new Date('2026-10-01') }),
      row('new', { date: new Date('2026-10-03') }),
    ];
    expect(ids(sortCustodyMovements(rows, [{ by: 'date', dir: 'asc' }]))).toEqual([
      'old',
      'mid',
      'new',
    ]);
    expect(ids(sortCustodyMovements(rows, [{ by: 'date', dir: 'desc' }]))).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  it('orders the car by the fleet’s code order — «160» before «1500» — with no code last', () => {
    const rows = [
      row('1500', { vehicleCode: '1500' }),
      row('none', { vehicleCode: null }),
      row('160', { vehicleCode: '160' }),
      row('200', { vehicleCode: '200' }),
    ];
    expect(ids(sortCustodyMovements(rows, [{ by: 'vehicleCode', dir: 'asc' }]))).toEqual([
      '160',
      '200',
      '1500',
      'none',
    ]);
    expect(
      ids(sortCustodyMovements(rows, [{ by: 'vehicleCode', dir: 'desc' }])),
      'no code last, the other way too',
    ).toEqual(['1500', '200', '160', 'none']);
  });

  it('orders the kind as the filter lists it — dealership, fuel, tyres, wash', () => {
    const rows = [
      row('wash', { source: 'wash' }),
      row('fuel', { source: 'fuel' }),
      row('dealership', { source: 'dealership', ref: 'dealershipInvoice', driverName: null }),
      row('tyres', { source: 'tyres' }),
    ];
    expect(ids(sortCustodyMovements(rows, [{ by: 'source', dir: 'asc' }]))).toEqual([
      'dealership',
      'fuel',
      'tyres',
      'wash',
    ]);
    expect(ids(sortCustodyMovements(rows, [{ by: 'source', dir: 'desc' }]))).toEqual([
      'wash',
      'tyres',
      'fuel',
      'dealership',
    ]);
  });

  it('orders the driver as a word, and a bill (no driver) last in BOTH directions', () => {
    const rows = [
      row('bill', { driverName: null, ref: 'dealershipInvoice', source: 'dealership' }),
      row('m', { driverName: 'محمد رأفت' }),
      row('a', { driverName: 'أحمد' }),
      row('blank', { driverName: '  ' }),
    ];
    const asc = ids(sortCustodyMovements(rows, [{ by: 'driverName', dir: 'asc' }]));
    expect(asc.slice(0, 2)).toEqual(['a', 'm']);
    expect(asc.slice(2).sort()).toEqual(['bill', 'blank']);
    const desc = ids(sortCustodyMovements(rows, [{ by: 'driverName', dir: 'desc' }]));
    expect(desc.slice(0, 2)).toEqual(['m', 'a']);
    expect(desc.slice(2).sort()).toEqual(['bill', 'blank']);
  });

  it('orders «المصدر» — a receipt, then a dealership bill', () => {
    const rows = [
      row('bill', { ref: 'dealershipInvoice', source: 'dealership', driverName: null }),
      row('receipt', { ref: 'receipt' }),
    ];
    expect(ids(sortCustodyMovements(rows, [{ by: 'ref', dir: 'asc' }]))).toEqual([
      'receipt',
      'bill',
    ]);
    expect(ids(sortCustodyMovements(rows, [{ by: 'ref', dir: 'desc' }]))).toEqual([
      'bill',
      'receipt',
    ]);
  });

  it('orders the amount as a number, not as text', () => {
    const rows = [
      row('315', { amount: 315 }),
      row('1400', { amount: 1400 }),
      row('120', { amount: 120 }),
    ];
    expect(ids(sortCustodyMovements(rows, [{ by: 'amount', dir: 'asc' }]))).toEqual([
      '120',
      '315',
      '1400',
    ]);
    expect(ids(sortCustodyMovements(rows, [{ by: 'amount', dir: 'desc' }]))).toEqual([
      '1400',
      '315',
      '120',
    ]);
  });

  it('closes a tie in the last column’s direction, as `_id` does on the other boards', () => {
    // As the ledger hands them over: newest first, the later entry of one day ahead of the earlier.
    const rows = [
      row('late', { amount: 100 }),
      row('early', { amount: 100 }),
      row('old', { date: new Date('2026-09-30'), amount: 50 }),
    ];
    expect(ids(sortCustodyMovements(rows, [{ by: 'date', dir: 'desc' }]))).toEqual([
      'late',
      'early',
      'old',
    ]);
    expect(
      ids(sortCustodyMovements(rows, [{ by: 'date', dir: 'asc' }])),
      'the exact mirror of the default, the day’s two entries included',
    ).toEqual(['old', 'early', 'late']);
    expect(ids(sortCustodyMovements(rows, [{ by: 'amount', dir: 'asc' }]))).toEqual([
      'old',
      'early',
      'late',
    ]);
    expect(ids(sortCustodyMovements(rows, [{ by: 'amount', dir: 'desc' }]))).toEqual([
      'late',
      'early',
      'old',
    ]);
  });

  it('lets the first column decide and the second break its ties, the rest in the ledger’s order', () => {
    const rows = [
      row('fuel-200', { source: 'fuel', amount: 200 }),
      row('wash-50', { source: 'wash', amount: 50 }),
      row('fuel-100', { source: 'fuel', amount: 100 }),
      row('fuel-100b', { source: 'fuel', amount: 100 }),
    ];
    expect(
      ids(
        sortCustodyMovements(rows, [
          { by: 'source', dir: 'asc' },
          { by: 'amount', dir: 'desc' },
        ]),
      ),
    ).toEqual(['fuel-200', 'fuel-100', 'fuel-100b', 'wash-50']);
    expect(
      ids(
        sortCustodyMovements(rows, [
          { by: 'amount', dir: 'asc' },
          { by: 'source', dir: 'desc' },
        ]),
      ),
    ).toEqual(['wash-50', 'fuel-100', 'fuel-100b', 'fuel-200']);
  });
});
