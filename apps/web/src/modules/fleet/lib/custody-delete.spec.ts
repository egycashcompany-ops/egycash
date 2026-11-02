// «حذف العملية» as rules: what a delete does per kind and status (the plan's table), the fund after
// it in piastres, the body it sends, the refusals it words, where the operation stands in the log,
// and how «العمليات المحذوفة» reads a deletion — Cairo's clock, not the browser's.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
  type FleetCustodyOperationDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import {
  cairoAt,
  deleteBody,
  deleteBodyKey,
  deleteRefusalOf,
  deleteTitleKey,
  deletedKindsOf,
  deletedLedgerRow,
  deletionDeltaOf,
  deletionEffectOf,
  fundAfterDelete,
  laterOperationsOf,
  laterOperationsQuery,
} from './custody-delete';

const STAMP = '2026-11-01T07:12:00.000Z';
const op = (over: Partial<FleetCustodyOperationDto>): FleetCustodyOperationDto => ({
  id: 'op-1',
  kind: 'charge',
  status: 'done',
  transfer: null,
  cancellation: null,
  date: '2026-11-01',
  from: null,
  to: null,
  amount: 150000,
  reason: 'تراخيص',
  memos: [],
  parts: [],
  fundBefore: 0,
  chargedTotal: 0,
  letterFigure: null,
  signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.charge,
  ledger: null,
  deletion: null,
  createdByName: null,
  version: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});
const MEMOS: FleetCustodyOperationDto['memos'] = [
  {
    memoId: 'm9',
    no: 9,
    kind: 'wash',
    name: '',
    from: '2026-10-01',
    to: '2026-10-25',
    receipts: 3,
    amount: 660,
  },
  {
    memoId: 'm7',
    no: 7,
    kind: 'maintenance',
    name: '',
    from: '2026-10-16',
    to: '2026-10-25',
    receipts: 4,
    amount: 3000,
  },
  {
    memoId: 'm8',
    no: 8,
    kind: 'maintenance',
    name: '',
    from: '2026-10-16',
    to: '2026-10-25',
    receipts: 1,
    amount: 0.1,
  },
];
const PART = (
  part: 'renewal' | 'extension',
  cars: number,
  amount: number,
): FleetCustodyOperationDto['parts'][number] => ({
  expenseId: `lx-${part}`,
  part,
  date: '2026-10-29',
  cars,
  codes: [],
  visaTotal: amount,
  cashTotal: 0,
  amount,
});

describe('what a delete does — the plan’s table', () => {
  it('a charge: the fund less its amount; nothing goes back', () => {
    expect(deletionEffectOf(op({ amount: 150000 }))).toEqual({
      fundDelta: -150000,
      memos: false,
      parts: false,
    });
  });

  it('a transferred replenishment, and a legacy one (no status): the fund less, its memos back', () => {
    const done = op({ kind: 'replenish', amount: 3660.1, memos: MEMOS });
    expect(deletionEffectOf(done)).toEqual({ fundDelta: -3660.1, memos: true, parts: false });
    const legacy = { ...done, status: undefined as unknown as 'done' };
    expect(deletionEffectOf(legacy)).toEqual({ fundDelta: -3660.1, memos: true, parts: false });
  });

  it('a held replenishment: the fund unchanged, its reserved memos back', () => {
    expect(deletionEffectOf(op({ kind: 'replenish', status: 'held', memos: MEMOS }))).toEqual({
      fundDelta: 0,
      memos: true,
      parts: false,
    });
  });

  it('a cancelled replenishment: nothing moves — its memos were freed when it was cancelled', () => {
    expect(deletionEffectOf(op({ kind: 'replenish', status: 'cancelled', memos: MEMOS }))).toEqual({
      fundDelta: 0,
      memos: false,
      parts: false,
    });
  });

  it('a settlement: the fund plus its amount, its licence parts back', () => {
    expect(
      deletionEffectOf(op({ kind: 'settle', amount: 117270.5, parts: [PART('renewal', 26, 1)] })),
    ).toEqual({ fundDelta: 117270.5, memos: false, parts: true });
  });

  it('the fund after it, in whole piastres — and below zero allowed', () => {
    expect(fundAfterDelete(150000, { fundDelta: -200000, memos: false, parts: false })).toBe(
      -50000,
    );
    expect(fundAfterDelete(0.3, { fundDelta: -0.1, memos: false, parts: false })).toBe(0.2);
    expect(fundAfterDelete(17492.55, { fundDelta: 0, memos: true, parts: false })).toBe(17492.55);
    expect(fundAfterDelete(55364.25, { fundDelta: 117270.5, memos: false, parts: true })).toBe(
      172634.75,
    );
  });
});

