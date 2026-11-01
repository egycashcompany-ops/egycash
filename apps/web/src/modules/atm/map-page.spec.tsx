// /atm/map «خريطة الماكينات», rendered (docs/12-planning/atm-map-zones.md §9.4):
//
//   · a reader without `atmZone.manage` / `atmMachine.locate` is offered neither «تعديل القطاعات» nor
//     «ماكينات بدون موقع», and the «بدون موقع» figure is plain text, not a link;
//   · the points and zones are not asked before `context` has answered, and a branch the context
//     does not offer — remembered, or from an old link — never reaches a query key;
//   · ZoneDetail offers «تعديل» only on a zone of the edit branch;
//   · in edit mode the header is the title alone;
//   · the map itself is lazy: the page renders its Suspense fallback, and no subtitle;
//   · a bank added to the catalog (DEC-35) is named, coloured and filterable like the six.
//
// The rules underneath are the `lib/` specs; the API's answers are tests/integration/atm-map.spec.ts.
// Every branch, machine and zone below is synthetic.
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  ATM_BANK_SEED,
  type AtmBankDto,
  type AtmMapContextDto,
  type AtmMapPointDto,
  type AtmMapPointsDto,
  type AtmMapZonesDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { MachineMapPage } from './pages/MachineMapPage';
import { MapPageHeader } from './components/map/MapPageHeader';
import { ZoneDetail } from './components/map/ZoneDetail';
import { MachinePopup } from './components/map/MachinePopup';
import { BankLegend } from './components/map/BankLegend';
import { mapContextKey, mapKeys, mapPointsKey, mapZonesKey } from './api/map-queries';
import { atmBanksKey } from './api/atm-queries';
import { zoneBreakdown, zoneEditableFromDetail } from './lib/map-view';
import { banksOnShow, makeBankLookup } from './lib/bank-catalog';

const t = (key: string): string => translate('ar', key);

const BRANCH_A = '66a000000000000000000001';
const BRANCH_B = '66a000000000000000000002';
const FOREIGN = '66a0000000000000000000ff';

const CONTEXT: AtmMapContextDto = {
  branches: [
    {
      id: BRANCH_A,
      name: { ar: 'فرع تجريبي أ', en: 'SYN A' },
      canManageZones: true,
      canLocate: true,
    },
    {
      id: BRANCH_B,
      name: { ar: 'فرع تجريبي ب', en: 'SYN B' },
      canManageZones: false,
      canLocate: false,
    },
  ],
  organizationWide: false,
  editBranchId: BRANCH_A,
  editBlocked: null,
};

const point = (n: number, over: Partial<AtmMapPointDto> = {}): AtmMapPointDto => ({
  machineId: `66b00000000000000000${String(n).padStart(4, '0')}`,
  code: String(1000 + n),
  name: `ماكينة تجريبية ${String(n)}`,
  branchId: BRANCH_A,
  area: 'منطقة تجريبية 1',
  bankName: 'SYN',
  bankCode: 'NBE',
  active: true,
  lat: 30 + n * 0.001,
  lng: 31 + n * 0.001,
  state: 'located',
  source: 'registerUrl',
  reason: null,
  warnings: [],
  lastSet: null,
  ...over,
});

const POINTS: AtmMapPointsDto = {
  points: [
    point(1),
    point(2),
    point(3, { state: 'unlocated', lat: null, lng: null, reason: 'none' }),
  ],
  generatedAt: '2026-10-18T00:00:00.000Z',
};

const ZONE_A = {
  id: '66c000000000000000000001',
  branchId: BRANCH_A,
  name: 'قطاع 1',
  color: '#483bba',
  order: 0,
  points: [
    { lat: 30, lng: 31 },
    { lat: 30, lng: 31.0015 },
    { lat: 30.0015, lng: 31.0015 },
    { lat: 30.0015, lng: 31 },
  ],
  updatedAt: '2026-10-18T00:00:00.000Z',
};
const ZONES: AtmMapZonesDto = { sets: [{ branchId: BRANCH_A, revision: 1, zones: [ZONE_A] }] };

