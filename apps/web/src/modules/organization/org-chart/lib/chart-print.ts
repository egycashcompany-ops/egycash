// Printing the org chart (P-ORG-3 §2.4): «إمكانية طباعة كل إدارة بشكل A4 بالعرض وزرار لطباعة الكل أو
// اللى أحدده».
//
// ONE DEPARTMENT, ONE SHEET. Each department is its own A4 page in landscape, under the company's
// letterhead (the logo and «ايجى كاش للحلول النقدية», as every paper the browser prints carries),
// drawn as the screen draws it: the department, the jobs directly under it, its sections side by side
// with each section's jobs under it — in the order the chart was given (§5.7), because that is the
// order the page reads `columnsOf` in.
//
// A PAGE THAT FITS. Landscape A4 is about 270 mm wide inside its margins. Up to `TREE_COLUMNS`
// columns share that width as the tree, connectors and all; a department with more is laid out in
// rows of columns instead, which a tree's connectors cannot follow across a line break. A long
// column runs onto the next sheet rather than shrinking out of legibility.
//
// No script in the document: the tab inherits the app's Content-Security-Policy (see
// `shared/lib/print-window.ts`), which opens the dialog from the app's own script.
import { type Locale, type OrgChartDepartmentDto, type OrgChartJobDto } from '@ecms/contracts';
import { EGYCASH_LOGO } from '@ecms/contracts/egycash-logo';
import { localized } from '../../../../shared/lib/format';
import { type DepartmentColumns } from './chart-model';

/** Up to this many columns a department prints as a tree; more, as rows of columns. */
export const TREE_COLUMNS = 7;

/** A column longer than this prints in the compact size, so a big section still fits its sheet. */
export const DENSE_FROM = 14;

const COLORS = {
  brand: '#2e2e74',
  text: '#1f2340',
  muted: '#6b6f86',
  line: '#9a9cb5',
  sectionFill: '#ececf7',
  directFill: '#f6f7fb',
  jobLine: '#c9cbdb',
} as const;

const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface ChartPrintLabels {
  company: string;
  /** «الهيكل التنظيمي لإدارة {name}» */
  structureOf: (name: string) => string;
  inBranches: (n: number) => string;
  sectionsCount: (n: number) => string;
  noSections: string;
  jobsCount: (n: number) => string;
  direct: string;
  noJobs: string;
  /** «طُبع في {date}» */
  printedOn: (date: string) => string;
  /** The tab's title. */
  documentTitle: string;
}

export interface ChartPrintPage {
  department: OrgChartDepartmentDto;
  columns: DepartmentColumns;
}

const jobList = (jobs: readonly OrgChartJobDto[], locale: Locale, spread = 1): string =>
  jobs.length === 0
    ? ''
    : `<ol class="jobs"${spread > 1 ? ` style="column-count:${String(spread)}"` : ''}>${jobs
        .map((job) => `<li>${esc(localized(job.name, locale))}</li>`)
        .join('')}</ol>`;

interface PrintColumn {
  title: string;
  direct: boolean;
  jobs: readonly OrgChartJobDto[];
}

const pageHtml = (
  { department, columns }: ChartPrintPage,
  locale: Locale,
  labels: ChartPrintLabels,
  printedOn: string,
): string => {
  const name = localized(department.name, locale);
  const facts = [
    labels.inBranches(department.branches.length),
    department.sections.length === 0
      ? labels.noSections
      : labels.sectionsCount(department.sections.length),
    labels.jobsCount(columns.jobCount),
  ].join(' · ');

  const longest = Math.max(
    department.sections.length === 0 ? 0 : columns.direct.length,
    ...[...columns.bySection.values()].map((jobs) => jobs.length),
    0,
  );
  const dense = longest > DENSE_FROM;
  let body: string;
  if (department.sections.length === 0) {
    // The jobs hang directly under the department; a long list spreads across the sheet's width.
    const spread = Math.min(4, Math.max(1, Math.ceil(columns.direct.length / 12)));
    body =
      columns.direct.length === 0
        ? `<p class="empty">${esc(labels.noJobs)}</p>`
        : `<div class="stem"></div><div class="only">${jobList(columns.direct, locale, spread)}</div>`;
  } else {
    const list: PrintColumn[] = [
      // «تابعة للإدارة مباشرة» first, and only when it has jobs: paper has no edit mode.
      ...(columns.direct.length > 0
        ? [{ title: labels.direct, direct: true, jobs: columns.direct }]
        : []),
      ...department.sections.map((section) => ({
        title: localized(section.name, locale),
        direct: false,
        jobs:
          section.sectionCatalogId === null
            ? []
            : (columns.bySection.get(section.sectionCatalogId.toLowerCase()) ?? []),
      })),
    ];
    const tree = list.length <= TREE_COLUMNS;
    body = `<div class="stem"></div><ul class="cols ${tree ? 'tree' : 'rows'}">${list
      .map(
        (column) =>
          `<li class="col"><div class="sec${column.direct ? ' direct' : ''}">${esc(column.title)}</div>${jobList(column.jobs, locale)}</li>`,
      )
      .join('')}</ul>`;
  }

  return `<section class="page${dense ? ' dense' : ''}">
  <div class="head">
    <img src="${EGYCASH_LOGO}" alt="EGYCASH" />
    <div class="rtitle">${esc(labels.structureOf(name))}</div>
    <div class="org"><div>${esc(labels.company)}</div><div class="facts">${esc(facts)}</div></div>
  </div>
  <hr class="rule" />
  <div class="chart">
    <div class="dept">${esc(name)}</div>
    ${body}
  </div>
  <div class="foot">${esc(labels.printedOn(printedOn))}</div>
</section>`;
};

