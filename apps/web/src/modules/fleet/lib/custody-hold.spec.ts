// «استعاضة معلّقة لحين التحويل» as rules: the statuses (a legacy operation is done), the transfer's
// day (needed, never before the letter's), the bodies sent, the refusals named, the export's note,
// and the steps of «إجمالي العهدة بعد كل عملية» (held and cancelled lines move nothing).
import { describe, expect, it } from 'vitest';
import { type FleetCustodyLedgerRowDto } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { translate } from '../../../platform/localization/i18n';
import {
  cancelHeldBody,
  confirmTransferBody,
  custodyStepRows,
  holdRefusalOf,
  isCancelled,
  isHeld,
  ledgerNoteWithStatus,
  ledgerStatusNote,
  operationStatusOf,
  transferDateProblem,
} from './custody-hold';
import { operationIntro, type LedgerWordsKit } from './custody-ledger-words';

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const kit: LedgerWordsKit = {
  t: ar,
  count: (noun, n) => `${n} ${noun}`,
  form: (n) => (n === 1 ? 'one' : n === 2 ? 'two' : n <= 10 ? 'few' : 'many'),
  cars: (n) => `${n} سيارة`,
  separator: '، ',
  day: (iso) => iso.slice(0, 10).replace(/-/gu, '/'),
};

const row = (over: Partial<FleetCustodyLedgerRowDto>): FleetCustodyLedgerRowDto => ({
  id: 'x',
  op: 'replenish',
  status: 'done',
  date: '2026-09-29',
  dateTo: null,
  letterDate: null,
  amount: 81908,
  before: 17492,
  after: 99400,
  latest: false,
  reason: null,
  from: null,
  to: null,
  memos: { count: 5, kinds: ['tyres'] },
  licence: null,
  receipts: null,
  byKind: null,
  memoNos: null,
  transfer: null,
  cancellation: null,
  ...over,
});

describe('the statuses', () => {
  it('reads a stored operation with no status as done', () => {
    expect(operationStatusOf({})).toBe('done');
    expect(operationStatusOf({ status: null })).toBe('done');
    expect(operationStatusOf({ status: 'held' })).toBe('held');
    expect(isHeld({ status: 'held' })).toBe(true);
    expect(isHeld({})).toBe(false);
    expect(isCancelled({ status: 'cancelled' })).toBe(true);
    expect(isCancelled({ status: 'done' })).toBe(false);
  });
});

describe('«تأكيد التحويل»', () => {
  it('needs a day, never before the letter’s — any later day will do', () => {
    expect(transferDateProblem('', '2026-09-29')).toBe('missing');
    expect(transferDateProblem('2026-9-1', '2026-09-29')).toBe('missing');
    expect(transferDateProblem('2026-09-28', '2026-09-29')).toBe('beforeLetter');
    expect(transferDateProblem('2026-09-29', '2026-09-29')).toBeNull();
    expect(transferDateProblem('2026-10-01', '2026-09-29T00:00:00.000Z')).toBeNull();
    expect(transferDateProblem('2027-12-31', '2026-09-29')).toBeNull();
  });

  it('sends the day as UTC midnight, the reference and note trimmed — the reason too', () => {
    expect(
      confirmTransferBody({ date: '2026-10-01', reference: ' TRF-2026-4471 ', note: '' }),
    ).toEqual({ date: new Date('2026-10-01T00:00:00.000Z'), reference: 'TRF-2026-4471', note: '' });
    expect(cancelHeldBody('  أُلغي الخطاب  ')).toEqual({ reason: 'أُلغي الخطاب' });
    expect(cancelHeldBody('')).toEqual({ reason: '' });
  });

  it('names a refusal: confirmed or cancelled elsewhere (409 / 404), or a day before the letter’s', () => {
    expect(holdRefusalOf(new ApiError('CONFLICT', 'was cancelled', 409))).toBe('taken');
    expect(holdRefusalOf(new ApiError('NOT_FOUND', 'gone', 404))).toBe('taken');
    expect(holdRefusalOf(new ApiError('BUSINESS_RULE_VIOLATION', 'before', 422))).toBe(
      'beforeLetter',
    );
    expect(holdRefusalOf(new ApiError('VALIDATION_FAILED', 'no date', 400))).toBeNull();
    expect(holdRefusalOf(new Error('offline'))).toBeNull();
  });
});

