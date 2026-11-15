// Round 18 — «إيصال» prints the vault's receipt («إيصال» PRINTS the vault receipt), on the company's
// report form, against the real Arabic catalog: a DRAFT before «استلام» (titled «مسودة», nobody
// named), the receipt after it (the receiver and the time the server answered); the shipment's
// data as the vault corrected it, the packages, the seals under the legacy summary, «سيريال», and
// the notes of each denomination with their total.
import { describe, expect, it } from 'vitest';
import { translate } from '../../../platform/localization/i18n';
import { buildFleetReportHtml } from '../../fleet/lib/fleet-report-print';
import { vaultReceiptReport, type VaultReceiptPrintInput } from './vault-receipt-print';

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const INPUT: VaultReceiptPrintInput = {
  t: ar,
  shipment: {
    mainBank: 'مصر',
    origin: 'المنصور محمد',
    originBank: 'مصر',
    destination: 'مصر ج م',
    destinationBank: 'مصر',
    area: 'وسط البلد',
    lines: [
      { currency: 'اماراتى', amount: 1770 },
      { currency: 'كندى', amount: 1100 },
      { currency: 'استرلينى', amount: 3000 },
      { currency: 'قطرى', amount: 600 },
    ],
    captain: 'سامح سيد فوزي عبده',
    vehicle: '259',
    collectionDate: '2026-05-17',
    deliveryDate: '2026-05-18',
    notes: '',
    serialTracked: false,
  },
  receipt: {
    receiptNumber: ' 165 ',
    bagCount: 2,
    cartonCount: 1,
    boxCount: 3,
    bagSealsPerBag: 2,
    bagSeals: ['1', '2', '3', '4'],
    boxSeals: ['6', '8', '7', '10', '11', '13'],
    denominations: [
      { value: 0.25, count: 4 },
      { value: 200, count: 1500 },
    ],
  },
  taken: null,
  amount: (value) => value.toLocaleString('en-US'),
  count: (value) => value.toLocaleString('en-US'),
  when: (iso) => `at:${iso}`,
};

/** A row's value by its label. */
const valueOf = (rows: readonly (readonly string[])[], label: string): string | undefined =>
  rows.find((row) => row[0] === label)?.[1];

describe('the DRAFT — «إيصال» pressed before «استلام»', () => {
  const draft = vaultReceiptReport(INPUT);

  it('says it is a draft, on the title and under it, and names nobody', () => {
    expect(draft.title).toBe(ar('operations.secured.receive.print.titleDraft'));
    expect(draft.title).toContain('مسودة');
    expect(draft.subtitle).toBe(ar('operations.secured.receive.print.draftNote'));
    // No receiver, no time: nothing has been received yet.
    expect(draft.totals).toEqual([]);
    expect(JSON.stringify(draft)).not.toContain(ar('operations.secured.receive.print.receivedBy'));
  });

  it('is the company’s form: the vault’s department, «م», a two-column table', () => {
    expect(draft.department).toBe('الخزينة');
    expect(draft.serialHeader).toBe(ar('operations.reportBoard.serial'));
    expect(draft.header).toEqual(['البيان', 'القيمة']);
    expect(draft.signatories).toBeUndefined();
    expect(draft.orientation).toBe('portrait');
  });

  it('carries the shipment’s data — every line of its money, the crew, the two days', () => {
    const { rows } = draft;
    expect(valueOf(rows, ar('operations.secured.receive.receiptNumber'))).toBe('165');
    expect(valueOf(rows, ar('operations.shipment.form.mainBank'))).toBe('مصر');
    expect(valueOf(rows, ar('operations.shipment.origin'))).toBe('المنصور محمد — مصر');
    expect(valueOf(rows, ar('operations.shipment.destination'))).toBe('مصر ج م — مصر');
    expect(valueOf(rows, ar('operations.shipment.area'))).toBe('وسط البلد');
    expect(
      ['اماراتى', 'كندى', 'استرلينى', 'قطرى'].map((currency) =>
        valueOf(rows, ar('operations.secured.receive.print.line', { currency })),
      ),
    ).toEqual(['1,770', '1,100', '3,000', '600']);
    expect(valueOf(rows, ar('operations.shipment.form.captain'))).toBe('سامح سيد فوزي عبده');
    expect(valueOf(rows, ar('operations.shipment.form.vehicle'))).toBe('259');
    expect(valueOf(rows, ar('operations.board.collectedOn'))).toBe('2026-05-17');
    expect(valueOf(rows, ar('operations.shipment.deliveryDate'))).toBe('2026-05-18');
    // An empty box prints «—», never a blank cell.
    expect(valueOf(rows, ar('operations.shipment.notes'))).toBe('—');
    expect(valueOf(rows, ar('operations.secured.receive.serial'))).toBe('لا');
  });

  it('carries the packages, the seals under the legacy summary, and the notes counted', () => {
    const { rows } = draft;
    expect(valueOf(rows, ar('operations.secured.receive.bags'))).toBe(
      ar('operations.secured.receive.print.bags', { count: '2', per: '2' }),
    );
    expect(valueOf(rows, ar('operations.secured.receive.boxes'))).toBe('3');
    expect(valueOf(rows, ar('operations.secured.receive.cartons'))).toBe('1');
    expect(valueOf(rows, ar('operations.secured.receive.bagSeals'))).toBe('[1 - 4] (العدد: 4)');
    expect(valueOf(rows, ar('operations.secured.receive.boxSeals'))).toBe(
      '[6 - 8] - [10 - 11] - 13 (العدد: 6)',
    );
    expect(
      valueOf(rows, ar('operations.secured.receive.print.denomination', { value: '0.25' })),
    ).toBe(ar('operations.secured.receive.print.notes', { count: '4', amount: '1' }));
    expect(
      valueOf(rows, ar('operations.secured.receive.print.denomination', { value: '200' })),
    ).toBe(ar('operations.secured.receive.print.notes', { count: '1,500', amount: '300,000' }));
    // What the notes come to — the table's bottom line.
    expect(draft.totalRow).toEqual({
      label: ar('operations.secured.receive.denominationsTotal'),
      value: '300,001',
    });
  });

  it('prints the whole page on the company’s letterhead', () => {
    const html = buildFleetReportHtml(draft);
    expect(html).toContain('EGYCASH');
    expect(html).toContain('ايجى كاش للحلول النقدية');
    expect(html).toContain('[6 - 8] - [10 - 11] - 13');
    expect(html).toContain(ar('operations.secured.receive.print.titleDraft'));
  });
});

