// /atm/control «بيانات التغذية والخطوط», rendered from a pre-filled query cache
// (docs/12-planning/atm-settlements-phase1.md §9.7, §10.4):
//
//   · «إنشاء الخطوط من القطاعات» only when the reader reaches the map (`can.zones`);
//   · «لم يُوزّع بعد» is the first group of the routes tab, and cancelled lines are not in it;
//   · tab 1 carries the seals paper's TYPE and HUB as «النوع» and «المنطقة»;
//   · the routes tab is for manage, the prints for print;
//   · a duplicate shows ⚠ (warning only).
//
// Every code, QR, seal and name below is synthetic.
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { type AtmControlDayDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { ControlPage } from './pages/ControlPage';
import { sortItems } from './components/settlements/ControlRoutesTab';
import { controlDayKey } from './api/settlements-queries';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const BRANCH = '66a000000000000000000031';
const PLAN = '66c000000000000000000031';
const ROUTE = '66b000000000000000000031';

type ControlLine = AtmControlDayDto['lines'][number];

const line = (n: number, over: Partial<ControlLine> = {}): ControlLine => ({
  lineId: `66d0000000000000000002${String(n).padStart(2, '0')}`,
  planId: PLAN,
  bankCode: 'BRK',
  serial: 300 + n,
  lineStatus: 'issued',
  kind: 'machine',
  machineCode: `BRKN92${String(n).padStart(2, '0')}`,
  machineName: `ماكينة اختبار ${String(n)}`,
  area: 'منطقة تجريبية',
  hubLabel: `HUB-T-${String(n)}`,
  zoneName: null,
  typeLabel: `SYN-TYPE-${String(n)}`,
  spareCode: null,
  run: 1,
  scheduleTime: '09:00',
  egpTotalMinor: 30_000_000,
  bags: [{ bag: 1, slots: [1, 2], qr: null }],
  seals: [
    { slot: 1, denomination: 200, notes: 1000, value: null },
    { slot: 2, denomination: 100, notes: 1000, value: null },
  ],
  progress: { captured: 0, required: 3 },
  preparationStatus: 'none',
  routeId: null,
  duplicates: [],
  ...over,
});

const day = (over: Partial<AtmControlDayDto> = {}): AtmControlDayDto => ({
  branch: { id: BRANCH, name: { ar: 'فرع تجريبي', en: 'SYN branch' } },
  date: '2026-10-28',
  can: { manage: true, print: true, zones: true },
  plans: [{ planId: PLAN, bankCode: 'BRK', lines: 3, prepared: 1 }],
  lines: [
    line(1, {
      lineStatus: 'prepared',
      preparationStatus: 'prepared',
      routeId: ROUTE,
      bags: [{ bag: 1, slots: [1, 2], qr: 'QR-T-0301' }],
      seals: [
        { slot: 1, denomination: 200, notes: 1000, value: 'SEAL-T-3011' },
        { slot: 2, denomination: 100, notes: 1000, value: 'SEAL-T-3012' },
      ],
      duplicates: [
        {
          field: 'bag',
          bag: 1,
          matches: [{ outsideReach: true }],
          crossKind: false,
        },
      ],
    }),
    line(2),
    line(3, { lineStatus: 'cancelled' }),
  ],
  routes: [
    {
      id: ROUTE,
      version: 0,
      name: 'خط تجريبي 1',
      leaderName: 'قائد تجريبي',
      order: 1,
      zoneId: null,
      lines: 1,
      machines: 1,
      bags: 1,
      notPrepared: 0,
    },
  ],
  unassigned: 1,
  ...over,
});

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: { 'atmControl.view': 'branch', 'atmControl.manage': 'branch' },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const render = (dto: AtmControlDayDto, tab: 'data' | 'routes'): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(controlDayKey(null, null), dto);
  const url = tab === 'routes' ? '/atm/control?tab=routes' : '/atm/control';
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <ControlPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('the routes tab', () => {
  it('offers «إنشاء الخطوط من القطاعات» only with map reach', () => {
    expect(render(day(), 'routes')).toContain(t('atm.control.fromZones'));
    const noZones = render(day({ can: { manage: true, print: true, zones: false } }), 'routes');
    expect(noZones).not.toContain(t('atm.control.fromZones'));
    expect(noZones).toContain(t('atm.control.newRoute'));
  });

  it('puts «لم يُوزّع بعد» first, then the routes', () => {
    const html = render(day(), 'routes');
    const unassigned = html.indexOf('data-route-group="unassigned"');
    const route = html.indexOf(`data-route-group="${ROUTE}"`);
    expect(unassigned).toBeGreaterThan(-1);
    expect(route).toBeGreaterThan(unassigned);
    expect(html).toContain(t('atm.control.unassigned', { n: '١' }));
  });

  it('keeps a cancelled line off the routes; each line sits in exactly one group', () => {
    const html = render(day(), 'routes');
    const group = (id: string): string => {
      const start = html.indexOf(`data-route-group="${id}"`);
      return html.slice(start, html.indexOf('</section>', start));
    };
    expect(group('unassigned')).toContain(`data-route-item="${line(2).lineId}"`);
    expect(group('unassigned')).not.toContain(`data-route-item="${line(1).lineId}"`);
    expect(group(ROUTE)).toContain(`data-route-item="${line(1).lineId}"`);
    expect(html).not.toContain(`data-route-item="${line(3).lineId}"`);
  });

  it('names the route with its leader, machines and bags', () => {
    expect(render(day(), 'routes')).toContain(
      t('atm.control.routeSummary', { leader: 'قائد تجريبي', n: '١', b: '١' }),
    );
  });

  it('is not offered without manage — the page stays on the data tab', () => {
    const html = render(day({ can: { manage: false, print: true, zones: true } }), 'routes');
    expect(html).not.toContain('data-control-tab="routes"');
    expect(html).not.toContain('data-control-routes');
    expect(html).toContain('data-control-lines');
  });
});

describe('the data tab', () => {
  const html = render(day(), 'data');

  it('carries «النوع» and «المنطقة» — the seals paper’s TYPE and HUB', () => {
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(head).toContain(`>${t('atm.control.column.type')}<`);
    expect(head).toContain(`>${t('atm.settlement.area')}<`);
    expect(html).toContain('SYN-TYPE-1');
    expect(html).toContain('HUB-T-1');
  });

  it('lists every issued, prepared and cancelled line with its bags, seals and route', () => {
    for (const n of [1, 2, 3]) expect(html).toContain(`data-control-line="${line(n).lineId}"`);
    expect(html).toContain('QR-T-0301');
    expect(html).toContain(t('atm.control.sealsProgress', { n: '٢', m: '٢' }));
    expect(html).toContain('خط تجريبي 1');
    expect(html).toContain(t('atm.control.unassignedOption'));
  });

  it('marks a duplicate QR with ⚠, without naming a line out of reach', () => {
    expect(html).toContain('data-control-duplicate="bag"');
    expect(html).toContain(t('atm.prep.duplicate.outsideReach'));
  });

  it('prints for the print key, and not without it', () => {
    expect(html).toContain('data-control-action="handover"');
    expect(html).toContain('data-control-action="routes"');
    const readOnly = render(day({ can: { manage: false, print: false, zones: false } }), 'data');
    expect(readOnly).not.toContain('data-control-action');
  });
});

describe('sorting the items of a group', () => {
  it('by serial, or by area then serial', () => {
    const a = line(5, { serial: 9, hubLabel: 'ب' });
    const b = line(6, { serial: 2, hubLabel: 'أ' });
    const c = line(7, { serial: 4, hubLabel: 'ب' });
    expect(sortItems([a, b, c], 'serial').map((l) => l.serial)).toEqual([2, 4, 9]);
    expect(sortItems([a, b, c], 'area').map((l) => l.serial)).toEqual([2, 4, 9]);
    expect(sortItems([a, c, b], 'area').map((l) => l.hubLabel)).toEqual(['أ', 'ب', 'ب']);
  });
});
