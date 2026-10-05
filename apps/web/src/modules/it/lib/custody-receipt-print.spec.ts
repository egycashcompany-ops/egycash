// The printed custody receipt is the company's form — every part the owner's paper has, in its
// words, filled in with what the system knows — with the owner's 5 October changes: the paper's
// own number and the day it is printed in the footer, the signature block on the left, and the tab
// showing an A4 sheet. And since the tab inherits the app's Content-Security-Policy, nothing in it
// may depend on a script of its own.
import { describe, expect, it, vi } from 'vitest';
import { type ItCustodyReceiptDocumentDto } from '@ecms/contracts';
import {
  buildCustodyReceiptHtml,
  footerDate,
  RECEIPT_DECLARATION,
  receiptDate,
  receiptNumberLabel,
  wireReceiptWindow,
} from './custody-receipt-print';

const LABELS = { print: 'طباعة الإيصال', close: 'إغلاق' };
const PRINTED_AT = new Date(2026, 9, 5, 11, 30);

const paper = (
  overrides: Partial<ItCustodyReceiptDocumentDto> = {},
): ItCustodyReceiptDocumentDto => ({
  formNumber: 7,
  issuedAt: '2023-08-30T09:00:00.000Z',
  employeeId: '000000000000000000000a01',
  employeeName: 'مصطفى عثمان محمود',
  employeeCode: '0100026',
  jobTitle: { ar: 'محاسب', en: 'Accountant' },
  lines: [
    {
      assetId: '000000000000000000000001',
      assignmentId: null,
      assetCode: 'AST-00001',
      name: 'Dell Optiplex 7090',
      serialNumber: 'B600DN3',
      conditionOnIssue: 'N',
      notes: 'Mouse&KeyBord',
    },
    {
      assetId: '000000000000000000000002',
      assignmentId: null,
      assetCode: 'AST-00002',
      name: 'Dell Screen',
      serialNumber: '49WNRS3',
      conditionOnIssue: 'N',
      notes: null,
    },
  ],
  ...overrides,
});

