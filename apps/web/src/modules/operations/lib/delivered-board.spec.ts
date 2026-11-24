// Round 33 B — «الشحنات المسلَّمة» as the screen reads it: a row's state and colour, «بدون صورة», the
// two sides of «البنك الذي تُحتسب عليه تكلفة النقل», the dialog's checks and body, what a refusal
// means for it, the day it opens on, and the board's own «حالة التأكيد» filter. Round 33 C — the
// receipt's number as its own column prints it, and its «رقم الإيصال» box.
import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX,
  type OperationsDayBoardBranchDto,
  type OperationsDeliveredShipmentDto,
  type OperationsDeliveryConfirmationDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import {
  BOARD_LOOKUP_PARAMS,
  EMPTY_DAY_BOARD_FILTERS,
  boardFilterParams,
  deliveredReceiptNumber,
  filterDayBoard,
  hasActiveFilter,
  isDeliveryConfirmed,
  matchesReceiptNumber,
  offeredFilters,
  readDayBoardFilters,
  rememberedFilterParams,
  rowTint,
} from './day-board';
import {
  billedSideAfterKey,
  billedSideOptions,
  billedSideTabStop,
  defaultDayLeft,
  deliveredDialogRow,
  deliveredRowTint,
  deliveredStateOf,
  deliveryDraftProblems,
  deliveryDraftReady,
  deliveryRefusalOf,
  deliveryRequestBody,
  lacksReceiptPhoto,
  readDeliveredDay,
  sameBankBothSides,
} from './delivered-board';

const branch = (
  id: string,
  bankId: string,
  bankName: string,
  code = 'C',
): OperationsDayBoardBranchDto => ({
  id,
  name: `فرع ${id}`,
  code,
  bankId,
  bankName,
});
const CONFIRMATION: OperationsDeliveryConfirmationDto = {
  receiptNumber: 'RC-1',
  billedSide: 'origin',
  billedBranchId: 'o',
  billedBankId: 'b-ahly',
  billedBankName: 'الأهلي',
  confirmedById: 'u-1',
  confirmedByName: 'أحمد',
  confirmedAt: '2026-11-20T10:00:00.000Z',
};
const row = (over: Partial<OperationsDeliveredShipmentDto> = {}): OperationsDeliveredShipmentDto =>
  ({
    id: 's-1',
    shipmentType: 'daily',
    status: 'draft',
    mainBankId: 'b-ahly',
    secondaryBankId: null,
    originBranchId: 'o',
    destinationBranchId: 'd',
    areaName: null,
    lines: [],
    collectionDate: '2026-11-20T00:00:00.000Z',
    deliveryDate: null,
    receiptNumber: null,
    vaultReceiptNumber: null,
    receiptImage: null,
    serialTracked: false,
    notes: null,
    receivedById: null,
    receivedAt: null,
    version: 3,
    createdAt: '2026-11-20T06:00:00.000Z',
    updatedAt: '2026-11-20T06:00:00.000Z',
    origin: branch('o', 'b-ahly', 'الأهلي', 'A-1'),
    destination: branch('d', 'b-misr', 'مصر', ''),
    crew: null,
    captainDeliveredAt: '2026-11-20T08:15:00.000Z',
    securedStage: null,
    pickedUpBy: null,
    pickedUpAt: null,
    deliveryConfirmation: null,
    ...over,
  }) as OperationsDeliveredShipmentDto;

const IMAGE = {
  fileId: 'f-1',
  fileName: 'receipt.png',
  mime: 'image/png',
  size: 10,
  uploadedAt: '2026-11-20T10:00:00.000Z',
};

describe('a delivered row — «هتظهرلى لما تكون تم التسليم»', () => {
  it('awaits its ✓ in the day board’s yellow, and is green once confirmed', () => {
    expect(deliveredStateOf(row())).toBe('awaiting');
    expect(deliveredRowTint(row())).toBe(rowTint('captain'));
    const confirmed = row({ deliveryConfirmation: CONFIRMATION });
    expect(deliveredStateOf(confirmed)).toBe('confirmed');
    expect(deliveredRowTint(confirmed)).toBe(rowTint('desk'));
    expect(isDeliveryConfirmed(confirmed)).toBe(true);
    // Any other board's row carries no such field — never confirmed.
    expect(isDeliveryConfirmed({})).toBe(false);
  });

  it('says «بدون صورة» on a CONFIRMED row without a photo only — «اختيارية مع تنبيه»', () => {
    expect(lacksReceiptPhoto(row({ deliveryConfirmation: CONFIRMATION }))).toBe(true);
    expect(
      lacksReceiptPhoto(row({ deliveryConfirmation: CONFIRMATION, receiptImage: IMAGE })),
    ).toBe(false);
    // Awaiting its ✓, the dialog asks for the photo; the row says nothing yet.
    expect(lacksReceiptPhoto(row())).toBe(false);
  });
});

