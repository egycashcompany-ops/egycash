// «زرارين بجانب تسليم عهدة بيـ Extract أكسيل و PDF للجدول المعمول (وأعتمد الفلتر طبعاً)» — what
// the custody register's files say, line by line; that they hold every row the filters match and
// not the page on screen; and that the print opens its tab before it gathers the rows.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PAGE_SIZE, type ItAssetAssignmentDto, type Paginated } from '@ecms/contracts';
import { type QueryParams } from '../../../shared/lib/api-client';
import { translate } from '../../../platform/localization/i18n';
import { formatDate } from '../../../shared/lib/format';
import { buildFleetReportHtml } from '../../fleet/lib/fleet-report-print';
import {
  custodyRegisterHeader,
  custodyRegisterLine,
  custodyRegisterReport,
  custodyRegisterSubtitle,
  gatherCustodyRegister,
  printCustodyRegister,
  type CustodyRegisterContext,
} from './custody-register-export';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const context: CustodyRegisterContext = {
  t,
  locale: 'ar',
  branchName: new Map([['b-hq', 'المهندسين']]),
};

const interval = (over: Partial<ItAssetAssignmentDto> = {}): ItAssetAssignmentDto => ({
  id: 'a-1',
  assetId: 'asset-1',
  assignedToEmployeeId: 'e-1',
  assignedToEmployeeCode: '0100052',
  assignedToEmployeeName: 'محمد أحمد علي',
  assetCode: 'AST-00012',
  assetName: 'لاب توب Lenovo',
  assignedByUserId: null,
  assignedAt: '2026-10-07T09:00:00.000Z',
  conditionOnIssue: null,
  expectedReturnAt: null,
  returnedAt: null,
  returnedToUserId: null,
  conditionOnReturn: null,
  notes: null,
  branchId: 'b-hq',
  receiptId: 'r-1',
  receiptSigned: false,
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
  ...over,
});

describe('the rows the files hold', () => {
  it('are every row the filters match, from the first page to the last, whatever page is on screen', async () => {
    const seen: QueryParams[] = [];
    const list = (params: QueryParams): Promise<Paginated<ItAssetAssignmentDto>> => {
      seen.push(params);
      const page = Number(params['page']);
      return Promise.resolve({
        items: [interval({ id: `a-${String(page)}` })],
        meta: { page, pageSize: MAX_PAGE_SIZE, totalItems: 3, totalPages: 3 },
      });
    };
    // The reader is on page 3 of 25 rows, narrowed to one branch's open custody, oldest first.
    const rows = await gatherCustodyRegister(
      {
        page: 3,
        pageSize: 25,
        sortBy: 'assignedAt',
        sortDir: 'asc',
        open: true,
        branchId: 'b-hq',
        employeeId: undefined,
      },
      list,
    );
    expect(rows.map((row) => row.id)).toEqual(['a-1', 'a-2', 'a-3']);
    expect(seen.map((params) => params['page'])).toEqual([1, 2, 3]);
    for (const params of seen) {
      expect(params).toMatchObject({
        pageSize: MAX_PAGE_SIZE,
        sortBy: 'assignedAt',
        sortDir: 'asc',
        open: true,
        branchId: 'b-hq',
      });
    }
  });
});

describe('the register’s columns', () => {
  it('are the table’s, with the two codes in columns of their own', () => {
    expect(custodyRegisterHeader(t)).toEqual([
      'الصنف',
      'كود الصنف',
      'المستلِم',
      'كود الموظف',
      'الفرع',
      'تاريخ التسليم',
      'موعد الإعادة',
      'الحالة',
      'تاريخ الاسترجاع',
      'إيصال الاستلام',
    ]);
  });

  it('write an open interval as the table shows it, a code kept as text', () => {
    expect(custodyRegisterLine(interval(), context, '')).toEqual([
      'لاب توب Lenovo',
      'AST-00012',
      'محمد أحمد علي',
      '0100052',
      'المهندسين',
      formatDate('2026-10-07T09:00:00.000Z', 'ar'),
      '',
      'مُسلَّم',
      '',
      'بانتظار التوقيع',
    ]);
  });

  it('write a returned interval with its dates and its signed receipt', () => {
    const line = custodyRegisterLine(
      interval({
        expectedReturnAt: '2026-12-01T00:00:00.000Z',
        returnedAt: '2026-11-20T00:00:00.000Z',
        receiptSigned: true,
      }),
      context,
      '—',
    );
    expect(line.slice(5)).toEqual([
      formatDate('2026-10-07T09:00:00.000Z', 'ar'),
      formatDate('2026-12-01T00:00:00.000Z', 'ar'),
      'مُسترجَع',
      formatDate('2026-11-20T00:00:00.000Z', 'ar'),
      'موقّع',
    ]);
  });

  it('fall back as the table does — never a guessed name, and a blank where there is nothing', () => {
    const line = custodyRegisterLine(
      interval({
        assetName: null,
        assetCode: null,
        assignedToEmployeeName: null,
        assignedToEmployeeCode: null,
        branchId: 'b-gone',
        receiptId: null,
        receiptSigned: null,
      }),
      context,
      '—',
    );
    expect(line[0]).toBe('خارج نطاقك');
    expect(line[1]).toBe('—');
    // A holder HR cannot name is shown by the id the row carries.
    expect(line[2]).toBe('e-1');
    expect(line[3]).toBe('—');
    expect(line[4]).toBe('—');
    expect(line[9]).toBe('—');
  });
});

