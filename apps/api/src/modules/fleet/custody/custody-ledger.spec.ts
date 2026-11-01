// «سجل العهدة», folded: the operations and, between them, one «صرف» row per run of receipts — with
// the running «إجمالي العهدة» over the whole history. His scenario is the sample's: a charge on
// 01/09, September's receipts, the 29/09 replenishment, a charge and a settlement on 05/10, and
// October's receipts in no memo yet.
import { describe, expect, it } from 'vitest';
import { ListFleetCustodyLedgerQuerySchema } from '@ecms/contracts';
import { Types } from 'mongoose';
import {
  custodyLedgerTotals,
  filterCustodyLedger,
  foldCustodyLedger,
  ledgerOperationOf,
  ledgerPlaceOf,
  pageCustodyLedger,
  type LedgerOperation,
  type LedgerReceiptGroup,
} from './custody-ledger';
import { type FleetCustodyOperationDoc } from './custody-operation.model';

const op = (
  id: string,
  kind: LedgerOperation['kind'],
  day: string,
  amount: number,
  extra: Partial<LedgerOperation> = {},
): LedgerOperation => ({
  id,
  kind,
  day,
  from: null,
  to: null,
  amount,
  reason: '',
  memoKinds: [],
  parts: [],
  ...extra,
});

const spent = (
  day: string,
  kind: LedgerReceiptGroup['kind'],
  memoNo: number | null,
  count: number,
  amount: number,
): LedgerReceiptGroup => ({ day, kind, memoNo, count, amount });

const OPS: LedgerOperation[] = [
  op('charge-1', 'charge', '2026-09-01', 100000, { reason: 'تشغيل السيارات لشهر سبتمبر' }),
  op('replenish-1', 'replenish', '2026-09-29', 81908, {
    from: '2026-09-01',
    to: '2026-09-30',
    memoKinds: ['tyres', 'tyres', 'fuel', 'maintenance', 'maintenance'],
  }),
  op('charge-2', 'charge', '2026-10-05', 200000, { reason: '24 سياره تجديد + 23 سياره مد مده' }),
  op('settle-1', 'settle', '2026-10-05', 124139.46, {
    from: '2026-09-01',
    to: '2026-09-30',
    parts: [
      { part: 'renewal', cars: 5 },
      { part: 'renewal', cars: 5 },
      { part: 'renewal', cars: 5 },
    ],
  }),
];

// September: memos 1–5 and the four washing receipts in none (82,508); October: 15,286 in none.
const RECEIPTS: LedgerReceiptGroup[] = [
  spent('2026-10-18', 'tyres', null, 8, 790),
  spent('2026-09-01', 'fuel', 3, 55, 49844),
  spent('2026-09-01', 'tyres', 1, 10, 1690),
  spent('2026-09-16', 'tyres', 2, 6, 960),
  spent('2026-09-02', 'maintenance', 4, 3, 5720),
  spent('2026-09-15', 'maintenance', 5, 11, 23694),
  spent('2026-09-28', 'wash', null, 4, 600),
  spent('2026-10-06', 'tyres', null, 10, 900),
  spent('2026-10-06', 'fuel', null, 8, 7876),
  spent('2026-10-08', 'maintenance', null, 3, 5720),
];

const query = (raw: Record<string, unknown> = {}) => ListFleetCustodyLedgerQuerySchema.parse(raw);