describe('the RECEIPT — «إيصال» pressed after «استلام»', () => {
  const taken = vaultReceiptReport({
    ...INPUT,
    shipment: { ...INPUT.shipment, notes: 'وصلت مختومة', serialTracked: true },
    taken: {
      receivedAt: '2026-11-15T09:30:00.000Z',
      receivedByName: 'أمين الخزينة',
      receiptNumber: '165',
    },
  });

  it('is titled the receipt, and names who received it and when — the server’s answer', () => {
    expect(taken.title).toBe(ar('operations.secured.receive.print.title'));
    expect(taken.title).not.toContain('مسودة');
    expect(taken.subtitle).toBe(
      ar('operations.secured.receive.print.takenNote', {
        at: 'at:2026-11-15T09:30:00.000Z',
        name: 'أمين الخزينة',
      }),
    );
    expect(taken.totals).toEqual([
      { label: ar('operations.secured.receive.print.receivedBy'), value: 'أمين الخزينة' },
      {
        label: ar('operations.secured.receive.print.receivedAt'),
        value: 'at:2026-11-15T09:30:00.000Z',
      },
    ]);
  });

  it('prints the receipt number AS STORED — none is «—», whatever the box still holds', () => {
    const none = vaultReceiptReport({
      ...INPUT,
      taken: { receivedAt: '2026-11-15T09:30:00.000Z', receivedByName: null, receiptNumber: null },
    });
    expect(valueOf(none.rows, ar('operations.secured.receive.receiptNumber'))).toBe('—');
    expect(none.totals[0]?.value).toBe('—');
  });

  it('prints the vault’s corrections and its «سيريال»', () => {
    expect(valueOf(taken.rows, ar('operations.shipment.notes'))).toBe('وصلت مختومة');
    expect(valueOf(taken.rows, ar('operations.secured.receive.serial'))).toBe('نعم');
  });
});

describe('what is left empty, and a seal typed twice', () => {
  it('prints no seals as «—», no bags as 0, and no total line when no note was counted', () => {
    const empty = vaultReceiptReport({
      ...INPUT,
      receipt: {
        receiptNumber: '',
        bagCount: 0,
        cartonCount: 0,
        boxCount: 0,
        bagSealsPerBag: 2,
        bagSeals: [],
        boxSeals: [],
        denominations: [],
      },
    });
    expect(valueOf(empty.rows, ar('operations.secured.receive.receiptNumber'))).toBe('—');
    expect(valueOf(empty.rows, ar('operations.secured.receive.bags'))).toBe('0');
    expect(valueOf(empty.rows, ar('operations.secured.receive.bagSeals'))).toBe('—');
    expect(empty.totalRow).toBeUndefined();
  });

  it('names a seal typed twice beside the summary', () => {
    const twice = vaultReceiptReport({
      ...INPUT,
      receipt: { ...INPUT.receipt, bagSeals: ['1', '2', '2'] },
    });
    expect(valueOf(twice.rows, ar('operations.secured.receive.bagSeals'))).toBe(
      `[1 - 2] (العدد: 3) — ${ar('operations.secured.receive.duplicates', { seals: '2' })}`,
    );
  });
});