/** `GET /atm/banks`: the six seeds and a synthetic seventh bank added at runtime. */
const catalogBank = (over: Partial<AtmBankDto> & Pick<AtmBankDto, 'code'>): AtmBankDto => ({
  id: `66d0000000000000000000${over.code.length.toString().padStart(2, '0')}`,
  name: { ar: over.code, en: over.code },
  opsLabel: over.code,
  formerOpsLabels: [],
  color: '#000000',
  sortOrder: 0,
  isActive: true,
  isSeed: false,
  hasIdFormat: false,
  version: 1,
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
  ...over,
});
const CATALOG: AtmBankDto[] = [
  ...ATM_BANK_SEED.map((seed) => catalogBank({ ...seed, isSeed: true, hasIdFormat: true })),
  catalogBank({
    code: 'QNB',
    name: { ar: 'بنك تجريبي سابع', en: 'SYN Seventh Bank' },
    color: '#7030A0',
    sortOrder: 70,
  }),
];
const BANKS = makeBankLookup(CATALOG);

const store = (permissions: Record<string, string>) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: { id: 'u1', permissions } as unknown as MeDto, status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const VIEWER = { 'atmMap.view': 'branch' };
const EDITOR = {
  'atmMap.view': 'branch',
  'atmZone.manage': 'branch',
  'atmMachine.locate': 'branch',
};

