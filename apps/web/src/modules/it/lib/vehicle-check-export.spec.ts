// «آخر التقارير» as Excel and as a printed PDF, under the page's filters — what each line says, the
// filters the printed page names, and that the file asks the reports list for EVERY page. That the
// print opens its tab before it gathers the rows is `register-export.spec.ts`.
import { describe, expect, it } from 'vitest';
import {
  IT_VEHICLE_CHECK_ITEMS,
  type ItVehicleCheckAnswer,
  type ItVehicleCheckDto,
  type ItVehicleCheckItem,
  type Paginated,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { formatBusinessDateTime } from '../../../shared/lib/format';
import { buildFleetReportHtml } from '../../fleet/lib/fleet-report-print';
import { type QueryParams } from '../../../shared/lib/api-client';
import { gatherRegister } from './register-export';
import {
  formatYmd,
  reportsQuery,
  reportsWindow,
  type VehicleCheckFilters,
} from './vehicle-check-dashboard';
import {
  vehicleCheckPaperLine,
  vehicleCheckRegisterFilters,
  vehicleCheckRegisterHeader,
  vehicleCheckRegisterReport,
  vehicleCheckRegisterSubtitle,
  vehicleCheckSheetLine,
  type VehicleCheckRegisterContext,
} from './vehicle-check-export';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

/** A day as the page prints it — the reader's own calendar words, whatever the runtime's ICU. */
const day = (ymd: string): string => formatYmd(ymd, 'ar');

const B_OCT = 'b-oct';
const context: VehicleCheckRegisterContext = {
  t,
  locale: 'ar',
  branchName: new Map([[B_OCT, 'أكتوبر']]),
};

type Items = Record<ItVehicleCheckItem, ItVehicleCheckAnswer | null>;
const items = (over: Partial<Items> = {}): Items => ({
  ...(Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((item) => [item, 'works'])) as Items),
  ...over,
});

const report = (over: Partial<ItVehicleCheckDto> = {}): ItVehicleCheckDto => ({
  id: 'r-1',
  version: 0,
  vehicleId: 'v-corolla',
  vehicleCode: 'كورولا 1',
  branchId: B_OCT,
  checkDate: '2026-11-08',
  items: items({ dvr: 'notWorking', radio: 'notWorking', camera8: null }),
  notes: 'الـ DVR لا يسجّل، وجهاز الاتصال بلا إرسال.',
  photos: [
    {
      clientPhotoId: '7d3c1a52-6c1b-4a8e-9b51-0d1f2a3b4c5d',
      fileId: 'f-1',
      fileName: 'p1.jpg',
      mime: 'image/jpeg',
      size: 1000,
      uploadedAt: '2026-11-08T14:36:00.000Z',
    },
  ],
  reportedByUserId: 'u-2',
  reportedByName: 'شريف ممدوح فاروق',
  clientRequestId: '0b8f7a8e-2d4c-4f61-9a7b-3c2d1e0f9a8b',
  createdAt: '2026-11-08T14:35:00.000Z',
  ...over,
});

