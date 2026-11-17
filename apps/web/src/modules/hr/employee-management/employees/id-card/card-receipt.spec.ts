import { describe, expect, it } from 'vitest';
import {
  RECEIPT_LOGO,
  RECEIPT_STYLE,
  copyLabel,
  receiptHtml,
  type CardReceipt,
} from './card-receipt';

const base: CardReceipt = {
  name: 'عمرو اشرف محمد فارس محمد',
  code: '0102815',
  employeeNumber: '2815',
  nationalId: '29001010180100',
  jobTitle: 'اخصائى برمجيات',
  branch: 'الإسكندرية',
  department: 'التشغيل',
  copyNumber: 2,
  issuedAt: new Date(2026, 10, 10),
  cardImage: 'data:image/png;base64,AAAA',
};

describe('card receipt (إقرار استلام كارنيه)', () => {
  it('is an Arabic A4 paper headed by the EGYCASH logo, with one signature: the receiver’s', () => {
    const html = receiptHtml(base);
    expect(RECEIPT_STYLE).toContain('size: A4');
    expect(html).toContain(`<img src="${RECEIPT_LOGO}"`);
    expect(html).toContain('إقرار استلام كارنيه الشركة');
    expect(html).toContain('التوقيع:');
    expect(html.match(/التوقيع/g)).toHaveLength(1);
  });

  it('names the card it is for, with the details in Arabic digits', () => {
    const html = receiptHtml(base);
    expect(html).toContain('الإصدار الثاني');
    expect(html).toContain('٢٩٠٠١٠١٠١٨٠١٠٠');
    expect(html).toContain('١٠/١١/٢٠٢٦');
    expect(html).toContain(base.cardImage);
  });

  it('escapes what it prints and dashes what is missing', () => {
    const html = receiptHtml({ ...base, name: '<b>x</b>', department: '', cardImage: null });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('<td>—</td>');
    expect(html).not.toContain('صورة الكارنيه');
  });

  it('counts copies in words up to the tenth, then in digits', () => {
    expect(copyLabel(1)).toBe('الأول');
    expect(copyLabel(10)).toBe('العاشر');
    expect(copyLabel(12)).toBe('رقم ١٢');
  });
});