describe('foldCustodyLedger — his scenario', () => {
  const rows = foldCustodyLedger(OPS, RECEIPTS);

  it('gives the sample’s six rows, oldest first, and their «بعدها»', () => {
    expect(rows.map((row) => [row.op, row.date, row.dateTo, row.amount, row.after])).toEqual([
      ['charge', '2026-09-01', null, 100000, 100000],
      ['spend', '2026-09-01', '2026-09-28', -82508, 17492],
      ['replenish', '2026-09-29', null, 81908, 99400],
      ['charge', '2026-10-05', null, 200000, 299400],
      ['settle', '2026-10-05', null, -124139.46, 175260.54],
      ['spend', '2026-10-06', '2026-10-18', -15286, 159974.54],
    ]);
    expect(rows.map((row) => row.before)).toEqual([0, 100000, 17492, 99400, 299400, 175260.54]);
  });

  it('puts a day’s operations before that day’s receipts', () => {
    // The 01/09 charge comes first, then 01/09's spending.
    expect(rows[0]?.op).toBe('charge');
    expect(rows[1]).toMatchObject({ op: 'spend', date: '2026-09-01' });
  });

  it('collapses a run of receipts into one «صرف» row, per kind, with the memos it touched', () => {
    const september = rows[1];
    expect(september).toMatchObject({
      id: 'spend:2026-09-01:2026-09-28',
      receipts: 89,
      memoNos: [1, 2, 3, 4, 5],
      reason: null,
      memos: null,
      licence: null,
    });
    expect(september?.byKind).toEqual({
      maintenance: { count: 14, amount: 29414, outside: 0 },
      fuel: { count: 55, amount: 49844, outside: 0 },
      tyres: { count: 16, amount: 2650, outside: 0 },
      wash: { count: 4, amount: 600, outside: 4 },
    });
    expect(rows[5]?.byKind).toEqual({
      maintenance: { count: 3, amount: 5720, outside: 3 },
      fuel: { count: 8, amount: 7876, outside: 8 },
      tyres: { count: 18, amount: 1690, outside: 18 },
      wash: { count: 0, amount: 0, outside: 0 },
    });
    expect(rows[5]?.memoNos).toEqual([]);
  });

  it('carries each operation’s own facts', () => {
    expect(rows[0]).toMatchObject({ reason: 'تشغيل السيارات لشهر سبتمبر', from: null, to: null });
    expect(rows[2]).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      memos: { count: 5, kinds: ['maintenance', 'fuel', 'tyres'] },
      reason: null,
      receipts: null,
      byKind: null,
      memoNos: null,
    });
    expect(rows[4]?.licence).toEqual({
      renewal: { count: 3, cars: 15 },
      extension: { count: 0, cars: 0 },
    });
  });

  it('marks only the last row of the whole history as «الآن»', () => {
    expect(rows.map((row) => row.latest)).toEqual([false, false, false, false, false, true]);
  });

  it('places an operation in the fund', () => {
    expect(ledgerPlaceOf(rows, 'settle-1')).toEqual({ before: 299400, after: 175260.54 });
    expect(ledgerPlaceOf(rows, 'nothing')).toBeNull();
    expect(ledgerPlaceOf(rows, 'spend:2026-09-01:2026-09-28'), 'a «صرف» row is no operation').toBe(
      null,
    );
  });
});

describe('foldCustodyLedger — edges', () => {
  it('is empty with no history at all', () => {
    expect(foldCustodyLedger([], [])).toEqual([]);
  });

  it('opens on a «صرف» row below zero when receipts came before any charge', () => {
    const rows = foldCustodyLedger(
      [op('c', 'charge', '2026-09-10', 1000)],
      [spent('2026-09-01', 'fuel', null, 2, 300), spent('2026-09-10', 'wash', null, 1, 50)],
    );
    expect(rows.map((row) => [row.op, row.before, row.after])).toEqual([
      ['spend', 0, -300],
      ['charge', -300, 700],
      ['spend', 700, 650],
    ]);
    expect(rows[2]?.latest).toBe(true);
  });

  it('keeps the order operations of one day were recorded in, and sums to the piastre', () => {
    const rows = foldCustodyLedger(
      [op('a', 'charge', '2026-09-01', 0.1), op('b', 'charge', '2026-09-01', 0.2)],
      [spent('2026-09-01', 'fuel', null, 1, 0.3)],
    );
    expect(rows.map((row) => [row.id, row.after])).toEqual([
      ['a', 0.1],
      ['b', 0.3],
      ['spend:2026-09-01:2026-09-01', 0],
    ]);
  });

  it('a settlement larger than the fund leaves it negative', () => {
    const rows = foldCustodyLedger(
      [op('c', 'charge', '2026-09-01', 100), op('s', 'settle', '2026-09-02', 250)],
      [],
    );
    expect(rows.at(-1)).toMatchObject({ op: 'settle', amount: -250, after: -150, latest: true });
  });
});

