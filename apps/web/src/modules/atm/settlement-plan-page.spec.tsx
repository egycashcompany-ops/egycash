// /atm/settlements/plans «خطة التغذية», rendered from a pre-filled query cache
// (docs/12-planning/atm-settlements-phase1.md §9.4, §10.4):
//
//   · no work branch → «اختر فرعًا محددًا من القائمة العلوية.» and nothing else;
//   · no plan for the day → «لا توجد خطة لهذا اليوم.», with «إنشاء الخطة» only for manage;
//   · the print actions only with `can.print`, the Excel export only with `can.export`;
//   · the header figures are counts — the money total stays in the footer (UI-30);
//   · lines issued after the last «بيان التغذية» print raise the stale notice.
//
// Every code, name, count and amount below is synthetic.
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  type AtmPlanLineDto,
  type AtmSettlementContextDto,
  type AtmSettlementPlanDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { SettlementPlanPage } from './pages/SettlementPlanPage';
import {
  settlementContextKey,
  settlementPlanKey,
  standardLoadsKey,
} from './api/settlements-queries';
import { cairoTomorrow } from './lib/settlement-dates';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const BRANCH = '66a000000000000000000011';
const PLAN = '66c000000000000000000001';

const context = (over: Partial<AtmSettlementContextDto> = {}): AtmSettlementContextDto => ({
  page: 'plans',
  banks: ['BRK'],
  branch: { id: BRANCH, name: { ar: 'فرع تجريبي', en: 'SYN branch' } },
  blocked: null,
  can: {
    viewLayouts: true,
    manageLayouts: true,
    importLayouts: true,
    viewPlans: true,
    managePlans: true,
    printPlans: true,
    exportPlans: true,
  },
  ...over,
});

const line = (n: number, over: Partial<AtmPlanLineDto> = {}): AtmPlanLineDto => ({
  id: `66d0000000000000000000${String(n).padStart(2, '0')}`,
  version: 1,
  kind: 'machine',
  machineId: `66e0000000000000000000${String(n).padStart(2, '0')}`,
  machineCode: `BRKN90${String(n).padStart(2, '0')}`,
  machineName: `ماكينة اختبار ${String(n)}`,
  area: 'منطقة تجريبية',
  typeLabel: 'SYN (S2)',
  featuresLabel: null,
  hubLabel: null,
  layoutRevision: 1,
  spareCode: null,
  spareUse: null,
  run: 1,
  scheduleTime: '09:00',
  position: n,
  status: 'issued',
  serial: 100 + n,
  voidedSerials: [],
  slots: [
    { slot: 1, kind: 'withdrawal', denomination: 200, currency: 'EGP', notes: 1000, bag: 1 },
    { slot: 2, kind: 'withdrawal', denomination: 100, currency: 'EGP', notes: 1000, bag: 1 },
  ],
  countsSource: 'standard',
  standardLoadId: null,
  standardNotes: null,
  egpTotalMinor: 30_000_000,
  preparationStatus: 'none',
  notePrintCount: 0,
  notePrintedAt: null,
  issues: [],
  ...over,
});