const render = ({
  permissions = VIEWER,
  search = '',
  withContext = true,
  points = POINTS,
}: {
  permissions?: Record<string, string>;
  search?: string;
  withContext?: boolean;
  points?: AtmMapPointsDto;
} = {}): { html: string; qc: QueryClient } => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(atmBanksKey(), CATALOG);
  if (withContext) {
    qc.setQueryData(mapContextKey(), CONTEXT);
    qc.setQueryData(mapPointsKey({ branchId: BRANCH_A, status: 'active' }), points);
    qc.setQueryData(mapZonesKey({ branchId: BRANCH_A }), ZONES);
  }
  const html = renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/atm/map${search === '' ? '' : `?${search}`}`]}>
          <MachineMapPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
  return { html, qc };
};

/** Every points or zones query the page built, with its params and whether it may fetch. */
const dataQueries = (qc: QueryClient) =>
  qc
    .getQueryCache()
    .getAll()
    .filter((q) => q.queryKey[1] === mapKeys.points[1] || q.queryKey[1] === mapKeys.zones[1])
    .map((q) => ({
      params: q.queryKey[3] as { branchId: string | null },
      enabled: (q.options as { enabled?: boolean }).enabled,
    }));

describe('what a reader without the edit and locate keys is offered', () => {
  const { html } = render({ permissions: VIEWER });

  it('no «تعديل القطاعات» and no «ماكينات بدون موقع»', () => {
    expect(html).not.toContain(t('atm.map.actions.editZones'));
    expect(html).not.toContain(t('atm.map.actions.unlocated'));
    expect(html).not.toContain('data-edit-zones');
  });

  it('the «بدون موقع» figure is plain text, not a link', () => {
    expect(html).toMatch(/<span[^>]*data-map-figure="unlocated"/);
    expect(html).not.toMatch(/<a[^>]*data-map-figure="unlocated"/);
  });
});

describe('what an editor who may locate is offered', () => {
  const { html } = render({ permissions: EDITOR });

  it('«تعديل القطاعات» and «ماكينات بدون موقع», and the figure links to the unlocated screen', () => {
    expect(html).toContain('data-edit-zones');
    expect(html).toContain(t('atm.map.actions.editZones'));
    expect(html).toContain(t('atm.map.actions.unlocated'));
    expect(html).toMatch(
      new RegExp(
        `<a[^>]*href="/atm/map/unlocated\\?branch=${BRANCH_A}"[^>]*data-map-figure="unlocated"|<a[^>]*data-map-figure="unlocated"[^>]*href="/atm/map/unlocated\\?branch=${BRANCH_A}"`,
      ),
    );
  });

  it('the figures are §6.4 over the visible points', () => {
    const value = (key: string): string | undefined =>
      new RegExp(`data-map-figure-value="${key}"[^>]*>([^<]*)<`).exec(html)?.[1];
    expect(value('onMap')).toBe('٢');
    expect(value('inZones')).toBe('١');
    expect(value('outZones')).toBe('١');
    expect(value('unlocated')).toBe('١');
  });
});

describe('the order of the reads (§8.3)', () => {
  it('asks for no points and no zones before the context has answered', () => {
    const { qc } = render({ withContext: false, search: `branch=${FOREIGN}` });
    const queries = dataQueries(qc);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((q) => q.enabled === false)).toBe(true);
    expect(queries.every((q) => q.params.branchId !== FOREIGN)).toBe(true);
  });

  it('a branch the context does not offer never reaches a query key — the default does', () => {
    const { qc } = render({ search: `branch=${FOREIGN}` });
    const queries = dataQueries(qc);
    expect(queries.some((q) => q.params.branchId === FOREIGN)).toBe(false);
    expect(queries).toContainEqual({
      params: { branchId: BRANCH_A, status: 'active' },
      enabled: true,
    });
    expect(queries).toContainEqual({ params: { branchId: BRANCH_A }, enabled: true });
  });

  it('«كل الفروع» is not offered to a grant that is not organization-wide', () => {
    const { qc } = render({ search: 'branch=all' });
    expect(dataQueries(qc).some((q) => q.params.branchId === null && q.enabled === true)).toBe(
      false,
    );
  });
});

describe('ZoneDetail', () => {
  const detail = (zone: typeof ZONE_A): string => {
    const editable = zoneEditableFromDetail(zone.branchId, CONTEXT.editBranchId, true);
    return renderToStaticMarkup(
      <Provider store={store(EDITOR)}>
        <ZoneDetail
          zone={zone}
          breakdown={zoneBreakdown(zone.id, POINTS.points, new Map())}
          overlaps={0}
          locale="ar"
          banks={BANKS}
          onBack={() => undefined}
          onEdit={editable ? () => undefined : null}
          onPickMachine={() => undefined}
        />
      </Provider>,
    );
  };

  it('offers «تعديل» on a zone of the edit branch only', () => {
    expect(detail(ZONE_A)).toContain('data-zone-edit');
    expect(detail({ ...ZONE_A, branchId: BRANCH_B })).not.toContain('data-zone-edit');
  });

  it('writes its bank, area and overlap counts in the UI’s digits (DM-21)', () => {
    const membership = new Map(
      POINTS.points.map((p) => [p.machineId, { primary: ZONE_A.id, all: [ZONE_A.id] }]),
    );
    const html = renderToStaticMarkup(
      <Provider store={store(EDITOR)}>
        <ZoneDetail
          zone={ZONE_A}
          breakdown={zoneBreakdown(ZONE_A.id, POINTS.points, membership)}
          overlaps={3}
          locale="ar"
          banks={BANKS}
          onBack={() => undefined}
          onEdit={null}
          onPickMachine={() => undefined}
        />
      </Provider>,
    );
    const counts = [...html.matchAll(/<strong class="tabular-nums">([^<]*)<\/strong>/g)].map(
      (m) => m[1] ?? '',
    );
    expect(counts.length).toBeGreaterThan(0);
    for (const count of counts) expect(count).toMatch(/^[٠-٩٬]+$/);
    expect(html).toContain('٣');
    expect(html).not.toMatch(/قطاعات أخرى: \d/);
  });
});

describe('MachinePopup', () => {
  const popup = (warnings: AtmMapPointDto['warnings']): string =>
    renderToStaticMarkup(
      <Provider store={store(EDITOR)}>
        <MemoryRouter>
          <MachinePopup
            point={{ ...(POINTS.points[0] as AtmMapPointDto), warnings }}
            branchName="فرع تجريبي أ"
            zone={{ primary: null, all: [] }}
            locale="ar"
            banks={BANKS}
            canOpenRegister={false}
            canMove={false}
            onClose={() => undefined}
            onMove={() => undefined}
            onNavigate={() => undefined}
          />
        </MemoryRouter>
      </Provider>,
    );

  it('says when the pin is outside Egypt — a warning no other screen would show (DM-35)', () => {
    expect(popup(['outsideEgypt'])).toContain(t('atm.map.location.outsideEgypt'));
    expect(popup([])).not.toContain('data-popup-outside');
  });
});

describe('a bank added to the catalog (DEC-35)', () => {
  const QNB_POINTS: AtmMapPointsDto = {
    ...POINTS,
    points: [...POINTS.points, point(4, { bankCode: 'QNB' })],
  };

  it('the legend names it in its own colour, after the six, before «بنك غير محدد»', () => {
    const html = renderToStaticMarkup(
      <Provider store={store(EDITOR)}>
        <BankLegend
          locale="ar"
          banks={BANKS}
          codes={banksOnShow(
            BANKS,
            QNB_POINTS.points.map((p) => p.bankCode),
          )}
        />
      </Provider>,
    );
    const rows = [...html.matchAll(/data-map-legend-bank="([^"]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual(['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT', 'QNB', 'none']);
    expect(html).toContain('بنك تجريبي سابع');
    expect(html).toContain('background-color:#7030A0');
  });

  it('the popup names it from the catalog, with its code and its colour', () => {
    const html = renderToStaticMarkup(
      <Provider store={store(EDITOR)}>
        <MemoryRouter>
          <MachinePopup
            point={point(4, { bankCode: 'QNB' })}
            branchName="فرع تجريبي أ"
            zone={{ primary: null, all: [] }}
            locale="ar"
            banks={BANKS}
            canOpenRegister={false}
            canMove={false}
            onClose={() => undefined}
            onMove={() => undefined}
            onNavigate={() => undefined}
          />
        </MemoryRouter>
      </Provider>,
    );
    expect(html).toContain('بنك تجريبي سابع (QNB)');
    expect(html).toContain('background-color:#7030A0');
  });

  it('a `banks=QNB` link survives the page and filters the figures to its machines', () => {
    const { html } = render({ permissions: EDITOR, search: 'banks=QNB', points: QNB_POINTS });
    const value = (key: string): string | undefined =>
      new RegExp(`data-map-figure-value="${key}"[^>]*>([^<]*)<`).exec(html)?.[1];
    expect(value('onMap')).toBe('١');
    expect(value('unlocated')).toBe('٠');
  });

  it('ZoneDetail lists it with its catalog name', () => {
    const membership = new Map(
      QNB_POINTS.points.map((p) => [p.machineId, { primary: ZONE_A.id, all: [ZONE_A.id] }]),
    );
    const html = renderToStaticMarkup(
      <Provider store={store(EDITOR)}>
        <ZoneDetail
          zone={ZONE_A}
          breakdown={zoneBreakdown(ZONE_A.id, QNB_POINTS.points, membership, BANKS.codes)}
          overlaps={0}
          locale="ar"
          banks={BANKS}
          onBack={() => undefined}
          onEdit={null}
          onPickMachine={() => undefined}
        />
      </Provider>,
    );
    expect(html).toContain('بنك تجريبي سابع');
    expect(html.indexOf('البنك الأهلي المصري')).toBeLessThan(html.indexOf('بنك تجريبي سابع'));
  });
});

describe('the header', () => {
  const header = (editing: boolean): string =>
    renderToStaticMarkup(
      <Provider store={store(EDITOR)}>
        <MapPageHeader
          title={t('atm.map.title')}
          editing={editing}
          figures={<span data-figures-slot="true" />}
          actions={<button type="button">action</button>}
        />
      </Provider>,
    );

  it('is the title alone in edit mode', () => {
    const html = header(true);
    expect(html).toContain(t('atm.map.title'));
    expect(html).not.toContain('data-figures-slot');
    expect(html).not.toContain('<button');
  });

  it('carries the figures and the actions in view mode', () => {
    const html = header(false);
    expect(html).toContain('data-figures-slot');
    expect(html).toContain('<button');
  });

  it('has no subtitle on the page', () => {
    const { html } = render({ permissions: EDITOR });
    const head = html.slice(html.indexOf('<h1'), html.indexOf('data-map-filters'));
    expect(head).not.toMatch(/<p[\s>]/);
  });
});

describe('the map is lazy', () => {
  it('the page renders the canvas fallback, not Leaflet', () => {
    const { html } = render({ permissions: EDITOR });
    expect(html).toContain('animate-pulse rounded-2xl bg-slate-100');
    expect(html).not.toContain('leaflet-container');
  });
});