describe('the ledger page — filters pick rows, never change them', () => {
  const rows = foldCustodyLedger(OPS, RECEIPTS);

  it('filters by «العملية» and by day overlap, with every «بعدها» as folded', () => {
    const charges = filterCustodyLedger(rows, { op: ['charge'] });
    expect(charges.map((row) => [row.id, row.after])).toEqual([
      ['charge-1', 100000],
      ['charge-2', 299400],
    ]);
    // A «صرف» run overlapping the window is kept whole.
    const window = filterCustodyLedger(rows, {
      from: new Date('2026-09-20T00:00:00Z'),
      to: new Date('2026-10-05T00:00:00Z'),
    });
    expect(window.map((row) => row.id)).toEqual([
      'spend:2026-09-01:2026-09-28',
      'replenish-1',
      'charge-2',
      'settle-1',
    ]);
    expect(window.map((row) => row.after)).toEqual([17492, 99400, 299400, 175260.54]);
  });

  it('pages newest first by default, oldest first on `date:asc`', () => {
    const newest = pageCustodyLedger(rows, query({ pageSize: 2 }));
    expect(newest.items.map((row) => row.id)).toEqual(['spend:2026-10-06:2026-10-18', 'settle-1']);
    expect(newest.meta).toEqual({ page: 1, pageSize: 2, totalItems: 6, totalPages: 3 });
    // Same-day rows turn round with the rest: the settle was recorded after the charge.
    const second = pageCustodyLedger(rows, query({ pageSize: 2, page: 2 }));
    expect(second.items.map((row) => row.id)).toEqual(['charge-2', 'replenish-1']);
    const oldest = pageCustodyLedger(rows, query({ sort: 'date:asc', pageSize: 3 }));
    expect(oldest.items.map((row) => row.id)).toEqual([
      'charge-1',
      'spend:2026-09-01:2026-09-28',
      'replenish-1',
    ]);
    expect(pageCustodyLedger(rows, query({ sortBy: 'date', sortDir: 'asc' })).items[0]?.id).toBe(
      'charge-1',
    );
  });

  it('filters before it pages, and an empty page still says one page', () => {
    const spends = pageCustodyLedger(rows, query({ op: 'spend' }));
    expect(spends.items.map((row) => row.op)).toEqual(['spend', 'spend']);
    expect(spends.meta.totalItems).toBe(2);
    const none = pageCustodyLedger(rows, query({ from: '2030-01-01' }));
    expect(none).toEqual({
      items: [],
      meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 },
    });
  });

  it('counts operations and «صرف» rows over the same filters', () => {
    expect(custodyLedgerTotals(rows, {})).toEqual({ operations: 4, spendLines: 2 });
    expect(custodyLedgerTotals(rows, { op: ['replenish', 'spend'] })).toEqual({
      operations: 1,
      spendLines: 2,
    });
    expect(custodyLedgerTotals(rows, { from: new Date('2026-10-06T00:00:00Z') })).toEqual({
      operations: 0,
      spendLines: 1,
    });
  });
});

// ── «استعاضة معلّقة لحين التحويل» ──────────────────────────────────────────────────────────────

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const TRANSFER = {
  date: '2026-10-01',
  reference: 'TRF-2026-4471',
  note: '',
  byName: 'أحمد علي',
  at: '2026-10-01T09:00:00.000Z',
};

/** His 29/09 replenishment, as the fold reads it in each of its three states. */
const replenish = (status: 'held' | 'done' | 'cancelled'): LedgerOperation => ({
  ...(OPS[1] as LedgerOperation),
  status,
  at: '2026-09-29T08:00:00.000Z',
  ...(status === 'done'
    ? { day: '2026-10-01', letterDay: '2026-09-29', at: TRANSFER.at, transfer: TRANSFER }
    : {}),
  ...(status === 'cancelled'
    ? { cancellation: { reason: '', byName: null, at: '2026-09-30T10:00:00.000Z' } }
    : {}),
});
const withReplenish = (status: 'held' | 'done' | 'cancelled'): LedgerOperation[] =>
  OPS.map((one) => (one.id === 'replenish-1' ? replenish(status) : one));

