// «تحويل إلى فرع» — «لو مثلاً فى 10 ماوس .. فممكن أنقل 5 لفرع تاني»: what the register's action can
// do with the items ticked, how the dialog judges each row's quantity, the request it sends, and
// what the toast says — the other store's new items included.
import { describe, expect, it } from 'vitest';
import { IT_CONSUMABLE_TRANSFER_MAX_LINES } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import {
  consumableTransferCheck,
  consumableTransferLine,
  consumableTransferRequest,
  consumableTransferSelection,
  consumablesCreatedWords,
  consumablesTransferredWords,
  type TransferableItem,
} from './consumable-transfer';

const item = (id: string, onHandQty: number, branchId = 'b-hq'): TransferableItem => ({
  id,
  onHandQty,
  branchId,
});

const MICE = item('c-mice', 10);
const CABLES = item('c-cables', 3);
const EMPTY = item('c-empty', 0);
const OCTOBER = item('c-oct', 4, 'b-oct');

describe('what the register’s «تحويل إلى فرع (n)» can do with what is ticked', () => {
  it('nothing ticked is nothing to do', () => {
    expect(consumableTransferSelection([])).toEqual({ state: 'none' });
  });

  it('one store’s items are ready to go, from that store', () => {
    expect(consumableTransferSelection([MICE, CABLES, EMPTY])).toEqual({
      state: 'ready',
      fromBranchId: 'b-hq',
    });
  });

  it('waits, saying why, when they come from two stores', () => {
    expect(consumableTransferSelection([MICE, OCTOBER])).toEqual({ state: 'mixedBranches' });
  });

  it('waits when no ticked item has anything on hand', () => {
    expect(consumableTransferSelection([EMPTY])).toEqual({ state: 'nothingOnHand' });
  });

  it('waits when more lines are ticked than one transfer carries', () => {
    const many = Array.from({ length: IT_CONSUMABLE_TRANSFER_MAX_LINES + 1 }, (_, i) =>
      item(`c-${i}`, 1),
    );
    expect(consumableTransferSelection(many)).toEqual({
      state: 'tooMany',
      max: IT_CONSUMABLE_TRANSFER_MAX_LINES,
    });
  });

  it('counts toward the bound only what is sent — an item with nothing on hand is left out', () => {
    const full = Array.from({ length: IT_CONSUMABLE_TRANSFER_MAX_LINES }, (_, i) =>
      item(`c-${i}`, 1),
    );
    // The bound's worth of stocked lines, and empty ones beside them: the request carries the bound.
    expect(consumableTransferSelection([...full, EMPTY, item('c-empty-2', 0)])).toEqual({
      state: 'ready',
      fromBranchId: 'b-hq',
    });
    const sent = consumableTransferCheck(
      [...full, EMPTY].map((line) => ({ item: line, qty: '1' })),
      'b-oct',
    );
    expect(sent.sending).toHaveLength(IT_CONSUMABLE_TRANSFER_MAX_LINES);
    expect(sent.ready).toBe(true);
    // One stocked line more is one more than a transfer carries.
    expect(consumableTransferSelection([...full, item('c-one-more', 1), EMPTY])).toEqual({
      state: 'tooMany',
      max: IT_CONSUMABLE_TRANSFER_MAX_LINES,
    });
  });
});

describe('one row’s quantity', () => {
  it('starts empty, and empty is not an answer', () => {
    expect(consumableTransferLine({ item: MICE, qty: '' }).problem).toBe('required');
    expect(consumableTransferLine({ item: MICE, qty: '  ' }).problem).toBe('required');
  });

  it('is a whole number of at least one', () => {
    for (const qty of ['0', '2.5', '-1', 'خمسة', '1e2']) {
      expect(consumableTransferLine({ item: MICE, qty }).problem, qty).toBe('wholeNumber');
    }
  });

  it('is no more than the store holds — «10 ماوس … أنقل 5»', () => {
    expect(consumableTransferLine({ item: MICE, qty: '5' })).toEqual({
      item: MICE,
      qty: 5,
      problem: null,
    });
    expect(consumableTransferLine({ item: MICE, qty: '10' }).problem).toBeNull();
    expect(consumableTransferLine({ item: MICE, qty: '11' })).toEqual({
      item: MICE,
      qty: 11,
      problem: 'moreThanOnHand',
    });
  });

  it('has nothing to send when the store holds none — it is left out, not an error', () => {
    expect(consumableTransferLine({ item: EMPTY, qty: '' }).problem).toBe('nothingOnHand');
  });
});

