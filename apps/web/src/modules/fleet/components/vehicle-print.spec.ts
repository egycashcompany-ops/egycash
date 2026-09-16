// The printed sheet is ONE page — «عاوز لما اجى اطبع صوره الرخصه تكون فى صفحه واحده مع الجدول».
//
// The rule is CSS, and the only honest test of CSS is a page count — which this suite cannot
// take (no layout engine). It was taken once, by hand, with Chromium's print-to-PDF: the record
// sheet with twelve rows and a tall scan went from two pages to one, and the licence card stayed
// at one. What is pinned here is the SHAPE of the stylesheet that produced that count, so the
// two things that would send the scan back to page two cannot come back by hand: a fixed ceiling
// on the image, and a rule forbidding a break inside a section that then has to move whole.
import { describe, expect, it } from 'vitest';
import { buildVehiclePrintHtml, type VehiclePrintDocument } from './vehicle-print';

const doc = (rows: number): VehiclePrintDocument => ({
  locale: 'ar',
  title: 'بيانات السيارة',
  subtitle: 'كود العربية: 530',
  rows: Array.from({ length: rows }, (_, i) => ({ label: `الحقل ${i}`, value: `${i}` })),
  licenseImage: {
    heading: 'صورة رخصة السيارة',
    caption: 'كود العربية: 530',
    fetch: async () => new Blob(),
  },
});

const style = (html: string): string => html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

describe('the printed sheet fits one page', () => {
  it('gives the image WHAT IS LEFT of the page, instead of a fixed height it may not have', () => {
    const css = style(buildVehiclePrintHtml(doc(12), 'data:image/png;base64,AAAA'));
    // The page is a column as tall as the paper; the image section is the flexible part of it.
    expect(css).toMatch(/html,\s*body\s*\{[^}]*height:\s*100%/);
    expect(css).toMatch(/body\s*\{[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/\.image\s*\{[^}]*flex:\s*1 1 auto/);
    expect(css).toMatch(/\.image\s*\{[^}]*min-height:\s*0/);
    expect(css).toMatch(/\.image img\s*\{[^}]*object-fit:\s*contain/);
  });

  it('carries neither of the two rules that sent the scan to page two', () => {
    const css = style(buildVehiclePrintHtml(doc(12), 'data:image/png;base64,AAAA'));
    // A ceiling in millimetres is a height the page may not have left; a no-break rule on a
    // section that does not fit moves the WHOLE section to the next page.
    expect(css).not.toMatch(/max-height:\s*\d+mm/);
    expect(css).not.toContain('page-break-inside');
    expect(css).not.toContain('break-inside');
  });

  it('keeps the stylesheet free of backticks — it lives inside a template literal', () => {
    // A backtick in a CSS comment ended the template early once and broke the build.
    expect(style(buildVehiclePrintHtml(doc(3), null))).not.toContain('`');
  });

  it('omits the image section entirely when there is no scan, as before', () => {
    const html = buildVehiclePrintHtml({ ...doc(3), licenseImage: null }, null);
    expect(html).not.toContain('class="image"');
    expect(html).toContain('<table>');
  });
});