describe('the register’s columns', () => {
  it('are who and when, the eleven devices in the owner’s order, then the counts and the note', () => {
    const header = vehicleCheckRegisterHeader(t, 'ar');
    expect(header.slice(0, 5)).toEqual(['السيارة', 'الفرع', 'يوم الفحص', 'وقت الإرسال', 'أرسله']);
    expect(header[5]).toBe('الشاشة');
    expect(header[6]).toBe('كاميرا ١ — أمام المركبة');
    // One digit system in a heading: «داخل الخزينة ١», as the sample wrote it.
    expect(header[12]).toBe('كاميرا ٧ — داخل الخزينة ١');
    expect(header[14]).toBe('DVR');
    expect(header[15]).toBe('جهاز الاتصال (موتورولا)');
    expect(header.slice(16)).toEqual(['الأعطال', 'ملاحظات', 'الصور']);
    expect(header).toHaveLength(19);
  });

  it('write a report in the form’s words, the counts as numbers in the sheet', () => {
    const line = vehicleCheckSheetLine(report(), context);
    expect(line.slice(0, 5)).toEqual([
      'كورولا 1',
      'أكتوبر',
      day('2026-11-08'),
      formatBusinessDateTime('2026-11-08T14:35:00.000Z', 'ar'),
      'شريف ممدوح فاروق',
    ]);
    expect(line[5]).toBe('يعمل');
    expect(line[13]).toBe('لم يُفحص');
    expect(line[14]).toBe('لا يعمل');
    expect(line[15]).toBe('لا يعمل');
    expect(line.slice(16)).toEqual([2, 'الـ DVR لا يسجّل، وجهاز الاتصال بلا إرسال.', 1]);
  });

  it('print every figure in the reader’s digits, and a dash where nothing is', () => {
    const line = vehicleCheckPaperLine(
      report({ notes: null, photos: [], branchId: null }),
      context,
    );
    expect(line[1]).toBe('—');
    expect(line.slice(16)).toEqual(['٢', '—', '٠']);
    // …and in the sheet the blank is a real blank, one the reader can filter on.
    expect(vehicleCheckSheetLine(report({ notes: null }), context)[17]).toBe('');
  });
});

const filters = (over: Partial<VehicleCheckFilters> = {}): VehicleCheckFilters => ({
  period: '7',
  branchId: '',
  car: '',
  vehicleId: '',
  faults: false,
  device: null,
  ...over,
});

describe('what the printed page says it is a view of', () => {
  const line = (over: Partial<VehicleCheckFilters>, rows: ItVehicleCheckDto[] = []): string =>
    vehicleCheckRegisterSubtitle(t, {
      ...vehicleCheckRegisterFilters({
        t,
        locale: 'ar',
        filters: filters(over),
        window: { from: '2026-11-04', to: '2026-11-10' },
        branchName: context.branchName,
        rows,
      }),
      asOf: '١٠ نوفمبر ٢٠٢٦',
    });

  it('names the period and «every branch», and the day it was taken', () => {
    expect(line({})).toBe(
      `الفترة من ${day('2026-11-04')} إلى ${day('2026-11-10')} · كل الفروع · بتاريخ ١٠ نوفمبر ٢٠٢٦`,
    );
  });

  it('names every filter in force, in the bar’s order', () => {
    expect(line({ branchId: B_OCT, car: '15', faults: true, device: 'camera7' })).toBe(
      [
        `الفترة من ${day('2026-11-04')} إلى ${day('2026-11-10')}`,
        'أكتوبر',
        'السيارة: 15',
        'التقارير التي بها عطل فقط',
        'كاميرا ٧ — داخل الخزينة ١: لا يعمل',
        'بتاريخ ١٠ نوفمبر ٢٠٢٦',
      ].join(' · '),
    );
  });

  // «كل تقارير هذه السيارة»: the list — and so the file — holds the car's every day, and a page
  // printed under «آخر ٧ أيام» would say what it is not.
  it('says «كل الأيام» for a car pinned by its id', () => {
    const pinned = filters({ car: 'كورولا 1', vehicleId: 'v-corolla' });
    const subtitle = vehicleCheckRegisterSubtitle(t, {
      ...vehicleCheckRegisterFilters({
        t,
        locale: 'ar',
        filters: pinned,
        window: reportsWindow(pinned, '2026-11-10'),
        branchName: context.branchName,
        rows: [],
      }),
      asOf: '١٠ نوفمبر ٢٠٢٦',
    });
    expect(subtitle).toBe(
      'الفترة: كل الأيام · كل الفروع · السيارة: كورولا 1 · بتاريخ ١٠ نوفمبر ٢٠٢٦',
    );
  });

  it('writes «اليوم» as its one day', () => {
    const today = vehicleCheckRegisterSubtitle(t, {
      ...vehicleCheckRegisterFilters({
        t,
        locale: 'ar',
        filters: filters({ period: 'today' }),
        window: { from: '2026-11-10', to: '2026-11-10' },
        branchName: context.branchName,
        rows: [],
      }),
      asOf: 'اليوم',
    });
    expect(today.startsWith(`يوم الفحص: ${day('2026-11-10')} · `)).toBe(true);
  });

  it('never drops a filter in force for want of its name', () => {
    // A closed branch, not among the options.
    expect(line({ branchId: 'b-closed' })).toContain('فرع محدد');
    // A car picked by its id with no code beside it: named by its rows, else said to be one car.
    expect(line({ vehicleId: 'v-corolla' }, [report()])).toContain('السيارة: كورولا 1');
    expect(line({ vehicleId: 'v-corolla' })).toContain('السيارة: سيارة محددة');
  });
});

