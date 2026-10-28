// «مذكرة صرف مستهلكات» (FR-20) is the department's paper on the device acknowledgment's letterhead,
// with its own wording, its own table, TWO signature blocks and its own number series — and, like
// every printed page of the app, no script of its own: the tab inherits the CSP.
import { describe, expect, it } from 'vitest';
import { type ItConsumableMemoDocumentDto, type ItConsumableMemoLineDto } from '@ecms/contracts';
import { buildCustodyReceiptHtml } from './custody-receipt-print';
import {
  CONSUMABLE_MEMO_COLUMNS,
  CONSUMABLE_MEMO_UNDERTAKING,
  buildConsumableMemoHtml,
  consumableMemoRows,
} from './consumable-memo-print';

const LABELS = { print: 'طباعة الإيصال', close: 'إغلاق' };

const LINE: ItConsumableMemoLineDto = {
  consumableId: '000000000000000000000c01',
  movementId: '000000000000000000000d01',
  code: 'CON-00004',
  name: 'Mouse Logitech M185',
  typeName: { ar: 'ماوس', en: 'Mice' },
  unit: 'قطعة',
  qty: 2,
  reason: 'new',
  assetId: '000000000000000000000a12',
  assetCode: 'AST-00012',
  assetName: 'لاب توب Lenovo',
};

const paper = (
  overrides: Partial<ItConsumableMemoDocumentDto> = {},
): ItConsumableMemoDocumentDto => ({
  memoNumber: 7,
  issuedAt: '2026-10-20T09:00:00.000Z',
  employeeId: '000000000000000000000e01',
  employeeName: 'وليد صفوت جلال صفوت',
  employeeCode: '0100026',
  jobTitle: { ar: 'محاسب', en: 'Accountant' },
  issuedByName: 'أحمد محمود سالم عبد الله',
  notes: null,
  lines: [
    LINE,
    {
      ...LINE,
      consumableId: '000000000000000000000c02',
      movementId: '000000000000000000000d02',
      code: 'CON-00009',
      name: 'HDMI Cable 3 m',
      typeName: { ar: 'كابلات', en: 'Cables' },
      qty: 1,
      reason: 'replacement',
      assetId: null,
      assetCode: null,
      assetName: null,
    },
  ],
  ...overrides,
});

/** The text of the statement, markup stripped. */
const statement = (html: string): string =>
  (/<p class="statement">([\s\S]*?)<\/p>/u.exec(html)?.[1] ?? '').replace(/<[^>]*>/gu, '');

/** The items table's body rows, each as its cells' text. */
const tableRows = (html: string): string[][] => {
  const table = html.slice(html.indexOf('<table class="memo-items">'), html.indexOf('</table>'));
  const body = table.slice(table.indexOf('<tbody>'));
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/gu)].map((row) =>
    [...(row[1] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gu)].map((cell) =>
      (cell[1] ?? '')
        .replace(/<[^>]*>/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim(),
    ),
  );
};

/** One signature block's lines, markup stripped. */
const signBlock = (html: string, who: 'receiver' | 'it'): string[] => {
  // Up to the block's last line — the first `</div>` that closes the block right after it.
  const block = new RegExp(
    `<div class="sign" data-sign="${who}">([\\s\\S]*?</div>)\\s*</div>`,
    'u',
  ).exec(html)?.[1];
  return [...(block ?? '').matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gu)].map((m) =>
    (m[1] ?? '').replace(/<[^>]*>/gu, '').trim(),
  );
};

