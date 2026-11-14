// The reports' files (`lib/report-export.ts`), asserted directly — «و ان اكسيل او pdf» on «تقرير القادة»
// and «تقرير البنوك»: EXACTLY what the screen shows (the rows the name filter left, «الإجمالي» under
// them, the money split the table's way), through the app's one xlsx writer and the company's report
// form; the vault's panel as a second sheet and a second printed page.
import { describe, expect, it } from 'vitest';
import {
  type OperationsCurrencyDto,
  type OperationsReportCurrencyTotalDto,
  type OperationsReportTotalsDto,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { buildFleetReportHtml } from '../../fleet/lib/fleet-report-print';
import {
  reportTableLines,
  reportView,
  type ReportBoardRow,
  type ReportTableLine,
} from './report-board';
import {
  reportExportHeader,
  reportExportSubtitle,
  reportExportTable,
  reportPrintDoc,
  reportSheet,
  vaultPanelExport,
} from './report-export';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const T = '2026-01-01T00:00:00.000Z';
const currency = (
  id: string,
  code: string,
  name: string,
  sortOrder: number,
): OperationsCurrencyDto => ({
  id,
  code,
  name,
  legacyAliases: [],
  sortOrder,
  isActive: true,
  version: 0,
  createdAt: T,
  updatedAt: T,
});
/** The production catalog's shape — the legacy numbers as codes. */
const CATALOG = [
  currency('egp', '1', 'مصري', 0),
  currency('usd', '2', 'دولار', 1),
  currency('eur', '3', 'يورو', 2),
  currency('sar', '6', 'ريال سعودي', 3),
];
const line = (
  currencyId: string,
  currencyName: string,
  amount: number,
): OperationsReportCurrencyTotalDto => ({ currencyId, currencyName, amount });
const totals = (
  shipmentCount: number,
  [bagCount, cartonCount, boxCount]: [number, number, number],
  currencies: OperationsReportCurrencyTotalDto[],
): OperationsReportTotalsDto => ({ shipmentCount, bagCount, cartonCount, boxCount, currencies });

const ROWS: ReportBoardRow[] = [
  {
    key: 'ba',
    label: 'الأهلي',
    unattributed: false,
    totals: totals(
      14,
      [10, 0, 0],
      [
        line('egp', 'مصري', 48_500_000),
        line('usd', 'دولار', 1_250_000),
        line('sar', 'ريال سعودي', 300_000),
        line('eur', 'يورو', 20_000),
      ],
    ),
  },
  {
    key: 'bu',
    label: 'الأهلي المتحد',
    unattributed: false,
    totals: totals(7, [32, 4, 0], [line('egp', 'مصري', 20_500_000), line('usd', 'دولار', 610_000)]),
  },
  {
    key: 'bm',
    label: 'مصر',
    unattributed: false,
    totals: totals(13, [17, 1, 1], [line('egp', 'مصري', 46_750_000)]),
  },
  { key: 'none', label: '', unattributed: true, totals: totals(1, [0, 0, 0], []) },
];
/** The server's grand total — not what the rows add up to, so the files can only have it from here. */
const GRAND = totals(
  99,
  [111, 22, 33],
  [line('egp', 'مصري', 123_456_000), line('usd', 'دولار', 7_000_000)],
);

const nameOf = (l: ReportTableLine): string =>
  l.kind === 'total'
    ? t('operations.reportBoard.total')
    : l.unattributed
      ? t('operations.reports.unattributed')
      : l.label;
const HEADER = reportExportHeader(
  t,
  t('operations.reports.bank'),
  t('operations.vaultReport.securedCount'),
);

describe('reportExportHeader — the screen’s column heads, after «م»', () => {
  it('reads as the table reads', () => {
    expect(HEADER).toEqual([
      'البنك',
      'عدد المحصنات',
      'المصري',
      'الدولار',
      'عملات أخرى',
      'الحقائب',
      'كرتونة',
      'صندوق',
    ]);
  });
});

describe('reportExportTable — what is shown, as numbers', () => {
  it('carries every row shown, in order, and the SERVER’s «الإجمالي» with no name typed', () => {
    const view = reportView(ROWS, GRAND, '', t('operations.reports.unattributed'));
    const table = reportExportTable(
      reportTableLines(view.rows, view.total),
      CATALOG,
      HEADER,
      nameOf,
    );
    expect(table.rows).toEqual([
      // «عملات أخرى»: the riyal and the euro — the dollar is its own column.
      ['الأهلي', 14, 48_500_000, 1_250_000, 320_000, 10, 0, 0],
      ['الأهلي المتحد', 7, 20_500_000, 610_000, 0, 32, 4, 0],
      ['مصر', 13, 46_750_000, 0, 0, 17, 1, 1],
      ['غير منسوب', 1, 0, 0, 0, 0, 0, 0],
    ]);
    expect(table.total).toEqual(['الإجمالي', 99, 123_456_000, 7_000_000, 0, 111, 22, 33]);
  });

  it('carries only the rows a name left — and THEIR total, as the screen shows it', () => {
    const view = reportView(ROWS, GRAND, 'الاهلي', t('operations.reports.unattributed'));
    const table = reportExportTable(
      reportTableLines(view.rows, view.total),
      CATALOG,
      HEADER,
      nameOf,
    );
    expect(table.rows.map((row) => row[0])).toEqual(['الأهلي', 'الأهلي المتحد']);
    expect(table.total).toEqual(['الإجمالي', 21, 69_000_000, 1_860_000, 320_000, 42, 4, 0]);
  });

  it('has nothing to carry when nothing is shown', () => {
    expect(reportExportTable([], CATALOG, HEADER, nameOf)).toEqual({
      header: HEADER,
      rows: [],
      total: null,
    });
  });
});

describe('vaultPanelExport — «إجمالي قيمة الشحنات» top to bottom, as the panel lists it', () => {
  it('the two sums, then every currency of the reference list but the pound, zeros included', () => {
    const panel = vaultPanelExport(t, GRAND, CATALOG);
    expect(panel.header).toEqual(['البيان', 'المبلغ']);
    expect(panel.rows).toEqual([
      ['إجمالي المصري', 123_456_000],
      // The dollar INCLUDED in the foreign sum, as legacy's panel.
      ['إجمالي العملات الأجنبية', 7_000_000],
      ['دولار', 7_000_000],
      ['يورو', 0],
      ['ريال سعودي', 0],
    ]);
  });
});

describe('reportExportSubtitle — what the page is a view OF', () => {
  it('says the period, each day kept in its own order inside the Arabic line', () => {
    expect(reportExportSubtitle(t, { period: { from: '2026-11-01', to: '2026-11-30' } })).toBe(
      'الفترة من ⁦2026-11-01⁩ إلى ⁦2026-11-30⁩',
    );
  });

  it('adds the name filter when one is typed — never leaves a filter in force off the paper', () => {
    expect(
      reportExportSubtitle(t, {
        period: { from: '2026-11-01', to: '2026-11-30' },
        filter: { label: 'اسم القائد', value: ' احمد ' },
      }),
    ).toBe('الفترة من ⁦2026-11-01⁩ إلى ⁦2026-11-30⁩ · تصفية اسم القائد: احمد');
    expect(
      reportExportSubtitle(t, {
        period: { from: '2026-11-01', to: '2026-11-30' },
        filter: { label: 'اسم القائد', value: '  ' },
      }),
    ).not.toContain('تصفية');
  });

  it('is empty for a live report with no filter', () => {
    expect(reportExportSubtitle(t, {})).toBe('');
  });
});

describe('the workbook sheet and the printed form', () => {
  const view = reportView(ROWS, GRAND, '', t('operations.reports.unattributed'));
  const table = reportExportTable(reportTableLines(view.rows, view.total), CATALOG, HEADER, nameOf);

  it('writes the table as a sheet: «م» generated, numbers kept numbers, «الإجمالي» its bottom line', () => {
    const sheet = reportSheet('بيان الشحنات لكل بنك', 'م', table);
    expect(sheet.serialHeader).toBe('م');
    expect(sheet.header).toEqual(HEADER);
    expect(sheet.rows[0]).toEqual(['الأهلي', 14, 48_500_000, 1_250_000, 320_000, 10, 0, 0]);
    expect(sheet.totals).toEqual(table.total);
  });

  it('writes no bottom line for a list that has none (the panel)', () => {
    const sheet = reportSheet('إجمالي قيمة الشحنات', 'م', vaultPanelExport(t, GRAND, CATALOG));
    expect(sheet).not.toHaveProperty('totals');
  });

  it('prints on the company form: Operations under the letterhead, the figures as the screen prints them', () => {
    const doc = reportPrintDoc({
      t,
      locale: 'ar',
      title: 'تقرير البنوك',
      subtitle: 'الفترة',
      table,
    });
    expect(doc.department).toBe('إدارة العمليات');
    expect(doc.serialHeader).toBe('م');
    expect(doc.signatories).toBeUndefined();
    expect(doc.rows[0]).toEqual([
      'الأهلي',
      '14',
      '48,500,000',
      '1,250,000',
      '320,000',
      '10',
      '0',
      '0',
    ]);
    expect(doc.totalLine).toEqual([
      'الإجمالي',
      '99',
      '123,456,000',
      '7,000,000',
      '0',
      '111',
      '22',
      '33',
    ]);
    expect(doc.totals).toEqual([]);
  });

  it('draws «الإجمالي» inside the table, under the rows, a figure under every column', () => {
    const doc = reportPrintDoc({ t, locale: 'ar', title: 'تقرير البنوك', subtitle: '', table });
    const html = buildFleetReportHtml(doc);
    const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
    const last = body.slice(body.lastIndexOf('<tr'));
    expect(last).toContain('class="trow"');
    expect(last).toContain('<td class="ser"></td><td>الإجمالي</td><td>99</td><td>123,456,000</td>');
    // Once — never a row of the body as well.
    expect(body.match(/الإجمالي/g)).toHaveLength(1);
  });
});
