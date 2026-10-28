// «اعمل نفس الزرارين في شاشة الأصول» — what the asset register's files say, line by line, and the
// filters its printed page names. What every register shares is `register-export.spec.ts`.
import { describe, expect, it } from 'vitest';
import { type ItAssetDto } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { buildFleetReportHtml } from '../../fleet/lib/fleet-report-print';
import {
  assetRegisterFilters,
  assetRegisterHeader,
  assetRegisterLine,
  assetRegisterReport,
  assetRegisterSubtitle,
  type AssetRegisterContext,
} from './asset-register-export';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const context: AssetRegisterContext = {
  t,
  categoryName: new Map([['c-laptop', 'لاب توب']]),
  branchName: new Map([['b-hq', 'المهندسين']]),
};

const HOLDER = {
  employeeId: 'e-1',
  employeeCode: '0100052',
  employeeName: 'محمد أحمد علي',
  assignedAt: '2026-10-07T09:00:00.000Z',
};

const asset = (over: Partial<ItAssetDto> = {}): ItAssetDto =>
  ({
    id: 'asset-1',
    assetCode: 'AST-00012',
    name: 'لاب توب Lenovo',
    description: null,
    categoryId: 'c-laptop',
    status: 'assigned',
    serialNumber: 'PF3ABC12',
    model: null,
    manufacturer: null,
    externalTag: null,
    branchId: 'b-hq',
    location: null,
    purchase: null,
    warranty: null,
    currentAssignmentId: 'a-1',
    disposal: null,
    notes: null,
    specs: null,
    accessories: [],
    holder: HOLDER,
    version: 0,
    createdAt: '2026-10-07T09:00:00.000Z',
    updatedAt: '2026-10-07T09:00:00.000Z',
    ...over,
  }) as ItAssetDto;

/** An asset back in stock: no interval open, nobody holding it. */
const inStock = (over: Partial<ItAssetDto> = {}): ItAssetDto =>
  asset({ status: 'inStock', currentAssignmentId: null, holder: null, ...over });

describe('the asset register’s columns', () => {
  it('are the table’s, in its order — the holder after the status, its code a column of its own', () => {
    expect(assetRegisterHeader(t)).toEqual([
      'الكود',
      'الاسم',
      'الفئة',
      'الرقم التسلسلي',
      'الفرع',
      'الحالة',
      'المستلِم',
      'كود الموظف',
    ]);
  });

  it('write an asset as the table shows it, the code and serial kept as text', () => {
    expect(assetRegisterLine(asset(), context, '')).toEqual([
      'AST-00012',
      'لاب توب Lenovo',
      'لاب توب',
      'PF3ABC12',
      'المهندسين',
      t('it.assets.status.assigned'),
      'محمد أحمد علي',
      '0100052',
    ]);
  });

  it('leave a blank cell in the sheet where the table shows a dash', () => {
    // '' is what the screen passes for the workbook: an empty cell, not a «—» to filter around.
    const line = assetRegisterLine(
      inStock({ serialNumber: null, categoryId: 'c-gone', branchId: 'b-gone' }),
      context,
      '',
    );
    expect(line.slice(2)).toEqual(['', '', '', t('it.assets.status.inStock'), '', '']);
  });

  it('write a holder HR cannot name by the id the row carries — never a guess', () => {
    const line = assetRegisterLine(
      asset({ holder: { ...HOLDER, employeeId: 'e-9', employeeCode: null, employeeName: null } }),
      context,
      '',
    );
    expect(line.slice(6)).toEqual(['e-9', '']);
  });
});

describe('the filters the printed page names', () => {
  const screen = {
    search: '',
    status: '',
    name: '',
    categoryId: '',
    categoryName: context.categoryName,
    branchId: '',
    branchName: context.branchName,
    holderId: '',
    holderLabel: '',
    rows: [] as ItAssetDto[],
  };

  it('are «every» status, category and branch when none is set', () => {
    expect(assetRegisterSubtitle(t, { ...assetRegisterFilters(screen), asOf: 'اليوم' })).toBe(
      'كل الحالات · كل الفئات · كل الفروع · بتاريخ اليوم',
    );
  });

  it('name each filter in force, in the bar’s order — the name, the holder and the search included', () => {
    expect(
      assetRegisterSubtitle(t, {
        ...assetRegisterFilters({
          ...screen,
          search: '  Lenovo ',
          status: 'assigned',
          name: 'Lenovo ThinkCentre neo 50a 24',
          categoryId: 'c-laptop',
          branchId: 'b-hq',
          holderId: 'e-1',
          holderLabel: 'محمد أحمد علي (0100052)',
        }),
        asOf: 'اليوم',
      }),
    ).toBe(
      `${t('it.assets.status.assigned')} · الاسم: Lenovo ThinkCentre neo 50a 24 · لاب توب · المهندسين · المستلِم: محمد أحمد علي (0100052) · البحث: Lenovo · بتاريخ اليوم`,
    );
  });

  it('never drop a filter in force whose name cannot be had', () => {
    const filters = assetRegisterFilters({
      ...screen,
      categoryId: 'c-gone',
      branchId: 'b-closed',
      holderId: 'e-7',
    });
    expect(filters).toMatchObject({ category: '', branch: '', holder: 'e-7' });
    expect(assetRegisterSubtitle(t, { ...filters, asOf: 'اليوم' })).toBe(
      'كل الحالات · فئة محددة · فرع محدد · المستلِم: e-7 · بتاريخ اليوم',
    );
  });

  /** Arriving on a link, the chip may not have its label yet — but every row it printed is theirs. */
  it('name the holder from the gathered rows when the chip has no label', () => {
    const filters = assetRegisterFilters({ ...screen, holderId: 'e-1', rows: [asset()] });
    expect(filters.holder).toBe('محمد أحمد علي');
  });
});

describe('the printed asset register', () => {
  const report = assetRegisterReport(
    [asset(), inStock({ id: 'asset-2', serialNumber: null })],
    context,
    'كل الحالات',
  );
  const html = buildFleetReportHtml(report);

  it('is «الأصول» on the company form, landscape — eight columns, the holder’s two among them', () => {
    expect(report.title).toBe('الأصول');
    expect(report.orientation).toBe('landscape');
    expect(html).toContain('@page { size: A4 landscape; margin: 14mm; }');
    expect(html).toContain('PF3ABC12');
    expect(html).toContain('محمد أحمد علي');
  });

  it('marks a blank box with a dash on paper — a serial it lacks, a holder nobody is', () => {
    expect(report.rows[1]?.[3]).toBe('—');
    expect(report.rows[1]?.slice(6)).toEqual(['—', '—']);
  });
});