describe('the consumables memo (مذكرة صرف مستهلكات)', () => {
  const html = buildConsumableMemoHtml(paper(), LABELS);

  it('is on the department’s letterhead, under its own title, one sheet', () => {
    expect(html).toContain('<header class="letterhead">');
    expect(html).toContain('قطاع تكنولوجيا المعلومات');
    expect(html).toContain('<h1>مذكرة صرف مستهلكات</h1>');
    expect(html).not.toContain('<h1>إقرار استلام</h1>');
    expect(html.split('<section class="page">')).toHaveLength(2);
  });

  it('states what was received in the approved wording, the employee filled in', () => {
    expect(statement(html)).toBe(
      'أقر أنا / وليد صفوت جلال صفوت بوظيفة محاسب كود ٠١٠٠٠٢٦ بأنني قد استلمت من قطاع تكنولوجيا المعلومات الأصناف الموضحة أدناه:',
    );
    // The filled-in parts in the form's red; the code kept on one line.
    expect(html).toContain('<span class="fill whole"><bdi>٠١٠٠٠٢٦</bdi></span>');
  });

  it('prints no national ID — the memo has no line for one', () => {
    expect(html).not.toContain('رقم قومي');
  });

  it('lists the items: م · الصنف · النوع · الكمية · مركّب على · السبب', () => {
    expect([...html.matchAll(/<th>([^<]*)<\/th>/gu)].map((m) => m[1])).toEqual([
      ...CONSUMABLE_MEMO_COLUMNS,
    ]);
    expect(CONSUMABLE_MEMO_COLUMNS).toEqual([
      'م',
      'الصنف',
      'النوع',
      'الكمية',
      'مركّب على',
      'السبب',
    ]);
    expect(tableRows(html)).toEqual([
      [
        '١',
        'Mouse Logitech M185 CON-00004',
        'ماوس',
        '٢ قطعة',
        'AST-00012 — لاب توب Lenovo',
        'جديد',
      ],
      ['٢', 'HDMI Cable 3 m CON-00009', 'كابلات', '١ قطعة', '—', 'بدل تالف'],
    ]);
  });

  it('writes each row from the memo’s own snapshot, in the order issued', () => {
    const rows = consumableMemoRows(paper().lines);
    expect(rows.map((row) => row.reason)).toEqual(['جديد', 'بدل تالف']);
    expect(rows[0]).toMatchObject({
      code: 'CON-00004',
      qty: '٢ قطعة',
      installedOn: 'AST-00012 — لاب توب Lenovo',
    });
    // A type the memo no longer knows leaves its cell for a dash, never an invented name.
    expect(consumableMemoRows([{ ...LINE, typeName: null }])[0]?.type).toBe('');
  });

  it('closes with the undertaking, then BOTH signature blocks', () => {
    expect(CONSUMABLE_MEMO_UNDERTAKING).toBe('وأتعهد باستخدامها في أعمال الشركة والمحافظة عليها.');
    expect(html).toContain(`<p class="undertaking">${CONSUMABLE_MEMO_UNDERTAKING}</p>`);
    // The receiver: name (its first three parts), signature and date.
    expect(signBlock(html, 'receiver')).toEqual([
      'المستلم',
      'الاسم: وليد صفوت جلال',
      'التوقيع:',
      'التاريخ: ٢٠ / ١٠ / ٢٠٢٦',
    ]);
    // The IT officer who handed it over: name and signature.
    expect(signBlock(html, 'it')).toEqual([
      'مسؤول تكنولوجيا المعلومات',
      'الاسم: أحمد محمود سالم',
      'التوقيع:',
    ]);
    // The receiver's block first — the start of an Arabic line, on the right.
    expect(html.indexOf('data-sign="receiver"')).toBeLessThan(html.indexOf('data-sign="it"'));
    expect(html.indexOf(CONSUMABLE_MEMO_UNDERTAKING)).toBeLessThan(
      html.indexOf('data-sign="receiver"'),
    );
  });

  it('numbers the paper in its footer from its own series, not the F-14 acknowledgments', () => {
    expect(html).toContain('<b>EGYCASH</b> | IT Dept. | EGYCASH-IT-CON-0007');
    expect(html).toContain('<span class="block"></span>');
    expect(html).toContain(
      '<title>مذكرة صرف مستهلكات EGYCASH-IT-CON-0007 — وليد صفوت جلال صفوت</title>',
    );
    expect(html).toContain('<span class="number">EGYCASH-IT-CON-0007</span>');
    expect(html).not.toContain('EGYCASH-IT-F-14');
  });

  it('prints the notes under the table when there are some, and nothing when there are none', () => {
    expect(html).not.toContain('memo-notes">');
    const noted = buildConsumableMemoHtml(paper({ notes: 'تسليم مع جهاز جديد' }), LABELS);
    expect(noted).toContain('<p class="memo-notes">ملاحظات: تسليم مع جهاز جديد</p>');
  });

  it('leaves dotted lines for the pen where the directory has nothing', () => {
    const bare = buildConsumableMemoHtml(
      paper({ employeeName: null, employeeCode: null, jobTitle: null, issuedByName: null }),
      LABELS,
    );
    expect(statement(bare)).toContain(
      `أقر أنا / ${'.'.repeat(36)} بوظيفة ${'.'.repeat(32)} كود ${'.'.repeat(12)} بأنني`,
    );
    expect(signBlock(bare, 'it')[1]).toBe('الاسم:');
  });

  it('carries no script of its own — the tab inherits the app’s CSP and would never run it', () => {
    expect(html).not.toMatch(/<script\b/iu);
    expect(html).not.toMatch(/\son[a-z]+=/u);
    // The toolbar's buttons are wired by the app (`print-window.ts`), by their data attributes.
    expect(html).toContain('data-print');
    expect(html).toContain('data-close');
  });

  it('escapes what people typed', () => {
    const typed = buildConsumableMemoHtml(
      paper({
        employeeName: '<b>x</b> & "y"',
        notes: '<img src=x>',
        lines: [{ ...LINE, name: '<i>mouse</i>', assetName: '<script>' }],
      }),
      LABELS,
    );
    expect(typed).not.toContain('<b>x</b>');
    expect(typed).not.toContain('<img src=x>');
    expect(typed).not.toContain('<i>mouse</i>');
    expect(typed).not.toMatch(/<script\b/iu);
    expect(typed).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
  });

  it('leaves the device acknowledgment exactly as it was — the letterhead is shared, not changed', () => {
    const device = buildCustodyReceiptHtml(
      {
        formNumber: 42,
        issuedAt: '2026-10-20T09:00:00.000Z',
        employeeId: '000000000000000000000e01',
        employeeName: 'وليد صفوت جلال صفوت',
        employeeCode: '0100026',
        jobTitle: { ar: 'محاسب', en: 'Accountant' },
        nationalId: null,
        nationalIdVisible: false,
        section: null,
        department: null,
        lines: [
          {
            assetId: '000000000000000000000a12',
            assignmentId: null,
            assetCode: 'AST-00012',
            name: 'لاب توب Lenovo',
            serialNumber: 'PF3ABC12',
            conditionOnIssue: null,
            notes: null,
            deviceType: 'لاب توب',
            manufacturer: null,
            model: null,
            specs: null,
            accessories: [],
          },
        ],
      },
      LABELS,
    );
    expect(device).toContain('<h1>إقرار استلام</h1>');
    expect(device).toContain(
      '<title>إقرار استلام EGYCASH-IT-F-14-0042 — وليد صفوت جلال صفوت</title>',
    );
  });
});