describe('what it sends, and the refusals it words', () => {
  it('the reason trimmed (optional, at most 500), and the version read', () => {
    expect(deleteBody('  كُتب خطأ  ', 4)).toEqual({ reason: 'كُتب خطأ', version: 4 });
    expect(deleteBody('', 0)).toEqual({ reason: '', version: 0 });
    expect(deleteBody('x'.repeat(600), 1).reason).toHaveLength(500);
  });

  it('409 and 404 are «taken» — changed or deleted since the dialog read it; the rest are not', () => {
    expect(deleteRefusalOf(new ApiError('STALE_DOCUMENT', 'stale', 409))).toBe('taken');
    expect(deleteRefusalOf(new ApiError('NOT_FOUND', 'gone', 404))).toBe('taken');
    expect(deleteRefusalOf(new ApiError('FORBIDDEN', 'no', 403))).toBeNull();
    expect(deleteRefusalOf(new ApiError('VALIDATION_ERROR', 'bad', 400))).toBeNull();
    expect(deleteRefusalOf(new Error('network'))).toBeNull();
  });

  it('the title and the sentence by kind and status', () => {
    expect(deleteTitleKey(op({}))).toBe('fleet.custody.delete.title.charge');
    expect(deleteTitleKey(op({ kind: 'settle' }))).toBe('fleet.custody.delete.title.settle');
    expect(deleteTitleKey(op({ kind: 'replenish' }))).toBe('fleet.custody.delete.title.replenish');
    expect(deleteTitleKey(op({ kind: 'replenish', status: 'held' }))).toBe(
      'fleet.custody.delete.title.replenishHeld',
    );
    expect(deleteTitleKey(op({ kind: 'replenish', status: 'cancelled' }))).toBe(
      'fleet.custody.delete.title.replenish',
    );
    expect(deleteBodyKey(op({}))).toBe('fleet.custody.delete.body.charge');
    expect(deleteBodyKey(op({ kind: 'settle' }))).toBe('fleet.custody.delete.body.settle');
    expect(deleteBodyKey(op({ kind: 'replenish' }))).toBe('fleet.custody.delete.body.replenish');
    expect(deleteBodyKey(op({ kind: 'replenish', status: 'held' }))).toBe(
      'fleet.custody.delete.body.replenishHeld',
    );
    expect(deleteBodyKey(op({ kind: 'replenish', status: 'cancelled' }))).toBe(
      'fleet.custody.delete.body.replenishCancelled',
    );
  });
});

describe('where it stands in the log', () => {
  it('asks for the three operations from its day on, oldest first, one full page', () => {
    expect(laterOperationsQuery({ date: '2026-11-01' })).toEqual({
      op: ['charge', 'replenish', 'settle'],
      from: '2026-11-01',
      page: 1,
      pageSize: 100,
      sort: 'date:asc',
    });
  });

  it('counts the operations after it — over every page, not only the one read', () => {
    const page = {
      items: [
        { id: 'a0', op: 'charge' as const },
        { id: 'op-1', op: 'charge' as const },
        { id: 'a1', op: 'settle' as const },
      ],
      meta: { totalItems: 140 },
    };
    expect(laterOperationsOf(page, 'op-1')).toBe(138);
    expect(laterOperationsOf({ ...page, meta: { totalItems: 3 } }, 'op-1')).toBe(1);
    expect(laterOperationsOf({ ...page, meta: { totalItems: 3 } }, 'a1')).toBe(0);
  });

  it('unknown while unread, or when it is not on the page — never a receipts line', () => {
    expect(laterOperationsOf(undefined, 'op-1')).toBeNull();
    expect(laterOperationsOf({ items: [], meta: { totalItems: 0 } }, 'op-1')).toBeNull();
    expect(
      laterOperationsOf(
        { items: [{ id: 'op-1', op: 'spend' as const }], meta: { totalItems: 1 } },
        'op-1',
      ),
    ).toBeNull();
  });
});

describe('«العمليات المحذوفة» — how a deletion reads', () => {
  it('Cairo’s date and 24-hour clock — winter (UTC+2) and summer (UTC+3)', () => {
    expect(cairoAt('2026-11-01T07:12:00.000Z')).toEqual({ day: '2026/11/01', time: '09:12' });
    expect(cairoAt('2026-07-15T21:30:00.000Z')).toEqual({ day: '2026/07/16', time: '00:30' });
  });

  it('a delete late at night falls on Cairo’s next day, not UTC’s', () => {
    expect(cairoAt('2026-10-31T22:30:00.000Z')).toEqual({ day: '2026/11/01', time: '00:30' });
    expect(cairoAt('2026-11-01T21:59:00.000Z')).toEqual({ day: '2026/11/01', time: '23:59' });
    expect(cairoAt('2026-11-01T22:00:00.000Z')).toEqual({ day: '2026/11/02', time: '00:00' });
  });

  it('a value that is not an instant keeps its first ten characters and no time', () => {
    expect(cairoAt('not a day at all')).toEqual({ day: 'not a day ', time: '' });
  });

  it('what the delete did to the fund — after less before, in piastres', () => {
    expect(deletionDeltaOf({ fundBefore: 15000, fundAfter: 0 })).toBe(-15000);
    expect(deletionDeltaOf({ fundBefore: 55364.25, fundAfter: 172634.75 })).toBe(117270.5);
    expect(deletionDeltaOf({ fundBefore: 173383.75, fundAfter: 173383.75 })).toBe(0);
  });

  it('«العملية» from the address — only the three operations', () => {
    expect(deletedKindsOf('charge,settle,spend,')).toEqual(['charge', 'settle']);
    expect(deletedKindsOf(null)).toEqual([]);
  });

  it('reads a deleted operation as the log read it — its words, never its old running figures', () => {
    const replenish = deletedLedgerRow(
      op({ kind: 'replenish', amount: 3660.1, memos: MEMOS, from: '2026-10-01', to: '2026-10-31' }),
    );
    expect(replenish).toMatchObject({
      op: 'replenish',
      amount: 3660.1,
      before: 0,
      after: 0,
      latest: false,
      reason: null,
      from: '2026-10-01',
      to: '2026-10-31',
      memos: { count: 3, kinds: ['maintenance', 'wash'] },
      licence: null,
    });
    const settle = deletedLedgerRow(
      op({
        kind: 'settle',
        amount: 117270.5,
        parts: [PART('renewal', 26, 100000), PART('extension', 4, 17270.5)],
      }),
    );
    expect(settle.amount).toBe(-117270.5);
    expect(settle.licence).toEqual({
      renewal: { count: 1, cars: 26 },
      extension: { count: 1, cars: 4 },
    });
    expect(deletedLedgerRow(op({})).reason).toBe('تراخيص');
  });
});