describe('«يحدد البنك من او الى» — the two sides', () => {
  it('offers exactly «من» then «إلى», each by its bank and its branch', () => {
    expect(billedSideOptions(row())).toEqual([
      {
        side: 'origin',
        bankId: 'b-ahly',
        bankName: 'الأهلي',
        branchName: 'فرع o (A-1)',
        available: true,
      },
      {
        side: 'destination',
        bankId: 'b-misr',
        bankName: 'مصر',
        branchName: 'فرع d',
        available: true,
      },
    ]);
    expect(sameBankBothSides(row())).toBe(false);
  });

  it('says when both branches are of one bank — the side is still chosen', () => {
    const one = row({ destination: branch('d', 'b-ahly', 'الأهلي') });
    expect(sameBankBothSides(one)).toBe(true);
    expect(billedSideOptions(one).map((o) => o.bankId)).toEqual(['b-ahly', 'b-ahly']);
  });

  it('offers a side whose branch record is gone, but not to be chosen', () => {
    const gone = billedSideOptions(row({ origin: null }));
    expect(gone[0]).toMatchObject({ side: 'origin', available: false, bankId: null });
    expect(gone[1]?.available).toBe(true);
    expect(sameBankBothSides(row({ origin: null }))).toBe(false);
  });
});

describe('the ✓’s dialog — «لازم يكون فيه رقم الايصال»', () => {
  it('requires the number (trimmed, capped) and the side; the photo is not asked for', () => {
    expect(deliveryDraftProblems({ receiptNumber: '', billedSide: null })).toEqual({
      receiptNumber: 'required',
      billedSide: 'required',
    });
    expect(deliveryDraftProblems({ receiptNumber: '   ', billedSide: 'origin' })).toEqual({
      receiptNumber: 'required',
      billedSide: null,
    });
    expect(
      deliveryDraftProblems({
        receiptNumber: 'x'.repeat(OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX + 1),
        billedSide: 'destination',
      }).receiptNumber,
    ).toBe('tooLong');
    expect(deliveryDraftReady({ receiptNumber: ' RC-9 ', billedSide: 'destination' })).toBe(true);
    expect(deliveryDraftReady({ receiptNumber: 'RC-9', billedSide: null })).toBe(false);
  });

  it('sends the number trimmed, the side and the version — never a bank or a person', () => {
    const body = deliveryRequestBody({ receiptNumber: '  RC-9 ', billedSide: 'destination' }, 7);
    expect(body).toEqual({ receiptNumber: 'RC-9', billedSide: 'destination', version: 7 });
    expect(Object.keys(body).sort()).toEqual(['billedSide', 'receiptNumber', 'version']);
  });

  it('reads a refusal: the box the server named, a row that moved, or anything else', () => {
    const err = (code: string, status: number) => new ApiError(code, code, status);
    expect(deliveryRefusalOf(err('OPERATIONS_DELIVERY_RECEIPT_NUMBER_REQUIRED', 422))).toEqual({
      kind: 'receiptNumber',
      problem: 'required',
    });
    expect(deliveryRefusalOf(err('OPERATIONS_DELIVERY_RECEIPT_NUMBER_TOO_LONG', 422))).toEqual({
      kind: 'receiptNumber',
      problem: 'tooLong',
    });
    expect(deliveryRefusalOf(err('OPERATIONS_DELIVERY_BILLED_SIDE_REQUIRED', 422))).toEqual({
      kind: 'billedSide',
    });
    for (const code of [
      'OPERATIONS_SHIPMENT_NOT_DELIVERED',
      'OPERATIONS_DELIVERY_ALREADY_CONFIRMED',
      'STALE_DOCUMENT',
      'NOT_FOUND',
    ]) {
      expect(deliveryRefusalOf(err(code, 409))).toEqual({ kind: 'stale', code });
    }
    expect(deliveryRefusalOf(err('INTERNAL', 500))).toBeNull();
    expect(deliveryRefusalOf(new Error('offline'))).toBeNull();
  });
});