describe('the custody receipt (إيصال استلام)', () => {
  const html = buildCustodyReceiptHtml(paper(), LABELS, PRINTED_AT);

  it('carries the letterhead and the title', () => {
    expect(html).toContain('شركة إيجي كاش للحلول النقدية');
    expect(html).toContain('إدارة تكنولوجيا المعلومات');
    expect(html).toContain('إيصال استلام');
    expect(html).toContain('data:image/png;base64,');
  });

  it('numbers the paper and dates the footer with the day it is printed', () => {
    // «ابدأ بـ 0001 وكل طباعة زود رقم» — the paper's own number, padded to four digits.
    expect(html).toContain('<span>EGYCASH-IT-F-14-0007</span>');
    expect(html).toContain('Issue / Rev. no.: 1/0');
    // «خلى دا تاريخ اليوم» — the day it is printed, not the form's 2022 issue date.
    expect(html).toContain('Issue date: 5/10/2026');
    expect(html).not.toContain('1/5/2022');
    expect(html).not.toContain('F-14-02');
    // The tab is named after the paper, not «about:blank».
    expect(html).toContain('<title>إيصال استلام EGYCASH-IT-F-14-0007 — مصطفى عثمان محمود</title>');
  });

  it('prints the table the paper has — its columns, and a numbered line per item', () => {
    for (const header of [
      '<th>م</th>',
      '<th>اسم الصنف</th>',
      '<th>SN</th>',
      '<th>الحالة</th>',
      '<th>ملاحظات</th>',
    ]) {
      expect(html).toContain(header);
    }
    expect(html).toContain('Dell Optiplex 7090');
    expect(html).toContain('B600DN3');
    // Escaped: an item note is data, never markup.
    expect(html).toContain('Mouse&amp;KeyBord');
    expect(html).toContain('AST-00002');
    expect(html.match(/<td class="ser">/g)).toHaveLength(2);
    expect(html).toContain('<td class="ser">١</td>');
  });

  it('names the employee where the paper had blanks, and keeps the declaration word for word', () => {
    expect(html).toContain('استلمت أنا : <b>مصطفى عثمان محمود</b>');
    expect(html).toContain('الاسم : مصطفى عثمان محمود');
    expect(html).toContain('الوظيفة : محاسب');
    expect(html).toContain(RECEIPT_DECLARATION);
    expect(html).toContain('وهذا إقرار مني بذلك');
    expect(html).toContain('التوقيع (');
  });

  it('puts the signature block on the LEFT of the page, not in the middle', () => {
    // In a right-to-left page the left is the END side: the free margin goes on the start side.
    const rule = /\.signs \{([^}]*)\}/u.exec(html)?.[1] ?? '';
    expect(rule).toContain('margin-inline-start: auto');
    expect(rule).toContain('width: max-content');
  });

  it('shows the paper as an A4 sheet in its tab, with a toolbar that is never printed', () => {
    const screen = html.slice(html.indexOf('@media screen {'));
    expect(screen).toContain('width: 210mm; min-height: 297mm');
    expect(html).toContain('@page { size: A4 portrait;');
    expect(html).toContain('.bar { display: none; }');
    expect(html).toContain('id="receipt-print">طباعة الإيصال</button>');
    expect(html).toContain('id="receipt-close">إغلاق</button>');
  });

  it('carries no script of its own — the tab inherits the app’s CSP and would never run it', () => {
    expect(html).not.toMatch(/<script/iu);
    expect(html).not.toMatch(/\son[a-z]+=/iu);
  });

  it('leaves a line for the pen when the system cannot name the employee', () => {
    const blank = buildCustodyReceiptHtml(paper({ employeeName: null, jobTitle: null }), LABELS);
    expect(blank).toContain('الاسم : ....');
    expect(blank).toContain('الوظيفة : ....');
  });

  it('a receipt from before numbering prints the form’s bare prefix', () => {
    expect(receiptNumberLabel(null)).toBe('EGYCASH-IT-F-14');
    expect(receiptNumberLabel(1)).toBe('EGYCASH-IT-F-14-0001');
    expect(receiptNumberLabel(12345)).toBe('EGYCASH-IT-F-14-12345');
  });

  it('dates the letterhead day / month / year in Arabic digits, the footer in Latin ones', () => {
    expect(receiptDate('2023-08-30T09:00:00.000Z')).toBe('٣٠ / ٨ / ٢٠٢٣');
    expect(footerDate(PRINTED_AT)).toBe('5/10/2026');
  });

  it('escapes what people typed', () => {
    const hostile = buildCustodyReceiptHtml(paper({ employeeName: '<script>x</script>' }), LABELS);
    expect(hostile).not.toContain('<script>x</script>');
    expect(hostile).toContain('&lt;script&gt;');
  });
});

/** A tab as small as the wiring needs: two buttons, one image, a clock that runs at once. */
const fakeTab = (logoComplete: boolean) => {
  const listeners = new Map<string, () => void>();
  const element = (id: string) => ({
    addEventListener: (type: string, fn: () => void) => listeners.set(`${id}:${type}`, fn),
  });
  const timers: (() => void)[] = [];
  const win = {
    focus: vi.fn(),
    print: vi.fn(),
    close: vi.fn(),
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    document: {
      getElementById: (id: string) => element(id),
      images: [{ complete: logoComplete, ...element('logo') }],
    },
  };
  return { win, listeners, timers };
};

describe('the receipt tab is worked from the app’s own script', () => {
  it('opens the print dialog by itself — once, however many signals arrive', () => {
    const { win, listeners, timers } = fakeTab(false);
    wireReceiptWindow(win as unknown as Window);

    listeners.get('logo:load')?.();
    for (const timer of timers) timer();
    listeners.get('logo:error')?.();

    expect(win.print).toHaveBeenCalledTimes(1);
  });

  it('a logo already decoded prints on the short timer', () => {
    const { win, timers } = fakeTab(true);
    wireReceiptWindow(win as unknown as Window);
    timers[0]?.();
    expect(win.print).toHaveBeenCalledTimes(1);
  });

  it('the toolbar prints again and closes the tab', () => {
    const { win, listeners } = fakeTab(true);
    wireReceiptWindow(win as unknown as Window, false);

    expect(win.print).not.toHaveBeenCalled();
    listeners.get('receipt-print:click')?.();
    listeners.get('receipt-print:click')?.();
    expect(win.print).toHaveBeenCalledTimes(2);
    listeners.get('receipt-close:click')?.();
    expect(win.close).toHaveBeenCalledTimes(1);
  });
});