describe('the dialog as a whole', () => {
  const lines = [
    { item: MICE, qty: '5' },
    { item: EMPTY, qty: '' },
    { item: CABLES, qty: '3' },
  ];

  it('is ready with a branch chosen and every row with stock answered', () => {
    const check = consumableTransferCheck(lines, 'b-oct');
    expect(check.ready).toBe(true);
    expect(check.fromBranchId).toBe('b-hq');
    expect(check.sending.map((line) => line.item.id)).toEqual(['c-mice', 'c-cables']);
  });

  it('is not ready with no branch, the same branch, or a row unanswered or too many', () => {
    expect(consumableTransferCheck(lines, '').ready).toBe(false);
    const same = consumableTransferCheck(lines, 'b-hq');
    expect(same.sameBranch).toBe(true);
    expect(same.ready).toBe(false);
    expect(consumableTransferCheck([{ item: MICE, qty: '' }], 'b-oct').ready).toBe(false);
    expect(consumableTransferCheck([{ item: MICE, qty: '12' }], 'b-oct').ready).toBe(false);
  });

  it('is not ready when nothing is left to send, or when the rows come from two stores', () => {
    expect(consumableTransferCheck([{ item: EMPTY, qty: '' }], 'b-oct').ready).toBe(false);
    expect(
      consumableTransferCheck(
        [
          { item: MICE, qty: '1' },
          { item: OCTOBER, qty: '1' },
        ],
        'b-alex',
      ).ready,
    ).toBe(false);
  });

  it('sends each row with stock, by the quantity asked, with the date and the notes when given', () => {
    const check = consumableTransferCheck(lines, 'b-oct');
    expect(consumableTransferRequest(check, 'b-oct', '2026-11-11T09:00', ' للفرع الجديد ')).toEqual(
      {
        toBranchId: 'b-oct',
        at: new Date('2026-11-11T09:00'),
        notes: 'للفرع الجديد',
        lines: [
          { consumableId: 'c-mice', qty: 5 },
          { consumableId: 'c-cables', qty: 3 },
        ],
      },
    );
    expect(consumableTransferRequest(check, 'b-oct', '', '')).toEqual({
      toBranchId: 'b-oct',
      lines: [
        { consumableId: 'c-mice', qty: 5 },
        { consumableId: 'c-cables', qty: 3 },
      ],
    });
    expect(consumableTransferRequest(consumableTransferCheck(lines, ''), '', '', '')).toBeNull();
  });
});

describe('the toast', () => {
  const t = (key: string, params?: Record<string, string | number>): string =>
    translate('ar', key, params);
  const line = (name: string, created: boolean) => ({
    fromConsumableId: 'c-1',
    fromCode: 'CON-00001',
    toConsumableId: 'c-2',
    toCode: 'CON-00002',
    name,
    unit: 'قطعة',
    qty: 1,
    created,
  });

  it('counts the items transferred as Arabic counts them', () => {
    expect(consumablesTransferredWords(t, 'ar', 1, 'أكتوبر')).toBe('حُوِّل صنف واحد إلى أكتوبر');
    expect(consumablesTransferredWords(t, 'ar', 2, 'أكتوبر')).toBe('حُوِّل صنفان إلى أكتوبر');
    expect(consumablesTransferredWords(t, 'ar', 3, 'أكتوبر')).toBe('حُوِّل ٣ أصناف إلى أكتوبر');
    expect(consumablesTransferredWords(t, 'ar', 11, 'أكتوبر')).toBe('حُوِّل ١١ صنفًا إلى أكتوبر');
  });

  it('says which items the other store did not have and now does — and nothing when none', () => {
    expect(consumablesCreatedWords(t, 'ar', { lines: [line('ماوس', false)] }, 'أكتوبر')).toBeNull();
    expect(
      consumablesCreatedWords(
        t,
        'ar',
        { lines: [line('ماوس', true), line('كابل HDMI', false)] },
        'أكتوبر',
      ),
    ).toBe('أُضيف إلى مخزن أكتوبر صنف لم يكن فيه: ماوس');
    expect(
      consumablesCreatedWords(
        t,
        'ar',
        { lines: [line('ماوس', true), line('كابل HDMI', true), line('فلاشة', true)] },
        'أكتوبر',
      ),
    ).toBe('أُضيفت إلى مخزن أكتوبر ٣ أصناف لم تكن فيه: ماوس، كابل HDMI، فلاشة');
  });
});