describe('the day it opens on — «الأيام اللى فاتت» included', () => {
  const TODAY = '2026-11-23';
  // Rewritten (Round 33 critic): «is today by default, any real day before it when asked, never a
  // later one» named TODAY — the PC's — in the request. The default now names NO day (null): the
  // server answers its own Cairo today and says it, and `today` here is that word once a read is in.
  it('asks a real day before today by name, else NO day — the server’s own today (Round 33 critic)', () => {
    expect(readDeliveredDay(new URLSearchParams(), TODAY)).toBeNull();
    expect(readDeliveredDay(new URLSearchParams('date=2026-11-01'), TODAY)).toBe('2026-11-01');
    expect(readDeliveredDay(new URLSearchParams('date=2025-12-31'), TODAY)).toBe('2025-12-31');
    expect(readDeliveredDay(new URLSearchParams('date=2026-11-22'), TODAY)).toBe('2026-11-22');
    // Today itself, a later day, or no real day: the default — asked for by no name.
    expect(readDeliveredDay(new URLSearchParams(`date=${TODAY}`), TODAY)).toBeNull();
    expect(readDeliveredDay(new URLSearchParams('date=2026-11-24'), TODAY)).toBeNull();
    expect(readDeliveredDay(new URLSearchParams('date=2026-02-30'), TODAY)).toBeNull();
    expect(readDeliveredDay(new URLSearchParams('date=yesterday'), TODAY)).toBeNull();
  });

  it('a PC clock a day off never decides the day — the bound is the server’s once it is known', () => {
    // The PC a day AHEAD: its «today» asked by name before the read is in would be an empty
    // tomorrow — it is the default instead, and the server's today bounds it once said.
    expect(readDeliveredDay(new URLSearchParams('date=2026-11-24'), '2026-11-24')).toBeNull();
    expect(readDeliveredDay(new URLSearchParams('date=2026-11-24'), '2026-11-23')).toBeNull();
    // The PC a day BEHIND: the server's today is reached as the default, and a day before it by
    // name — the PC's own bound would have turned that day back into the PC's.
    expect(readDeliveredDay(new URLSearchParams('date=2026-11-22'), '2026-11-23')).toBe(
      '2026-11-22',
    );
    expect(readDeliveredDay(new URLSearchParams('date=2026-11-23'), '2026-11-23')).toBeNull();
  });

  it('says the day the default left when it moves on — once, never on a first read or a pick', () => {
    expect(defaultDayLeft('2026-11-23', '2026-11-24')).toBe('2026-11-23');
    expect(defaultDayLeft(null, '2026-11-24')).toBeNull();
    expect(defaultDayLeft('2026-11-24', '2026-11-24')).toBeNull();
    expect(defaultDayLeft('2026-11-24', null)).toBeNull();
    // A server day that went BACK (a request answered just before midnight) is no news.
    expect(defaultDayLeft('2026-11-24', '2026-11-23')).toBeNull();
  });
});

describe('the ✓’s dialog outlives Cairo midnight — Round 33 critic', () => {
  const opened = { row: row({ id: 'a', version: 3 }), day: '2026-11-23' };
  const readOf = (date: string, shipments: OperationsDeliveredShipmentDto[]) => ({
    date,
    shipments,
  });

  it('follows its row on its own day’s read, and closes when the row left that day', () => {
    const fresh = row({ id: 'a', version: 4 });
    expect(deliveredDialogRow(opened, readOf('2026-11-23', [row({ id: 'b' }), fresh]))).toBe(fresh);
    // Deleted, or its delivery taken back: gone from its day — the dialog closes.
    expect(deliveredDialogRow(opened, readOf('2026-11-23', [row({ id: 'b' })]))).toBeNull();
    expect(deliveredDialogRow(null, readOf('2026-11-23', [fresh]))).toBeNull();
  });

  it('stays on the row it was opened on while the screen reads another day, or none', () => {
    // Midnight passed on the default: the new day's read is loading…
    expect(deliveredDialogRow(opened, undefined)).toBe(opened.row);
    // …or in, without the row — the number typed, the side and the photo are not thrown away.
    expect(deliveredDialogRow(opened, readOf('2026-11-24', []))).toBe(opened.row);
    expect(deliveredDialogRow(opened, readOf('2026-11-24T00:00:00.000Z', []))).toBe(opened.row);
  });
});