describe('foldCustodyLedger — a replenishment held for its transfer', () => {
  it('sits on its letter’s day and adds nothing: before === after, `amount` what it would add', () => {
    const rows = foldCustodyLedger(withReplenish('held'), RECEIPTS);
    const held = rows.find((row) => row.id === 'replenish-1');
    expect(held).toMatchObject({
      status: 'held',
      date: '2026-09-29',
      letterDate: null,
      amount: 81908,
      before: 17492,
      after: 17492,
      transfer: null,
      cancellation: null,
    });
    // Everything after it is 81,908 lower than with the money in.
    expect(rows.map((row) => row.after)).toEqual([
      100000, 17492, 17492, 217492, 93352.54, 78066.54,
    ]);
    expect(ledgerPlaceOf(rows, 'replenish-1')).toEqual({ before: 17492, after: 17492 });
  });

  it('is «الآن» when it is the last row, still adding nothing', () => {
    const rows = foldCustodyLedger(
      [
        op('c', 'charge', '2026-09-01', 1000),
        { ...op('r', 'replenish', '2026-09-02', 400), status: 'held' },
      ],
      [],
    );
    expect(rows.at(-1)).toMatchObject({ id: 'r', latest: true, before: 1000, after: 1000 });
  });

  it('still closes the open «صرف» run, like every operation', () => {
    const rows = foldCustodyLedger(withReplenish('held'), RECEIPTS);
    expect(rows.map((row) => row.id).slice(0, 3)).toEqual([
      'charge-1',
      'spend:2026-09-01:2026-09-28',
      'replenish-1',
    ]);
  });
});

describe('foldCustodyLedger — a transferred replenishment', () => {
  it('sits on the transfer’s day with its letter’s day kept — the sample’s six «بعدها»', () => {
    const rows = foldCustodyLedger(withReplenish('done'), RECEIPTS);
    expect(rows.map((row) => [row.op, row.date, row.after])).toEqual([
      ['charge', '2026-09-01', 100000],
      ['spend', '2026-09-01', 17492],
      ['replenish', '2026-10-01', 99400],
      ['charge', '2026-10-05', 299400],
      ['settle', '2026-10-05', 175260.54],
      ['spend', '2026-10-06', 159974.54],
    ]);
    expect(rows[2]).toMatchObject({
      status: 'done',
      letterDate: '2026-09-29',
      before: 17492,
      transfer: TRANSFER,
      cancellation: null,
    });
  });

  it('orders a day by when each was recorded — a transfer by when it was confirmed', () => {
    const charge = (at: string) => ({ ...op('c', 'charge', '2026-10-01', 10), at });
    const transferred = { ...replenish('done'), amount: 100 };
    const before = foldCustodyLedger([charge('2026-10-01T08:00:00.000Z'), transferred], []);
    expect(before.map((row) => [row.id, row.after])).toEqual([
      ['c', 10],
      ['replenish-1', 110],
    ]);
    // Recorded after the transfer was confirmed: after it, whatever order they came in.
    const after = foldCustodyLedger([charge('2026-10-01T10:00:00.000Z'), transferred], []);
    expect(after.map((row) => [row.id, row.before])).toEqual([
      ['replenish-1', 0],
      ['c', 100],
    ]);
  });
});

