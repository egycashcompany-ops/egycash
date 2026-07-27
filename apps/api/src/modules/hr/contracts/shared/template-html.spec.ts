// D6/D7 + A11 — the template sanitizer (allow-list, no active content survives) and
// placeholder extraction (distinct, document order).
import { describe, expect, it } from 'vitest';
import { extractPlaceholders, sanitizeTemplateHtml } from './template-html';

describe('sanitizeTemplateHtml', () => {
  it('keeps the print/structural allow-list intact', () => {
    const html = '<h1>عقد</h1><p>نص <strong>مهم</strong> و<u>مسطر</u></p><ul><li>بند</li></ul><hr />';
    expect(sanitizeTemplateHtml(html)).toBe(html);
  });

  it('removes script/style/iframe WITH their content', () => {
    const html = '<p>قبل</p><script>alert(1)</script><style>p{color:red}</style><iframe src="x"></iframe><p>بعد</p>';
    expect(sanitizeTemplateHtml(html)).toBe('<p>قبل</p><p>بعد</p>');
  });

  it('drops unknown tags but keeps their content', () => {
    expect(sanitizeTemplateHtml('<article><p>نص</p></article>')).toBe('<p>نص</p>');
  });

  it('strips event handlers, classes and links; keeps dir + text-align + col/rowspan', () => {
    const html =
      '<p dir="rtl" style="text-align: center" class="x" onclick="hack()">نص</p>' +
      '<td colspan="2" rowspan="1" data-x="1">خلية</td>';
    expect(sanitizeTemplateHtml(html)).toBe(
      '<p dir="rtl" style="text-align: center">نص</p><td colspan="2" rowspan="1">خلية</td>',
    );
  });

  it('rejects style values beyond text-align', () => {
    expect(sanitizeTemplateHtml('<p style="position:fixed">نص</p>')).toBe('<p>نص</p>');
  });
});

describe('extractPlaceholders', () => {
  it('returns distinct keys in document order, tolerating inner whitespace', () => {
    const html = '<p>{{ employee.fullName }} — {{contract.code}} — {{employee.fullName}}</p>';
    expect(extractPlaceholders(html)).toEqual(['employee.fullName', 'contract.code']);
  });

  it('ignores malformed braces', () => {
    expect(extractPlaceholders('{employee.fullName} {{bad key}} {{}}')).toEqual([]);
  });
});