describe('«من» / «إلى» — one radio group: one Tab stop, the arrows inside (Round 33 critic)', () => {
  const both = billedSideOptions(row());
  const originGone = billedSideOptions(row({ origin: null }));

  it('stops Tab on the side chosen, else the first that can be chosen', () => {
    expect(billedSideTabStop(both, null)).toBe('origin');
    expect(billedSideTabStop(both, 'destination')).toBe('destination');
    expect(billedSideTabStop(originGone, null)).toBe('destination');
    expect(
      billedSideTabStop(billedSideOptions(row({ origin: null, destination: null })), null),
    ).toBeNull();
  });

  it('moves and chooses with the arrows in the reading direction, wrapping round', () => {
    // Arabic: «من» stands at the right, «إلى» to its left.
    expect(billedSideAfterKey(both, null, 'ArrowLeft', true)).toBe('destination');
    expect(billedSideAfterKey(both, 'origin', 'ArrowLeft', true)).toBe('destination');
    expect(billedSideAfterKey(both, 'destination', 'ArrowLeft', true)).toBe('origin');
    expect(billedSideAfterKey(both, 'destination', 'ArrowRight', true)).toBe('origin');
    // English: the next side is to the right.
    expect(billedSideAfterKey(both, 'origin', 'ArrowRight', false)).toBe('destination');
    expect(billedSideAfterKey(both, 'origin', 'ArrowLeft', false)).toBe('destination');
    // A column on a phone: down is next in both languages.
    expect(billedSideAfterKey(both, 'origin', 'ArrowDown', true)).toBe('destination');
    expect(billedSideAfterKey(both, 'destination', 'ArrowUp', false)).toBe('origin');
  });

  it('skips a side that cannot be chosen, and ignores every other key', () => {
    expect(billedSideAfterKey(originGone, null, 'ArrowLeft', true)).toBe('destination');
    expect(billedSideAfterKey(originGone, 'destination', 'ArrowDown', true)).toBe('destination');
    expect(billedSideAfterKey(both, 'origin', 'Tab', true)).toBeNull();
    expect(billedSideAfterKey(both, 'origin', 'Enter', true)).toBeNull();
    expect(
      billedSideAfterKey(
        billedSideOptions(row({ origin: null, destination: null })),
        null,
        'ArrowDown',
        true,
      ),
    ).toBeNull();
  });
});

describe('«بانتظار التأكيد» / «مؤكَّدة» / «الكل» — the board’s own filter', () => {
  const rows = [
    row({ id: 'a' }),
    row({ id: 'c', deliveryConfirmation: CONFIRMATION }),
    row({ id: 's', shipmentType: 'secured', status: 'dispatched', securedStage: 'dispatched' }),
  ];
  const run = (over: Partial<typeof EMPTY_DAY_BOARD_FILTERS>) =>
    filterDayBoard(
      rows,
      { ...EMPTY_DAY_BOARD_FILTERS, ...over },
      () => '',
      () => '',
    ).map((r) => r.id);

  it('narrows by the confirmation, and «الكل» is the box left empty', () => {
    expect(run({ confirmed: 'no' })).toEqual(['a', 's']);
    expect(run({ confirmed: 'yes' })).toEqual(['c']);
    expect(run({})).toEqual(['a', 'c', 's']);
    // The day board's «النوع» still works beside it.
    expect(run({ confirmed: 'no', type: 'secured' })).toEqual(['s']);
  });

  // Round 33 C — REWRITTEN from «is read from the URL, and only that board offers it» (nine boxes,
  // the day board's count): «رقم الإيصال» joined after «ملاحظات», as its column did.
  it('is read from the URL, and only that board offers it — ten boxes, «رقم الإيصال» last', () => {
    expect(readDayBoardFilters(new URLSearchParams('confirmed=yes')).confirmed).toBe('yes');
    expect(readDayBoardFilters(new URLSearchParams('confirmed=all')).confirmed).toBe('');
    const all = { ...EMPTY_DAY_BOARD_FILTERS, confirmed: 'yes' as const, received: 'no' as const };
    expect(offeredFilters(all, 'delivered')).toMatchObject({ confirmed: 'yes', received: '' });
    for (const kind of ['shipments', 'secured', 'vault'] as const) {
      expect(offeredFilters(all, kind).confirmed).toBe('');
    }
    // The day board's boxes, «حالة التأكيد» in «التسليم»'s place, and «رقم الإيصال» after the
    // notes: one more than the day board's nine.
    expect(boardFilterParams('delivered')).toEqual([
      'vehicle',
      'bank',
      'origin',
      'destination',
      'area',
      'captain',
      'type',
      'confirmed',
      'notes',
      'receipt',
    ]);
    expect(boardFilterParams('delivered')).toHaveLength(boardFilterParams('shipments').length + 1);
  });
});

