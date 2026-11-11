// D6/D7 + A11 — the template sanitizer (allow-list, no active content survives) and
// placeholder extraction (distinct, document order).
import { describe, expect, it } from 'vitest';
import { allowedClasses, extractPlaceholders, sanitizeTemplateHtml } from './template-html';

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

  it('keeps only the paper layout classes (A27), once each, and drops any other', () => {
    expect(sanitizeTemplateHtml('<table class="plain evil t14 plain"><tr><td class="x">خلية</td></tr></table>')).toBe(
      '<table class="plain t14"><tr><td>خلية</td></tr></table>',
    );
    expect(sanitizeTemplateHtml('<p class="l2 t16">نص</p>')).toBe('<p class="l2 t16">نص</p>');
    expect(sanitizeTemplateHtml('<p class="" onclick="x">نص</p>')).toBe('<p>نص</p>');
    expect(allowedClasses('band foot "><script>')).toBe('band foot');
    expect(allowedClasses('none at all')).toBeNull();
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