const plan = (
  over: Partial<Omit<AtmSettlementPlanDto, 'summary'>> & {
    summary?: Partial<AtmSettlementPlanDto['summary']>;
  } = {},
): AtmSettlementPlanDto => {
  const lines = over.lines ?? [line(1), line(2, { status: 'draft', serial: null })];
  const { summary, ...rest } = over;
  return {
    id: PLAN,
    version: 1,
    branchId: BRANCH,
    bankCode: 'BRK',
    replenishDate: cairoTomorrow(),
    lines,
    can: { manage: true, print: true, export: true },
    ...rest,
    summary: {
      lines: 2,
      machines: 2,
      spares: 0,
      bags: 2,
      byStatus: { draft: 1, issued: 1, prepared: 0, cancelled: 0 },
      notPrinted: 1,
      receipt: {
        rows: [{ denomination: 200, notes: 1000 }],
        egpTotalMinor: 30_000_000,
        machineCount: 1,
      },
      all: {
        rows: [
          { denomination: 200, notes: 2000 },
          { denomination: 100, notes: 2000 },
        ],
        egpTotalMinor: 60_000_000,
        machineCount: 2,
      },
      receiptPrint: null,
      receiptStale: false,
      handoverPrint: null,
      handoverStale: false,
      ...summary,
    },
  };
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: { 'atmSettlementPlan.view': 'organization' },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const render = (ctx: AtmSettlementContextDto, day: AtmSettlementPlanDto | null): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(settlementContextKey('plans'), ctx);
  const params = { bankCode: 'BRK' as const, date: cairoTomorrow(), branchId: BRANCH };
  qc.setQueryData(settlementPlanKey(params), { plan: day });
  qc.setQueryData(standardLoadsKey({ bankCode: 'BRK', branchId: BRANCH }), []);
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/atm/settlements/plans']}>
          <SettlementPlanPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The header's figures block, alone. */
const figuresOf = (html: string): string => {
  const start = html.indexOf('data-settlement-figures');
  const end = html.indexOf('</div>', start);
  return start < 0 ? '' : html.slice(start, end);
};

describe('the plan page without a work branch', () => {
  it('says to choose a branch, and shows nothing else', () => {
    const html = render(context({ branch: null, blocked: 'chooseBranch' }), null);
    expect(html).toContain('data-settlement-blocked');
    expect(html).toContain(t('atm.settlement.chooseBranch'));
    expect(html).not.toContain('data-plan-toolbar');
    expect(html).not.toContain(t('atm.plan.empty'));
  });

  it('says no branch is in reach when none is', () => {
    const html = render(context({ branch: null, blocked: 'noBranch' }), null);
    expect(html).toContain(t('atm.settlement.noBranch'));
  });
});

describe('a day without a plan', () => {
  it('offers «إنشاء الخطة» to a manage holder', () => {
    const html = render(context(), null);
    expect(html).toContain(t('atm.plan.empty'));
    expect(html).toContain('data-plan-create');
    expect(html).toContain(t('atm.plan.action.create'));
  });

  it('shows the empty state alone to a reader without manage', () => {
    const ctx = context();
    const html = render({ ...ctx, can: { ...ctx.can, managePlans: false } }, null);
    expect(html).toContain(t('atm.plan.empty'));
    expect(html).not.toContain('data-plan-create');
  });
});

describe('the plan’s actions', () => {
  it('prints and exports for a holder of both keys', () => {
    const html = render(context(), plan());
    expect(html).toContain('data-plan-action="receipt"');
    expect(html).toContain('data-plan-action="handover"');
    expect(html).toContain(t('atm.plan.action.printNotes', { count: '١' }));
    expect(html).toContain('data-plan-action="export"');
  });

  it('hides every print without the print key', () => {
    const html = render(context(), plan({ can: { manage: true, print: false, export: true } }));
    expect(html).not.toContain('data-plan-action="receipt"');
    expect(html).not.toContain('data-plan-action="handover"');
    expect(html).not.toContain(t('atm.plan.action.printNotes', { count: '١' }));
    expect(html).toContain('data-plan-action="export"');
  });

  it('hides the Excel export without the export key', () => {
    const html = render(context(), plan({ can: { manage: true, print: true, export: false } }));
    expect(html).toContain('data-plan-action="receipt"');
    expect(html).not.toContain('data-plan-action="export"');
  });

  it('offers adding and issuing only with manage', () => {
    const managed = render(context(), plan());
    expect(managed).toContain(t('atm.plan.action.addMachines'));
    expect(managed).toContain(t('atm.plan.action.issue', { n: '١' }));
    const readOnly = render(context(), plan({ can: { manage: false, print: true, export: true } }));
    expect(readOnly).not.toContain(t('atm.plan.action.addMachines'));
    expect(readOnly).not.toContain(t('atm.plan.action.addSpare'));
  });
});

describe('the header figures', () => {
  it('are counts only: machines, replenishments, bags — no money', () => {
    const block = figuresOf(render(context(), plan()));
    expect(block).toContain('data-settlement-figure="machines"');
    expect(block).toContain('data-settlement-figure="lines"');
    expect(block).toContain('data-settlement-figure="bags"');
    expect([...block.matchAll(/data-settlement-figure="/g)]).toHaveLength(3);
    expect(block).not.toMatch(/ج\.م|EGP|600,000/);
  });

  it('leaves the money total to the footer, converted once from minor units', () => {
    const html = render(context(), plan());
    const footer = html.slice(html.indexOf('data-plan-footer'));
    expect(footer).toContain('600,000');
  });
});

describe('the stale-receipt notice', () => {
  it('shows when the issued lines changed after the last «بيان التغذية»', () => {
    const html = render(
      context(),
      plan({
        summary: {
          receiptPrint: { at: '2026-10-26T18:00:00.000Z', byName: 'مستخدم تجريبي' },
          receiptStale: true,
        },
      }),
    );
    expect(html).toContain('data-plan-notice="receiptStale"');
    expect(html).not.toContain('data-plan-notice="handoverStale"');
  });

  it('stays away while the last print still covers the lines', () => {
    const html = render(
      context(),
      plan({
        summary: {
          receiptPrint: { at: '2026-10-26T18:00:00.000Z', byName: 'مستخدم تجريبي' },
          receiptStale: false,
        },
      }),
    );
    expect(html).not.toContain('data-plan-notice="receiptStale"');
  });
});

describe('the lines table', () => {
  it('writes «—» for a draft’s serial and the issued line’s number', () => {
    const html = render(context(), plan());
    expect(html).toMatch(new RegExp(`data-plan-serial="${line(1).id}">١٠١<`));
    expect(html).toMatch(new RegExp(`data-plan-serial="${line(2).id}">—<`));
  });

  it('offers a print checkbox only on lines that have a Note', () => {
    const html = render(context(), plan());
    const boxes = [...html.matchAll(/type="checkbox"/g)];
    expect(boxes).toHaveLength(1);
  });
});
