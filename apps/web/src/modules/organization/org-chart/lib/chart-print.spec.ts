// The printed org chart (P-ORG-3 §2.4): «إمكانية طباعة كل إدارة بشكل A4 بالعرض وزرار لطباعة الكل أو
// اللى أحدده».
import { describe, expect, it } from 'vitest';
import { type OrgChartDepartmentDto, type OrgChartJobDto } from '@ecms/contracts';
import { columnsOf } from './chart-model';
import { buildChartPrintHtml, TREE_COLUMNS, type ChartPrintLabels } from './chart-print';

const MARKETING = 'f'.repeat(24);
const OPS = 'a'.repeat(24);
const TREASURY = 'c'.repeat(24);

const department = (
  id: string,
  name: string,
  sections: OrgChartDepartmentDto['sections'] = [],
): OrgChartDepartmentDto => ({
  key: `catalog:${id}`,
  departmentCatalogId: id,
  editable: true,
  name: { ar: name, en: name },
  branches: [{ id: 'b1', name: { ar: 'طنطا', en: 'Tanta' } }],
  linkedBranchIds: ['b1'],
  sections,
});
const section = (id: string, name: string): OrgChartDepartmentDto['sections'][number] => ({
  key: `catalog:${id}`,
  sectionCatalogId: id,
  editable: true,
  name: { ar: name, en: name },
  branches: [],
  catalogVersion: 0,
});
const job = (
  id: string,
  name: string,
  departmentCatalogId: string,
  sectionCatalogId: string | null,
  position: number | null,
): OrgChartJobDto => ({
  id,
  code: id,
  name: { ar: name, en: name },
  version: 1,
  places: [{ departmentCatalogId, sectionCatalogId, shown: true, position }],
});

const labels: ChartPrintLabels = {
  company: 'ايجى كاش للحلول النقدية',
  structureOf: (name) => `الهيكل التنظيمي لإدارة ${name}`,
  inBranches: (n) => `موجودة في ${String(n)} فروع`,
  sectionsCount: (n) => `${String(n)} أقسام`,
  noSections: 'بدون أقسام',
  jobsCount: (n) => `${String(n)} وظائف`,
  direct: 'تابعة للإدارة مباشرة',
  noJobs: 'لا توجد وظائف في هذه الإدارة بعد',
  printedOn: (date) => `طُبع في ${date}`,
  documentTitle: 'شجرة الهيكل التنظيمي',
};

const marketing = department(MARKETING, 'التسويق و التعاقدات');
const ops = department(OPS, 'العمليات', [section(TREASURY, 'الخزينة')]);
const jobs = [
  job('m1', 'اخصائى اول تسويق', MARKETING, null, 1),
  job('m2', 'مدير التسويق والتعاقدات', MARKETING, null, 0),
  job('m3', 'استشارى تسويق', MARKETING, null, 2),
  job('o1', 'أمين خزينة', OPS, TREASURY, null),
  job('o2', 'مدير العمليات', OPS, null, null),
];

const print = (departments: OrgChartDepartmentDto[]): string =>
  buildChartPrintHtml({
    pages: departments.map((d) => ({ department: d, columns: columnsOf(d, jobs) })),
    locale: 'ar',
    labels,
    printedOn: '18/11/2026',
  });

describe('the printed org chart', () => {
  it('is A4 in landscape, one department to a sheet, in the order asked', () => {
    const html = print([ops, marketing]);
    expect(html).toContain('@page { size: A4 landscape;');
    expect(html.match(/<section class="page">/g)).toHaveLength(2);
    expect(html).toContain('.page + .page { break-before: page;');
    expect(html.indexOf('الهيكل التنظيمي لإدارة العمليات')).toBeLessThan(
      html.indexOf('الهيكل التنظيمي لإدارة التسويق و التعاقدات'),
    );
    expect(html).toContain('dir="rtl"');
  });

  it('carries the letterhead, the department facts and the print date on every sheet', () => {
    const html = print([marketing, ops]);
    expect(html.match(/<img src="data:image/g)).toHaveLength(2);
    expect(html.match(/ايجى كاش للحلول النقدية/g)).toHaveLength(2);
    expect(html).toContain('موجودة في 1 فروع · بدون أقسام · 3 وظائف');
    expect(html.match(/طُبع في 18\/11\/2026/g)).toHaveLength(2);
  });

  it('lists the jobs in the order the chart was given', () => {
    const html = print([marketing]);
    const at = ['مدير التسويق والتعاقدات', 'اخصائى اول تسويق', 'استشارى تسويق'].map((n) =>
      html.indexOf(`<li>${n}</li>`),
    );
    expect(at.every((i) => i > 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('draws the sections side by side, the direct column first, as a tree', () => {
    const html = print([ops]);
    expect(html).toContain('<ul class="cols tree">');
    expect(html.indexOf('تابعة للإدارة مباشرة')).toBeLessThan(html.indexOf('الخزينة'));
    expect(html).toContain('<li>أمين خزينة</li>');
    expect(html).toContain('<li>مدير العمليات</li>');
  });

  it('lays out more columns than a tree can carry in rows instead', () => {
    const many = department(
      OPS,
      'العمليات',
      Array.from({ length: TREE_COLUMNS + 1 }, (_, i) => section(String(i).repeat(24), `قسم ${String(i)}`)),
    );
    expect(print([many])).toContain('<ul class="cols rows">');
  });

  it('says so for a department with no jobs, and never prints markup from a name', () => {
    const empty = department('e'.repeat(24), 'الحركة <b>');
    const html = print([empty]);
    expect(html).toContain('لا توجد وظائف في هذه الإدارة بعد');
    expect(html).toContain('الحركة &lt;b&gt;');
    expect(html).not.toContain('الحركة <b>');
    // No script of its own: the tab inherits the app's CSP (shared/lib/print-window.ts).
    expect(html).not.toMatch(/<script|onclick=/i);
  });

  it('refuses to print nothing', () => {
    expect(() => print([])).toThrow();
  });
});

describe('«طباعة الكل أو اللى أحدده»', () => {
  it('prints every department, or only the ticked ones — in the page\'s order either way', async () => {
    const { departmentsToPrint } = await import('../components/PrintChartDialog');
    const all = [ops, marketing];
    expect(departmentsToPrint(all, 'all', new Set()).map((d) => d.key)).toEqual([ops.key, marketing.key]);
    expect(departmentsToPrint(all, 'chosen', new Set([marketing.key, ops.key])).map((d) => d.key)).toEqual([
      ops.key,
      marketing.key,
    ]);
    expect(departmentsToPrint(all, 'chosen', new Set([marketing.key])).map((d) => d.key)).toEqual([marketing.key]);
    expect(departmentsToPrint(all, 'chosen', new Set())).toEqual([]);
  });
});

describe('a long column', () => {
  it('prints in the compact size so the section still fits its sheet', async () => {
    const { DENSE_FROM } = await import('./chart-print');
    const many = Array.from({ length: DENSE_FROM + 1 }, (_, i) => job(`x${String(i)}`, `وظيفة ${String(i)}`, OPS, TREASURY, i));
    const html = buildChartPrintHtml({
      pages: [{ department: ops, columns: columnsOf(ops, many) }],
      locale: 'ar',
      labels,
      printedOn: '18/11/2026',
    });
    expect(html).toContain('<section class="page dense">');
    expect(print([ops])).toContain('<section class="page">');
  });
});