describe('the files hold every report the filters match', () => {
  it('walk every page of the reports list under the list’s own filters', async () => {
    const asked: QueryParams[] = [];
    const all = Array.from({ length: 230 }, (_, i) => report({ id: `r-${i}` }));
    const list = (params: QueryParams): Promise<Paginated<ItVehicleCheckDto>> => {
      asked.push(params);
      const page = Number(params['page']);
      const size = Number(params['pageSize']);
      return Promise.resolve({
        items: all.slice((page - 1) * size, page * size),
        meta: { page, pageSize: size, totalItems: all.length, totalPages: Math.ceil(230 / size) },
      });
    };
    const params = reportsQuery(filters({ branchId: B_OCT, faults: true }), '2026-11-10', 4);
    const rows = await gatherRegister(params, list);
    expect(rows).toHaveLength(230);
    // From the first page, whichever page the reader was on — with the filters, every time.
    expect(asked[0]).toMatchObject({ page: 1, branchId: B_OCT, faultsOnly: true });
    expect(asked.every((p) => p['from'] === '2026-11-04' && p['to'] === '2026-11-10')).toBe(true);
  });

  it('walk every day of a car pinned by its id', async () => {
    const asked: QueryParams[] = [];
    const list = (params: QueryParams): Promise<Paginated<ItVehicleCheckDto>> => {
      asked.push(params);
      return Promise.resolve({
        items: [report()],
        meta: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
      });
    };
    const pinned = filters({ car: 'كورولا 1', vehicleId: '64b7f0c2a1b2c3d4e5f60150' });
    await gatherRegister(reportsQuery(pinned, '2026-11-10'), list);
    expect(asked[0]).toMatchObject({ vehicleId: '64b7f0c2a1b2c3d4e5f60150' });
    expect(asked[0]).not.toHaveProperty('from');
    expect(asked[0]).not.toHaveProperty('to');
  });
});

describe('the printed register', () => {
  const printed = vehicleCheckRegisterReport([report()], context, 'الفترة …');
  const html = buildFleetReportHtml(printed);

  it('is the company’s report form, under the IT sector, landscape for nineteen columns', () => {
    expect(printed.title).toBe('فحص أجهزة السيارات');
    expect(printed.department).toBe('قطاع تكنولوجيا المعلومات');
    expect(printed.orientation).toBe('landscape');
    expect(printed.header).toHaveLength(19);
    expect(html).toContain('@page { size: A4 landscape; margin: 14mm; }');
    expect(html).toContain('كورولا 1');
    expect(html).toContain('الفترة …');
  });

  it('is a list, not a form that goes up for signature', () => {
    expect(printed.signatories).toBeUndefined();
  });

  it('still prints when the filters matched nothing, and says so', () => {
    expect(buildFleetReportHtml(vehicleCheckRegisterReport([], context, ''))).toContain(
      'لا توجد سجلات مطابقة لعوامل التصفية.',
    );
  });
});