describe('Round 33 C — «عاوز رثم الايصال فى عمود لوحده»: the number, and its box', () => {
  const confirmedWith = (receiptNumber: string, id = 'c') =>
    row({ id, deliveryConfirmation: { ...CONFIRMATION, receiptNumber } });

  it('prints the number the ✓ recorded, its digits Latin; nothing on a row awaiting its ✓', () => {
    expect(deliveredReceiptNumber(confirmedWith('RC-20418'))).toBe('RC-20418');
    // Typed on an Arabic keyboard: read as the board's every figure is.
    expect(deliveredReceiptNumber(confirmedWith('رقم ٢٠٤١٨'))).toBe('رقم 20418');
    expect(deliveredReceiptNumber(row())).toBeNull();
    // Any other board's row carries no confirmation at all.
    expect(deliveredReceiptNumber({})).toBeNull();
    // The longest the ✓ takes is printed whole.
    const longest = 'R'.repeat(OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX);
    expect(deliveredReceiptNumber(confirmedWith(longest))).toBe(longest);
  });

  it('finds a fragment, folded, its separators ignored — and narrows nothing when empty', () => {
    expect(matchesReceiptNumber('RC-20418', '')).toBe(true);
    expect(matchesReceiptNumber('RC-20418', '   ')).toBe(true);
    expect(matchesReceiptNumber(null, '')).toBe(true);
    expect(matchesReceiptNumber('RC-20418', '2041')).toBe(true);
    expect(matchesReceiptNumber('RC-20418', 'rc-204')).toBe(true);
    expect(matchesReceiptNumber('RC-20418', 'RC 20418')).toBe(true);
    expect(matchesReceiptNumber('RC-20418', 'rc20418')).toBe(true);
    expect(matchesReceiptNumber('RC-20418', '٢٠٤١٨')).toBe(true);
    expect(matchesReceiptNumber('2026/11/77', '202611')).toBe(true);
    expect(matchesReceiptNumber('RC-20418', '20419')).toBe(false);
    // A row with no number yet is not found by one.
    expect(matchesReceiptNumber(null, '20418')).toBe(false);
  });

  it('narrows the board by it — beside the other boxes — and only that board reads it', () => {
    const rows = [
      row({ id: 'a' }),
      confirmedWith('RC-20418', 'c1'),
      confirmedWith('77310', 'c2'),
      { ...confirmedWith('RC-20502', 's'), shipmentType: 'secured' as const },
    ];
    const run = (over: Partial<typeof EMPTY_DAY_BOARD_FILTERS>) =>
      filterDayBoard(
        rows,
        { ...EMPTY_DAY_BOARD_FILTERS, ...over },
        () => '',
        () => '',
      ).map((r) => r.id);
    expect(run({})).toEqual(['a', 'c1', 'c2', 's']);
    expect(run({ receipt: 'rc' })).toEqual(['c1', 's']);
    expect(run({ receipt: '٧٧٣' })).toEqual(['c2']);
    expect(run({ receipt: 'RC', type: 'secured' })).toEqual(['s']);
    expect(run({ receipt: 'RC', confirmed: 'no' })).toEqual([]);
    expect(run({ receipt: 'X-1' })).toEqual([]);
    // In the URL as `receipt`; a box like any other for the reset.
    const filters = readDayBoardFilters(new URLSearchParams('receipt=RC-20'));
    expect(filters.receipt).toBe('RC-20');
    expect(hasActiveFilter(filters)).toBe(true);
    expect(offeredFilters(filters, 'delivered').receipt).toBe('RC-20');
    // Every other board offers no such box: an old link's `?receipt=` narrows none of them.
    for (const kind of ['shipments', 'secured', 'vault'] as const) {
      expect(offeredFilters(filters, kind).receipt).toBe('');
      expect(boardFilterParams(kind)).not.toContain('receipt');
    }
  });

  // Round 33 C critic — a number looked up is a one-off: remembered and restored on the next
  // visit, it would hide every row still awaiting its ✓ (none has a number yet) — the desk's work.
  it('is read and offered, never remembered across visits — a lookup, not a standing slice', () => {
    expect(BOARD_LOOKUP_PARAMS).toEqual(['receipt']);
    expect(boardFilterParams('delivered')).toContain('receipt');
    expect(rememberedFilterParams('delivered')).not.toContain('receipt');
    expect(rememberedFilterParams('delivered')).toEqual(
      boardFilterParams('delivered').filter((name) => name !== 'receipt'),
    );
    // What it would do if it came back: today's rows awaiting the ✓ all gone.
    const awaiting = [row({ id: 'a1' }), row({ id: 'a2' }), confirmedWith('RC-20418', 'c1')];
    expect(
      filterDayBoard(
        awaiting,
        { ...EMPTY_DAY_BOARD_FILTERS, receipt: 'RC-20418' },
        () => '',
        () => '',
      ).map((r) => r.id),
    ).toEqual(['c1']);
  });
});
