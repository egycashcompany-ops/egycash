// «بيان التغذية» (docs/12-planning/atm-settlements-phase1.md §8.3, §10.4). Invented figures only.
import { type AtmReceiptPrintDto } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { RECEIPT_COLUMN_SHARES, buildReceiptHtml } from './receipt-print';
import { RECEIPT_WORDS } from './settlement-paper-wording';

const dto = (over: Partial<AtmReceiptPrintDto> = {}): AtmReceiptPrintDto => ({
  bankCode: 'BRK',
  bankNameAr: 'بنك البركة',
  replenishDate: '2026-10-27',
  // 23:30 UTC on the 26th is already the 27th in Cairo: the PRINT day, not the UTC one.
  printedAt: '2026-10-26T23:30:00Z',
  rows: [
    { denomination: 200, notes: 8000 },
    { denomination: 100, notes: 4000 },
    { denomination: 50, notes: 2000 },
    { denomination: 20, notes: 500 },
    { denomination: 10, notes: 0 },
    { denomination: 5, notes: 0 },
  ],
  egpTotalMinor: (8000 * 200 + 4000 * 100 + 2000 * 50 + 500 * 20) * 100,
  machineCount: 3,
  serials: [1027, 1028, 1029],
  excludedDraftLines: 2,
  previous: null,
  ...over,
});

const cellAt = (html: string, r: number, c: number): string =>
  new RegExp(`grid-area: ${String(r)} / ${String(c)} / [^"]*"[^>]*>(.*?)</div>`, 'u')
    .exec(html)?.[1]
    ?.replace(/<[^>]+>/gu, '') ?? '';

describe('«بيان التغذية»', () => {
  const html = buildReceiptHtml(dto());

  it('composes the title from the owner’s words around «بنك البركة»', () => {
    expect(cellAt(html, 3, 4)).toBe('بيان مرسل من إدارة الباك أوفيس لتغذية بنك البركة عن يوم');
  });

  it('prints the PRINT day in B3, d/m/yyyy on the Cairo calendar', () => {
    expect(cellAt(html, 3, 2)).toBe('27/10/2026');
  });

  it('prints the six denomination rows, 20/10/5 summed, and the total converted once', () => {
    const rows = [8, 9, 10, 11, 12, 13].map((r) => [cellAt(html, r, 6), cellAt(html, r, 3)]);
    expect(rows).toEqual([
      ['200', '8,000'],
      ['100', '4,000'],
      ['50', '2,000'],
      ['20', '500'],
      ['10', '0'],
      ['5', '0'],
    ]);
    expect(cellAt(html, 14, 3)).toBe('2,110,000');
    expect(cellAt(html, 14, 6)).toBe(RECEIPT_WORDS.total);
    expect(cellAt(html, 7, 3)).toBe(RECEIPT_WORDS.count);
    expect(cellAt(html, 7, 6)).toBe(RECEIPT_WORDS.denomination);
  });

  it('says the machine count in the owner’s sentence, and the supervisor line', () => {
    expect(cellAt(html, 16, 3)).toBe(
      'تم إستلام المبلغ المذكور أعلاه لتغذية عدد 3 ماكينة للبنك المذكور',
    );
    expect(cellAt(html, 19, 7)).toBe('توقيع المشرف / ');
  });

  it('is one A4 landscape page on the sheet’s own columns, the paper carrying nothing extra', () => {
    expect(html).toContain('@page { size: A4 landscape; margin: 0; }');
    expect(html.match(/<section class="page">/gu)).toHaveLength(1);
    expect([...RECEIPT_COLUMN_SHARES]).toEqual([
      11.8, 10.3, 8.8, 10.3, 8.8, 10.3, 8.8, 10.3, 8.8, 11.8,
    ]);
    // The drafts left out and a previous print are the dialog's to say, never the paper's.
    expect(html).not.toContain('1027');
    expect(html).not.toMatch(/<script\b/iu);
  });
});
