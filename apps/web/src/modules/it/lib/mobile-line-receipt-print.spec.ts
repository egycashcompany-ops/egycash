// The line acknowledgment is the department's «إقرار استلام» with a line where a device would be:
// the device paper's letterhead, undertaking, signature block and numbered footer, and in between
// «… بأنني قد استلمت خط محمول رقم … وبياناته كالتالي:» with the line's facts in a small table.
// Like every printed page of the app it carries no script of its own — the tab inherits the CSP.
import { describe, expect, it } from 'vitest';
import {
  type ItMobileLineReceiptDocumentDto,
  type ItMobileLineReceiptLineDto,
} from '@ecms/contracts';
import { RECEIPT_UNDERTAKING } from './custody-receipt-print';
import { ESIM_SERIAL, buildMobileLineReceiptHtml, lineFacts } from './mobile-line-receipt-print';

const LABELS = { print: 'طباعة الإيصال', close: 'إغلاق' };

const LINE: ItMobileLineReceiptLineDto = {
  lineId: '000000000000000000000001',
  assignmentId: null,
  network: 'vodafone',
  phoneNumber: '01012345678',
  simKind: 'physical',
  simSerial: '8920011234567890123',
  ratePlan: 'Red Business 500',
  accountNumber: '6.293541',
};

const paper = (
  overrides: Partial<ItMobileLineReceiptDocumentDto> = {},
): ItMobileLineReceiptDocumentDto => ({
  formNumber: 42,
  issuedAt: '2026-10-20T09:00:00.000Z',
  employeeId: '000000000000000000000a01',
  employeeName: 'مصطفى عثمان محمود عثمان',
  employeeCode: '0100026',
  jobTitle: { ar: 'محاسب', en: 'Accountant' },
  nationalId: '29801011234567',
  nationalIdVisible: true,
  section: null,
  department: null,
  line: LINE,
  ...overrides,
});

/** The table's rows as [label, value], markup stripped. */
const tableRows = (html: string): string[][] => {
  const table = html.slice(html.indexOf('<table class="facts">'), html.indexOf('</table>'));
  return [...table.matchAll(/<tr><th>(.*?)<\/th><td>(.*?)<\/td><\/tr>/gu)].map((m) =>
    [m[1] ?? '', m[2] ?? ''].map((cell) => cell.replace(/<[^>]*>/gu, '')),
  );
};

/** The text of the statement, markup stripped. */
const statement = (html: string): string =>
  (/<p class="statement">([\s\S]*?)<\/p>/u.exec(html)?.[1] ?? '').replace(/<[^>]*>/gu, '');

describe('the line acknowledgment (إقرار استلام)', () => {
  const html = buildMobileLineReceiptHtml(paper(), LABELS);

  it('is the department’s form: its letterhead, its title, one sheet', () => {
    expect(html).toContain('<header class="letterhead">');
    expect(html).toContain('قطاع تكنولوجيا المعلومات');
    expect(html).toContain('<h1>إقرار استلام</h1>');
    expect(html.split('<section class="page">')).toHaveLength(2);
  });

  it('states what was received — «خط محمول رقم …» — with the employee filled in', () => {
    const text = statement(html);
    expect(text).toContain('أقر أنا / مصطفى عثمان محمود عثمان بوظيفة محاسب');
    expect(text).toContain('بشركة إيجي كاش للحلول النقدية، كود ٠١٠٠٠٢٦،');
    expect(text).toContain('بطاقة رقم قومي ٢٩٨٠١٠١١٢٣٤٥٦٧');
    expect(text).toContain('بأنني قد استلمت خط محمول رقم 01012345678 وبياناته كالتالي:');
    // The number in the form's red, and kept on one line.
    expect(html).toContain('<span class="fill whole"><bdi>01012345678</bdi></span>');
  });

  it('lists the line’s facts in a table: network, number, SIM serial, plan, account', () => {
    expect(tableRows(html)).toEqual([
      ['الشبكة', 'فودافون'],
      ['رقم الخط', '01012345678'],
      ['مسلسل الشريحة', '8920011234567890123'],
      ['الباقة', 'Red Business 500'],
      ['رقم الحساب', '6.293541'],
    ]);
  });

  it('says an eSIM is one — there is no card to read a serial from', () => {
    const esim = buildMobileLineReceiptHtml(
      paper({ line: { ...LINE, simKind: 'esim', simSerial: null } }),
      LABELS,
    );
    expect(tableRows(esim)[2]).toEqual(['مسلسل الشريحة', 'شريحة إلكترونية (eSIM)']);
    expect(ESIM_SERIAL).toBe('شريحة إلكترونية (eSIM)');
  });

  it('leaves off a row the register has nothing for', () => {
    const bare = {
      ...LINE,
      network: 'orange' as const,
      simSerial: null,
      ratePlan: null,
      accountNumber: null,
    };
    expect(lineFacts(bare)).toEqual([
      { label: 'الشبكة', value: 'أورانج' },
      { label: 'رقم الخط', value: '01012345678' },
    ]);
  });

  it('leaves the national ID for the pen when the reader may not see it', () => {
    const withheld = buildMobileLineReceiptHtml(
      paper({ nationalId: null, nationalIdVisible: false }),
      LABELS,
    );
    expect(statement(withheld)).toContain(`بطاقة رقم قومي ${'.'.repeat(26)} بأنني`);
    expect(withheld).not.toContain('٢٩٨٠١٠١١٢٣٤٥٦٧');
  });

  it('closes with the form’s undertaking, its oath and the signature block', () => {
    expect(html).toContain(`<p class="undertaking">${RECEIPT_UNDERTAKING}</p>`);
    expect(html).toContain('وهذا إقرار مني بذلك ،،،');
    expect(html).toContain('<div class="by">المقر بما فيه</div>');
    expect(html).toContain('<div>الاسم: مصطفى عثمان محمود</div>');
  });

  it('numbers the paper in its footer from the F-14 series, with no page count', () => {
    expect(html).toContain('<b>EGYCASH</b> | IT Dept. | EGYCASH-IT-F-14-0042');
    expect(html).toContain('<span class="block"></span>');
    expect(html).toContain('<title>إقرار استلام EGYCASH-IT-F-14-0042');
  });

  it('carries no script of its own — the tab inherits the app’s CSP and would never run it', () => {
    expect(html).not.toMatch(/<script\b/iu);
    expect(html).not.toMatch(/\son[a-z]+=/u);
    // The toolbar's buttons are wired by the app (`print-window.ts`), by their data attributes.
    expect(html).toContain('data-print');
    expect(html).toContain('data-close');
  });

  it('escapes what people typed', () => {
    const typed = buildMobileLineReceiptHtml(
      paper({ employeeName: '<b>x</b> & "y"', line: { ...LINE, ratePlan: '<img src=x>' } }),
      LABELS,
    );
    expect(typed).not.toContain('<b>x</b>');
    expect(typed).not.toContain('<img src=x>');
    expect(typed).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
  });
});
