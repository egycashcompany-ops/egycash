// What every IT register's files share: they hold every row the screen's filters match, not the
// page on screen; a filter in force is never dropped from the printed line; the page is the
// company's report form with nobody to sign it; and the print opens its tab before it gathers the
// rows. What each register's table says is its own spec.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PAGE_SIZE, type Paginated } from '@ecms/contracts';
import { type QueryParams } from '../../../shared/lib/api-client';
import { translate } from '../../../platform/localization/i18n';
import { buildFleetReportHtml } from '../../fleet/lib/fleet-report-print';
import {
  filterLine,
  gatherRegister,
  itRegisterReport,
  namedFilter,
  printItRegister,
} from './register-export';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

describe('the rows the files hold', () => {
  it('are every row the filters match, from the first page to the last, whatever page is on screen', async () => {
    const seen: QueryParams[] = [];
    const list = (params: QueryParams): Promise<Paginated<{ id: string }>> => {
      seen.push(params);
      const page = Number(params['page']);
      return Promise.resolve({
        items: [{ id: `row-${String(page)}` }],
        meta: { page, pageSize: MAX_PAGE_SIZE, totalItems: 3, totalPages: 3 },
      });
    };
    // The reader is on page 3 of 25 rows, narrowed to one branch, oldest first.
    const rows = await gatherRegister(
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
    expect(rows.map((row) => row.id)).toEqual(['row-1', 'row-2', 'row-3']);
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

describe('the printed line of filters', () => {
  const labels = { all: 'it.assets.allBranches', one: 'it.export.oneBranch' };

  it('says «every branch» only when none is set — a set one is named, or said to be set', () => {
    expect(namedFilter(t, null, labels)).toBe('كل الفروع');
    expect(namedFilter(t, 'المهندسين', labels)).toBe('المهندسين');
    expect(namedFilter(t, '', labels)).toBe('فرع محدد');
  });

  it('joins the filters in force and leaves out the ones not set', () => {
    expect(filterLine(['المُسلَّم حاليًا', null, 'بتاريخ اليوم'])).toBe(
      'المُسلَّم حاليًا · بتاريخ اليوم',
    );
  });
});

describe('the printed register', () => {
  const report = itRegisterReport({
    t,
    title: 'الأصول',
    header: ['الكود'],
    rows: [['AST-00012']],
    subtitle: 'كل الحالات',
    orientation: 'portrait',
  });
  const html = buildFleetReportHtml(report);

  it('is the company’s report form under the IT sector, with a «م» down its edge', () => {
    expect(report.department).toBe('قطاع تكنولوجيا المعلومات');
    expect(html).toContain('<th>م</th>');
    expect(html).toContain('AST-00012');
    expect(html).toContain('كل الحالات');
  });

  it('is a list, not a form that goes up for signature', () => {
    expect(report.signatories).toBeUndefined();
    expect(html).not.toContain('التوقيع /');
  });

  it('still prints when the filters matched nothing, and says so', () => {
    const empty = buildFleetReportHtml({ ...report, rows: [] });
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

  const report = itRegisterReport({
    t,
    title: 'عهدة الأصول',
    header: ['الصنف'],
    rows: [['AST-00012']],
    subtitle: '',
    orientation: 'landscape',
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
    const printed = await printItRegister(async () => {
      order.push('load');
      return report;
    }, 'جارٍ تجهيز السجل…');
    expect(printed).toBe(true);
    expect(order).toEqual(['open', 'load']);
    expect(written[0]).toContain('جارٍ تجهيز السجل…');
    expect(written.at(-1)).toContain('AST-00012');
  });

  it('gathers nothing when the browser blocked the tab, and says it did not print', async () => {
    vi.stubGlobal('window', { open: vi.fn(() => null) });
    const load = vi.fn();
    expect(await printItRegister(load, '')).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('closes its tab and passes the failure on when the rows cannot be gathered', async () => {
    const { tab } = fakeTab();
    vi.stubGlobal('window', { open: vi.fn(() => tab) });
    await expect(printItRegister(() => Promise.reject(new Error('offline')), '')).rejects.toThrow(
      'offline',
    );
    expect(tab.close).toHaveBeenCalledTimes(1);
  });
});