describe('«سجل العهدة»', () => {
  it('the export says a line is held, cancelled, or when its money came', () => {
    expect(ledgerStatusNote(row({ status: 'held' }), kit)).toBe(
      ar('fleet.custody.hold.exportHeld'),
    );
    expect(ledgerStatusNote(row({ status: 'cancelled' }), kit)).toBe(
      ar('fleet.custody.hold.exportCancelled'),
    );
    const transferred = row({
      date: '2026-10-01',
      letterDate: '2026-09-29',
      transfer: { date: '2026-10-01', reference: 'TRF-2026-4471', note: '', byName: null, at: '' },
    });
    expect(ledgerStatusNote(transferred, kit)).toBe(
      [
        ar('fleet.custody.hold.letterOf', { date: '2026/09/29' }),
        ar('fleet.custody.hold.transferredOn', { date: '2026/10/01' }),
        ar('fleet.custody.hold.reference', { ref: 'TRF-2026-4471' }),
      ].join(' — '),
    );
    expect(ledgerStatusNote(row({}), kit)).toBe('');
    expect(ledgerNoteWithStatus('عن الفترة', '')).toBe('عن الفترة');
    expect(ledgerNoteWithStatus('', 'ملغاة')).toBe('ملغاة');
    expect(ledgerNoteWithStatus('عن الفترة', 'ملغاة')).toBe('عن الفترة — ملغاة');
  });

  it('the steps skip held and cancelled lines; the last kept carries «الآن»', () => {
    const newestFirst = [
      row({ id: 'h', status: 'held', latest: true }),
      row({ id: 'c', status: 'cancelled' }),
      row({ id: 'd2' }),
      row({ id: 'd1' }),
    ];
    const steps = custodyStepRows(newestFirst);
    expect(steps.map((s) => s.id)).toEqual(['d1', 'd2']);
    expect(steps.map((s) => s.latest)).toEqual([false, true]);
    expect(custodyStepRows([])).toEqual([]);
  });

  it('the drawer’s sentence follows the status: requested while held, cancelled, replenished', () => {
    const op = {
      kind: 'replenish' as const,
      amount: 81908,
      reason: '',
      from: null,
      to: null,
      parts: [],
      memos: [
        {
          memoId: 'm1',
          no: 1,
          kind: 'tyres' as const,
          name: '',
          from: '2026-09-01',
          to: '2026-09-15',
          receipts: 18,
          amount: 1690,
        },
        {
          memoId: 'm2',
          no: 2,
          kind: 'tyres' as const,
          name: '',
          from: '2026-09-16',
          to: '2026-09-27',
          receipts: 6,
          amount: 960,
        },
      ],
    };
    const say = (status: 'held' | 'done' | 'cancelled'): string =>
      operationIntro({ ...op, status } as never, kit, () => 'X');
    const params = {
      amount: 'X',
      memos: ar('fleet.custody.ledger.detail.twoMemosGenitive'),
      kinds: ar('fleet.custody.source.tyres'),
      period: '',
    };
    expect(say('held')).toBe(ar('fleet.custody.ledger.drawer.intro.replenishHeld', params));
    expect(say('cancelled')).toBe(
      ar('fleet.custody.ledger.drawer.intro.replenishCancelled', params),
    );
    expect(say('done')).toBe(ar('fleet.custody.ledger.drawer.intro.replenish', params));
    // A stored replenishment from before the statuses reads as done.
    expect(operationIntro(op as never, kit, () => 'X')).toBe(say('done'));
  });
});
