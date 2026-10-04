// The printed custody receipt is the company's form EGYCASH-IT-F-14-02 — every part the owner's
// paper has, in its words, filled in with what the system knows.
import { describe, expect, it } from 'vitest';
import { type ItCustodyReceiptDocumentDto } from '@ecms/contracts';
import { buildCustodyReceiptHtml, RECEIPT_DECLARATION, receiptDate } from './custody-receipt-print';

const paper = (
  overrides: Partial<ItCustodyReceiptDocumentDto> = {},
): ItCustodyReceiptDocumentDto => ({
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
  const html = buildCustodyReceiptHtml(paper());

  it('carries the letterhead, the title and the form’s footer', () => {
    expect(html).toContain('شركة إيجي كاش للحلول النقدية');
    expect(html).toContain('إدارة تكنولوجيا المعلومات');
    expect(html).toContain('إيصال استلام');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('EGYCASH-IT -F-14-02');
    expect(html).toContain('Issue / Rev. no.: 1/0');
    expect(html).toContain('Issue date: 1/5/2022');
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

  it('leaves a line for the pen when the system cannot name the employee', () => {
    const blank = buildCustodyReceiptHtml(paper({ employeeName: null, jobTitle: null }));
    expect(blank).toContain('الاسم : ....');
    expect(blank).toContain('الوظيفة : ....');
  });

  it('dates it day / month / year in Arabic digits, never grouped', () => {
    expect(receiptDate('2023-08-30T09:00:00.000Z')).toBe('٣٠ / ٨ / ٢٠٢٣');
  });

  it('escapes what people typed', () => {
    const hostile = buildCustodyReceiptHtml(paper({ employeeName: '<script>x</script>' }));
    expect(hostile).not.toContain('<script>x</script>');
    expect(hostile).toContain('&lt;script&gt;');
  });

  it('prints itself once the letterhead has loaded', () => {
    expect(html).toContain('window.print()');
  });
});
