// The consumables register as a file (FR-20) — what its Excel and PDF say, item by item, and the
// filters its printed page names. What every register shares is `register-export.spec.ts`.
import { describe, expect, it } from 'vitest';
import { type ItConsumableDto } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { buildFleetReportHtml } from '../../fleet/lib/fleet-report-print';
import {
  consumableRegisterFilters,
  consumableRegisterHeader,
  consumableRegisterLine,
  consumableRegisterReport,
  consumableRegisterSubtitle,
  paperCells,
  type ConsumableRegisterContext,
} from './consumable-register-export';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const context: ConsumableRegisterContext = {
  t,
  locale: 'ar',
  branchName: new Map([['b-hq', 'المهندسين']]),
  typeName: new Map([['ty-mice', 'ماوس']]),
};

const item = (over: Partial<ItConsumableDto> = {}): ItConsumableDto => ({
  id: 'c-1',
  code: 'CON-00004',
  name: 'Mouse',
  typeId: 'ty-mice',
  unit: 'قطعة',
  branchId: 'b-hq',
  minQty: 5,
  notes: null,
  active: true,
  onHandQty: 13,
  issuedQty: 4,
  scrappedQty: 1,
  belowMin: false,
  version: 0,
  createdAt: '2026-10-28T09:00:00.000Z',
  updatedAt: '2026-10-28T09:00:00.000Z',
  ...over,
});

describe('the consumables register’s columns', () => {
  it('are the table’s, then the minimum mark and the state', () => {
    expect(consumableRegisterHeader(t)).toEqual([
      'الكود',
      'الصنف',
      'النوع',
      'الفرع',
      'الوحدة',
      'الرصيد',
      'المنصرف',
      'الهالك',
      'الحد الأدنى',
      'بلغ الحد الأدنى',
      'الحالة',
    ]);
  });

  it('write an item as the table shows it — the quantities as NUMBERS, so a column sums', () => {
    expect(consumableRegisterLine(item(), context, '')).toEqual([
      'CON-00004',
      'Mouse',
      'ماوس',
      'المهندسين',
      'قطعة',
      13,
      4,
      1,
      5,
      '',
      'نشط',
    ]);
  });

  it('mark an item at its minimum, and a retired one, in words — a file has no colour', () => {
    const cells = consumableRegisterLine(
      item({ onHandQty: 2, belowMin: true, active: false }),
      context,
      '',
    );
    expect(cells.slice(5, 6)).toEqual([2]);
    expect(cells.slice(9)).toEqual(['بلغ الحد الأدنى', 'موقوف']);
  });

  it('leave a blank where the table shows a dash: no minimum, an unknown type or branch', () => {
    const cells = consumableRegisterLine(
      item({ minQty: null, typeId: 'ty-gone', branchId: 'b-gone' }),
      context,
      '',
    );
    expect(cells[2]).toBe('');
    expect(cells[3]).toBe('');
    expect(cells[8]).toBe('');
  });
});

describe('the filters the printed page names', () => {
  const screen = {
    active: 'true',
    typeId: '',
    typeName: context.typeName,
    branchId: '',
    branchName: context.branchName,
    belowMin: false,
    search: '',
  };

  it('are the active items of every type and branch when none is set', () => {
    expect(
      consumableRegisterSubtitle(t, { ...consumableRegisterFilters(screen), asOf: 'اليوم' }),
    ).toBe('الأصناف النشطة · كل الأنواع · كل الفروع · بتاريخ اليوم');
  });

  it('name each filter in force — the type, the branch, the minimum, the search', () => {
    expect(
      consumableRegisterSubtitle(t, {
        ...consumableRegisterFilters({
          ...screen,
          active: 'all',
          typeId: 'ty-mice',
          branchId: 'b-hq',
          belowMin: true,
          search: ' mouse ',
        }),
        asOf: 'اليوم',
      }),
    ).toBe(
      'النشطة والموقوفة · ماوس · المهندسين · ما بلغ الحد الأدنى فقط · البحث: mouse · بتاريخ اليوم',
    );
  });

  it('never drop a filter in force whose name cannot be had', () => {
    const filters = consumableRegisterFilters({
      ...screen,
      active: 'false',
      typeId: 'ty-gone',
      branchId: 'b-closed',
    });
    expect(filters).toMatchObject({ active: 'false', type: '', branch: '' });
    expect(consumableRegisterSubtitle(t, { ...filters, asOf: 'اليوم' })).toBe(
      'الأصناف الموقوفة · نوع محدد · فرع محدد · بتاريخ اليوم',
    );
  });
});

describe('the printed consumables register', () => {
  const report = consumableRegisterReport(
    [item(), item({ id: 'c-2', minQty: null, onHandQty: 0 })],
    context,
    'الأصناف النشطة',
  );
  const html = buildFleetReportHtml(report);

  it('is «المستهلكات» on the company form, landscape for eleven columns', () => {
    expect(report.title).toBe('المستهلكات');
    expect(report.orientation).toBe('landscape');
    expect(report.header).toHaveLength(11);
    expect(html).toContain('CON-00004');
    expect(html).toContain('ماوس');
  });

  it('writes the figures in the reader’s digits and marks a blank box with a dash', () => {
    expect(report.rows[0]?.slice(5, 9)).toEqual(['١٣', '٤', '١', '٥']);
    expect(report.rows[1]?.[5]).toBe('٠');
    expect(report.rows[1]?.[8]).toBe('—');
    for (const cell of report.rows[0] ?? []) expect(typeof cell).toBe('string');
  });

  it('turns only numbers into words', () => {
    expect(paperCells(['CON-1', 3, ''], 'en')).toEqual(['CON-1', '3', '']);
  });
});
