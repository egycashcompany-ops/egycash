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
    version: 0,
    createdAt: '2026-10-07T09:00:00.000Z',
    updatedAt: '2026-10-07T09:00:00.000Z',
    ...over,
  }) as ItAssetDto;

describe('the asset register’s columns', () => {
  it('are the table’s, in its order', () => {
    expect(assetRegisterHeader(t)).toEqual([
      'الكود',
      'الاسم',
      'الفئة',
      'الرقم التسلسلي',
      'الفرع',
      'الحالة',
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
    ]);
  });

  it('leave a blank where the table shows a dash', () => {
    const line = assetRegisterLine(
      asset({ serialNumber: null, categoryId: 'c-gone', branchId: 'b-gone', status: 'inStock' }),
      context,
      '—',
    );
    expect(line.slice(2)).toEqual(['—', '—', '—', t('it.assets.status.inStock')]);
  });
});

describe('the filters the printed page names', () => {
  const screen = {
    search: '',
    status: '',
    categoryId: '',
    categoryName: context.categoryName,
    branchId: '',
    branchName: context.branchName,
    holderId: '',
    holderLabel: '',
  };

  it('are «every» status, category and branch when none is set', () => {
    expect(assetRegisterSubtitle(t, { ...assetRegisterFilters(screen), asOf: 'اليوم' })).toBe(
      'كل الحالات · كل الفئات · كل الفروع · بتاريخ اليوم',
    );
  });

  it('name each filter in force, the holder and the search included', () => {
    expect(
      assetRegisterSubtitle(t, {
        ...assetRegisterFilters({
          ...screen,
          search: '  Lenovo ',
          status: 'assigned',
          categoryId: 'c-laptop',
          branchId: 'b-hq',
          holderId: 'e-1',
          holderLabel: 'محمد أحمد علي (0100052)',
        }),
        asOf: 'اليوم',
      }),
    ).toBe(
      `${t('it.assets.status.assigned')} · لاب توب · المهندسين · المستلِم: محمد أحمد علي (0100052) · البحث: Lenovo · بتاريخ اليوم`,
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
});

describe('the printed asset register', () => {
  const report = assetRegisterReport([asset()], context, 'كل الحالات');
  const html = buildFleetReportHtml(report);

  it('is «الأصول» on the company form, portrait — six columns fit', () => {
    expect(report.title).toBe('الأصول');
    expect(report.orientation).toBe('portrait');
    expect(html).toContain('@page { size: A4 portrait; margin: 14mm; }');
    expect(html).toContain('PF3ABC12');
  });
});