describe('foldCustodyLedger — a cancelled replenishment', () => {
  it('stays on its letter’s day as a row, and never counts', () => {
    const rows = foldCustodyLedger(withReplenish('cancelled'), RECEIPTS);
    expect(rows.find((row) => row.id === 'replenish-1')).toMatchObject({
      status: 'cancelled',
      date: '2026-09-29',
      amount: 81908,
      before: 17492,
      after: 17492,
      cancellation: { reason: '', byName: null, at: '2026-09-30T10:00:00.000Z' },
    });
    expect(rows.at(-1)?.after).toBe(78066.54);
  });

  it('is an operation like the others: «العملية» keeps all three states, and they are counted', () => {
    const rows = foldCustodyLedger(
      [
        ...withReplenish('done'),
        { ...replenish('held'), id: 'replenish-2', day: '2026-10-07', at: '2026-10-07T08:00:00Z' },
        {
          ...replenish('cancelled'),
          id: 'replenish-3',
          day: '2026-10-07',
          at: '2026-10-07T09:00Z',
        },
      ],
      RECEIPTS,
    );
    expect(
      filterCustodyLedger(rows, { op: ['replenish'] }).map((row) => [row.id, row.status]),
    ).toEqual([
      ['replenish-1', 'done'],
      ['replenish-2', 'held'],
      ['replenish-3', 'cancelled'],
    ]);
    expect(custodyLedgerTotals(rows, {})).toEqual({ operations: 6, spendLines: 3 });
  });
});

describe('ledgerOperationOf — a stored operation', () => {
  const stored = (over: Partial<FleetCustodyOperationDoc> = {}): FleetCustodyOperationDoc =>
    ({
      _id: new Types.ObjectId('64b000000000000000000001'),
      kind: 'replenish',
      date: day('2026-09-29'),
      from: day('2026-09-01'),
      to: day('2026-09-30'),
      amount: 81908,
      reason: '',
      memos: [],
      parts: [],
      createdAt: new Date('2026-09-29T08:00:00.000Z'),
      ...over,
    }) as unknown as FleetCustodyOperationDoc;

  it('reads a row from before the statuses exactly as before: done, on its letter’s day', () => {
    expect(ledgerOperationOf(stored())).toMatchObject({
      status: 'done',
      day: '2026-09-29',
      letterDay: null,
      at: '2026-09-29T08:00:00.000Z',
      transfer: null,
      cancellation: null,
    });
    // His four operations stored before the statuses, in the order they were recorded.
    const legacy = OPS.map((one, i) =>
      ledgerOperationOf(
        stored({
          _id: new Types.ObjectId(`64b00000000000000000000${i + 2}`),
          kind: one.kind,
          date: day(one.day),
          amount: one.amount,
          createdAt: new Date(day(one.day).getTime() + i * 1000),
        }),
      ),
    );
    const figures = (rows: ReturnType<typeof foldCustodyLedger>) =>
      rows.map((row) => [row.op, row.status, row.date, row.amount, row.before, row.after]);
    expect(figures(foldCustodyLedger(legacy, RECEIPTS))).toEqual(
      figures(foldCustodyLedger(OPS, RECEIPTS)),
    );
  });

  it('moves a transferred one to the transfer’s day, ordered by the confirmation', () => {
    const transfer = {
      date: day('2026-10-01'),
      reference: 'TRF-2026-4471',
      note: '',
      by: null,
      byName: null,
      at: new Date('2026-10-01T09:00:00.000Z'),
    };
    expect(ledgerOperationOf(stored({ status: 'done', transfer }))).toMatchObject({
      status: 'done',
      day: '2026-10-01',
      letterDay: '2026-09-29',
      at: '2026-10-01T09:00:00.000Z',
      transfer: { date: '2026-10-01', reference: 'TRF-2026-4471', byName: null },
    });
  });

  it('keeps a held or cancelled one on its letter’s day', () => {
    expect(ledgerOperationOf(stored({ status: 'held', transfer: null }))).toMatchObject({
      status: 'held',
      day: '2026-09-29',
      letterDay: null,
    });
    const cancellation = { reason: 'خطأ', by: null, byName: null, at: day('2026-09-30') };
    expect(ledgerOperationOf(stored({ status: 'cancelled', cancellation }))).toMatchObject({
      status: 'cancelled',
      day: '2026-09-29',
      cancellation: { reason: 'خطأ', byName: null, at: '2026-09-30T00:00:00.000Z' },
    });
  });
});