describe('what the printed page says it is a view of', () => {
  it('names the status, the branch, the holder and the day', () => {
    expect(
      custodyRegisterSubtitle(t, {
        open: 'true',
        branch: 'المهندسين',
        holder: 'محمد أحمد علي',
        asOf: '١٨ أكتوبر ٢٠٢٦',
      }),
    ).toBe('المُسلَّم حاليًا · المهندسين · المستلِم: محمد أحمد علي · بتاريخ ١٨ أكتوبر ٢٠٢٦');
  });

  it('says «every branch» when none is picked, and leaves out a holder nobody picked', () => {
    expect(custodyRegisterSubtitle(t, { open: 'all', branch: '', holder: '', asOf: 'اليوم' })).toBe(
      'الكل · كل الفروع · بتاريخ اليوم',
    );
    expect(
      custodyRegisterSubtitle(t, { open: 'false', branch: '', holder: '', asOf: 'اليوم' }),
    ).toBe('المُسترجَع · كل الفروع · بتاريخ اليوم');
  });
});

describe('the printed register', () => {
  const report = custodyRegisterReport([interval()], context, 'المُسلَّم حاليًا');
  const html = buildFleetReportHtml(report);

  it('is the company’s report form, under the IT sector, landscape for ten columns', () => {
    expect(report.title).toBe('عهدة الأصول');
    expect(report.department).toBe('قطاع تكنولوجيا المعلومات');
    expect(report.orientation).toBe('landscape');
    expect(html).toContain('@page { size: A4 landscape; margin: 14mm; }');
    expect(html).toContain('<th>م</th>');
    expect(html).toContain('AST-00012');
    expect(html).toContain('المُسلَّم حاليًا');
  });

  it('is a list, not a form that goes up for signature', () => {
    expect(report.signatories).toBeUndefined();
    expect(html).not.toContain('التوقيع /');
  });

  it('marks a blank box with a dash on paper', () => {
    expect(report.rows[0]?.[6]).toBe('—');
  });

  it('still prints when the filters matched nothing, and says so', () => {
    const empty = buildFleetReportHtml(custodyRegisterReport([], context, ''));
    expect(empty).toContain('لا توجد سجلات مطابقة لعوامل التصفية.');
    expect(empty).not.toContain('<table>');
  });
});

/** A tab as small as the print door needs. */
const fakeTab = () => {
  const written: string[] = [];
  const tab = {
    closed: false,
    focus: vi.fn(),
    print: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    setTimeout: vi.fn(),
    document: {
      readyState: 'complete',
      body: { offsetHeight: 1 },
      images: [],
      open: vi.fn(),
      write: (html: string) => written.push(html),
      close: vi.fn(),
      querySelectorAll: () => [],
    },
  };
  return { tab, written };
};

describe('printing it', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the tab while the click still counts, then gathers the rows, then writes the page', async () => {
    const { tab, written } = fakeTab();
    const order: string[] = [];
    vi.stubGlobal('window', {
      open: vi.fn(() => {
        order.push('open');
        return tab;
      }),
    });
    const printed = await printCustodyRegister(async () => {
      order.push('load');
      return custodyRegisterReport([interval()], context, '');
    }, 'جارٍ تجهيز سجل العهد…');
    expect(printed).toBe(true);
    expect(order).toEqual(['open', 'load']);
    expect(written[0]).toContain('جارٍ تجهيز سجل العهد…');
    expect(written.at(-1)).toContain('AST-00012');
  });

  it('gathers nothing when the browser blocked the tab, and says it did not print', async () => {
    vi.stubGlobal('window', { open: vi.fn(() => null) });
    const load = vi.fn();
    expect(await printCustodyRegister(load, '')).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('closes its tab and passes the failure on when the rows cannot be gathered', async () => {
    const { tab } = fakeTab();
    vi.stubGlobal('window', { open: vi.fn(() => tab) });
    await expect(
      printCustodyRegister(() => Promise.reject(new Error('offline')), ''),
    ).rejects.toThrow('offline');
    expect(tab.close).toHaveBeenCalledTimes(1);
  });
});