/**
 * The printable document: one landscape A4 sheet per department, in the order given. Exported for
 * its test — composing it is where the rules live.
 */
export const buildChartPrintHtml = ({
  pages,
  locale,
  labels,
  printedOn,
}: {
  pages: readonly ChartPrintPage[];
  locale: Locale;
  labels: ChartPrintLabels;
  /** The date as it is to read on the sheet, already formatted. */
  printedOn: string;
}): string => {
  if (pages.length === 0) throw new Error('nothing to print');
  const rtl = locale === 'ar';
  const C = COLORS;
  return `<!doctype html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8" /><title>${esc(labels.documentTitle)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Tajawal:wght@400;500;700&display=swap');
  @page { size: A4 landscape; margin: 10mm 12mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Tajawal, Tahoma, sans-serif; color: ${C.text}; margin: 0; }
  .page { display: flex; flex-direction: column; min-height: 188mm; }
  .page + .page { break-before: page; page-break-before: always; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .head img { height: 40px; }
  .rtitle { flex: 1; text-align: center; font-family: Cairo, Tahoma, sans-serif; font-weight: 800; font-size: 18px; }
  .org { text-align: ${rtl ? 'right' : 'left'}; font-size: 12px; line-height: 1.8; font-weight: 700; }
  .org .facts { font-weight: 500; color: ${C.muted}; }
  .rule { border: none; border-top: 1px solid ${C.line}; margin: 8px 0 14px; }
  .chart { flex: 1; display: flex; flex-direction: column; align-items: center; }
  .dept { background: ${C.brand}; color: #fff; font-family: Cairo, Tahoma, sans-serif; font-weight: 800;
    font-size: 17px; padding: 9px 32px; border-radius: 8px; text-align: center; min-width: 70mm; }
  .stem { width: 0; height: 6mm; border-inline-start: 1px solid ${C.line}; }
  .only { width: 100%; display: flex; justify-content: center; }
  .only .jobs { min-width: 80mm; column-gap: 6mm; }
  ul.cols { list-style: none; margin: 0; padding: 0; width: 100%; }
  ul.cols.tree { display: flex; justify-content: center; }
  ul.cols.tree .col { flex: 1 1 0; min-width: 0; max-width: 75mm; position: relative; padding: 6mm 2mm 0; }
  /* The connectors, in logical sides so they mirror with the page: each column draws its half of the
     line along the top and the drop to its own box (the screen's BRANCH, in CSS). */
  ul.cols.tree .col::before, ul.cols.tree .col::after { content: ''; position: absolute; top: 0;
    width: 50%; height: 6mm; border-top: 1px solid ${C.line}; }
  ul.cols.tree .col::before { inset-inline-start: 0; }
  ul.cols.tree .col::after { inset-inline-end: 0; border-inline-start: 1px solid ${C.line}; }
  ul.cols.tree .col:first-child::before { border-top: 0; }
  ul.cols.tree .col:last-child::before { border-inline-end: 1px solid ${C.line}; }
  ul.cols.tree .col:last-child::after { border: 0; }
  ul.cols.tree .col:only-child::before { display: none; }
  ul.cols.tree .col:only-child::after { border-top: 0; border-inline-start: 1px solid ${C.line}; }
  /* More columns than a tree can carry: rows of columns under one rule. */
  ul.cols.rows { display: grid; grid-template-columns: repeat(auto-fill, minmax(36mm, 1fr)); gap: 5mm 3mm;
    border-top: 1px solid ${C.line}; padding-top: 5mm; }
  .sec { background: ${C.sectionFill}; border: 1px solid ${C.line}; border-radius: 6px; padding: 6px 8px;
    text-align: center; font-weight: 700; font-size: 14px; }
  .sec.direct { background: ${C.directFill}; border-style: dashed; color: ${C.muted}; }
  ol.jobs { list-style: none; margin: 4px 0 0; padding: 0; }
  ol.jobs li { border: 1px solid ${C.jobLine}; border-radius: 5px; padding: 5px 8px; margin: 0 0 4px;
    font-size: 13px; line-height: 1.45; text-align: center; background: #fff; break-inside: avoid; }
  .dense ol.jobs li { font-size: 10.5px; padding: 3px 6px; margin-bottom: 2px; }
  .dense .sec { font-size: 12px; padding: 4px 6px; }
  .empty { margin-top: 10mm; color: ${C.muted}; font-size: 12px; }
  .foot { margin-top: 8px; text-align: ${rtl ? 'left' : 'right'}; font-size: 10px; color: ${C.muted}; }
</style></head>
<body>
  ${pages.map((page) => pageHtml(page, locale, labels, printedOn)).join('\n')}
</body></html>`;
};
