// /atm/map/unlocated «ماكينات بدون موقع», rendered (docs/12-planning/atm-map-zones.md §9.4):
//
//   · a locate holder sees the reason chips, the sync card and the link card;
//   · «الموقع في السجل» shows only when the server says the register's text is visible;
//   · a branch where the reader cannot locate lists no row — every row shown can be acted on;
//   · the link card has no stop and no retry (DM-46): one button, «بدء التحويل».
//
// Every branch, machine and text below is synthetic.
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  type AtmMachineLocationDetailDto,
  type AtmMapContextDto,
  type AtmMapLocationSummaryDto,
  type AtmMapPointDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { UnlocatedMachinesPage } from './pages/UnlocatedMachinesPage';
import { LinkResolutionCard } from './components/map/LinkResolutionCard';
import { UnlocatedRow, type UnlocatedRowActions } from './components/map/UnlocatedRow';
import { UNLOCATED_ROWS_STEP, UnlocatedPanel } from './components/map/UnlocatedPanel';
import { TileErrorBanner } from './components/map/TileErrorBanner';
import { makeBankLookup } from './lib/bank-catalog';
import {
  mapContextKey,
  mapLocationKey,
  mapLocationSummaryKey,
  mapPointsKey,
  mapZonesKey,
} from './api/map-queries';

/** The bank lookup before the catalog answers — the six seeds (DEC-35). */
const SEED_BANKS = makeBankLookup();

const t = (key: string): string => translate('ar', key);

const BRANCH_A = '66a000000000000000000001';
const BRANCH_B = '66a000000000000000000002';

const CONTEXT: AtmMapContextDto = {
  branches: [
    {
      id: BRANCH_A,
      name: { ar: 'فرع تجريبي أ', en: 'SYN A' },
      canManageZones: false,
      canLocate: true,
    },
    {
      id: BRANCH_B,
      name: { ar: 'فرع تجريبي ب', en: 'SYN B' },
      canManageZones: false,
      canLocate: false,
    },
  ],
  organizationWide: true,
  editBranchId: null,
  editBlocked: 'branchNotEditable',
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
  lat: null,
  lng: null,
  state: 'unlocated',
  source: null,
  reason: 'shortLink',
  warnings: [],
  lastSet: null,
  ...over,
});

const POINTS = [
  point(1),
  point(2, { reason: 'none' }),
  point(3, { state: 'review', lat: 30.01, lng: 31.01, source: 'registerShortCode', reason: null }),
  point(4, { state: 'located', lat: 30.02, lng: 31.02, source: 'registerUrl', reason: null }),
  // Branch B: the reader cannot locate there.
  point(5, { branchId: BRANCH_B, reason: 'noCoordinates' }),
];

const SUMMARY: AtmMapLocationSummaryDto = {
  totalActive: 4,
  located: 1,
  review: 1,
  unlocated: 2,
  byReason: {
    shortLink: 1,
    shortLinkFailed: 0,
    noCoordinates: 0,
    shortPlusCodeNoReference: 0,
    invalidCoordinates: 0,
    unreadable: 0,
    none: 1,
    noEntry: 0,
    conflictingEntries: 0,
    notSynced: 0,
  },
  pendingSync: 0,
  shortLinksPending: 1,
  shortLinksFailed: 0,
  lastSyncAt: '2026-10-18T08:00:00.000Z',
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: { 'atmMap.view': 'organization', 'atmMachine.locate': 'organization' },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const wrap = (qc: QueryClient, node: JSX.Element): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/atm/map/unlocated?branch=all']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const renderPage = (): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(mapContextKey(), CONTEXT);
  qc.setQueryData(mapPointsKey({ branchId: null, status: 'active' }), {
    points: POINTS,
    generatedAt: '2026-10-18T08:00:00.000Z',
  });
  qc.setQueryData(mapZonesKey({ branchId: null }), { sets: [] });
  qc.setQueryData(mapLocationSummaryKey({ branchId: null }), SUMMARY);
  return wrap(qc, <UnlocatedMachinesPage />);
};

describe('the unlocated screen for a locate holder', () => {
  const html = renderPage();

  it('shows the reason chips, the sync card and the link card', () => {
    expect(html).toContain('data-reason-chips');
    expect(html).toContain('data-reason-chip="review"');
    expect(html).toContain('data-reason-chip="shortLink"');
    expect(html).toContain('data-reason-chip="none"');
    expect(html).toContain('data-sync-card');
    expect(html).toContain('data-link-card');
    expect(html).toContain(t('atm.map.sync.title'));
    expect(html).toContain(t('atm.map.links.title'));
  });

  it('lists the rows of the branches it may locate in — and none of the others', () => {
    for (const n of [1, 2, 3]) expect(html).toContain(`data-unlocated-row="${point(n).machineId}"`);
    expect(html).not.toContain(`data-unlocated-row="${point(5).machineId}"`);
    expect(html).not.toContain('data-reason-chip="noCoordinates"');
    // A located machine needs nothing and is not a row.
    expect(html).not.toContain(`data-unlocated-row="${point(4).machineId}"`);
  });

  it('agrees with «تم تحديد موقع n من m»', () => {
    expect(html).toContain(
      t('atm.map.unlocated.progress').replace('{{done}}', '١').replace('{{total}}', '٤'),
    );
  });

  it('below lg the list is capped, so the map — where «تأكيد الموقع» is — stays in reach', () => {
    const aside = /<aside[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(aside).toContain('max-h-[50vh]');
    expect(aside).toContain('lg:max-h-none');
  });
});

describe('a long list', () => {
  const many = Array.from({ length: 200 }, (_, i) => point(100 + i));
  const actions: UnlocatedRowActions = {
    onCorrect: () => undefined,
    onPreview: () => undefined,
    onPlace: () => undefined,
    zoneNameAt: () => '',
  };
  const panel = (openId: string | null): string =>
    wrap(
      new QueryClient(),
      <UnlocatedPanel
        locale="ar"
        banks={SEED_BANKS}
        branchId={null}
        summary={SUMMARY}
        chips={[]}
        selectedReasons={[]}
        rows={many}
        anyRows
        query=""
        openId={openId}
        branchNames={new Map()}
        actions={actions}
        onToggleReason={() => undefined}
        onQuery={() => undefined}
        onToggleRow={() => undefined}
      />,
    );
  const rowsIn = (html: string): number => (html.match(/data-unlocated-row=/g) ?? []).length;

  it('draws its first rows, and the rest as the end of the list comes near (UX-8)', () => {
    const html = panel(null);
    expect(rowsIn(html)).toBe(UNLOCATED_ROWS_STEP);
    expect(html).toContain('data-unlocated-more');
  });

  it('always draws the open row', () => {
    expect(rowsIn(panel(many[150]?.machineId ?? null))).toBe(151);
  });

  it('a closed row holds no query of its own — it renders without a query client', () => {
    expect(() =>
      renderToStaticMarkup(
        <Provider store={store()}>
          <UnlocatedRow
            point={many[0] as AtmMapPointDto}
            branchName=""
            open={false}
            locale="ar"
            banks={SEED_BANKS}
            actions={actions}
            onToggle={() => undefined}
          />
        </Provider>,
      ),
    ).not.toThrow();
  });
});

describe('the tile banner', () => {
  it('takes no click and starts right of the zoom and «عرض الكل» column', () => {
    const html = renderToStaticMarkup(
      <Provider store={store()}>
        <TileErrorBanner dir="rtl" />
      </Provider>,
    );
    const cls = /class="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(cls).toContain('pointer-events-none');
    expect(cls).toContain('left-14');
    expect(cls).not.toContain('inset-x-3');
  });
});

describe('an open row', () => {
  const actions: UnlocatedRowActions = {
    onCorrect: () => undefined,
    onPreview: () => undefined,
    onPlace: () => undefined,
    zoneNameAt: () => '',
  };
  const detail = (over: Partial<AtmMachineLocationDetailDto>): AtmMachineLocationDetailDto => ({
    machineId: point(3).machineId,
    version: 2,
    state: 'review',
    lat: 30.01,
    lng: 31.01,
    source: 'registerShortCode',
    reason: null,
    warnings: [],
    needsReview: true,
    pinned: false,
    reference: null,
    shortLink: null,
    sourceVisible: false,
    sourceText: null,
    manualText: null,
    moveReason: null,
    setByName: null,
    setAt: null,
    reviewedByName: null,
    reviewedAt: null,
    derivedAt: null,
    ...over,
  });
  const row = (loaded: AtmMachineLocationDetailDto): string => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(mapLocationKey(loaded.machineId), loaded);
    return wrap(
      qc,
      <UnlocatedRow
        point={POINTS[2] as AtmMapPointDto}
        branchName="فرع تجريبي أ"
        open
        locale="ar"
        banks={SEED_BANKS}
        actions={actions}
        onToggle={() => undefined}
      />,
    );
  };

  it('leaves «الموقع في السجل» out when the register text is not visible to the reader', () => {
    const html = row(detail({ sourceVisible: false, sourceText: null }));
    expect(html).not.toContain(t('atm.map.unlocated.sourceLabel'));
    expect(html).not.toContain('data-source-line');
  });

  it('shows it, and the original link, when it is', () => {
    const html = row(
      detail({
        sourceVisible: true,
        sourceText: { plusCode: 'XXXX+XX', url: 'https://maps.app.goo.gl/SYNTHETIC' },
      }),
    );
    expect(html).toContain(t('atm.map.unlocated.sourceLabel'));
    expect(html).toContain('XXXX+XX');
    expect(html).toContain('href="https://maps.app.goo.gl/SYNTHETIC"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('never makes a non-http text an href', () => {
    const html = row(
      detail({ sourceVisible: true, sourceText: { plusCode: null, url: 'javascript:alert(1)' } }),
    );
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain(t('atm.map.unlocated.openOriginal'));
  });

  it('a pin under review says why and offers «اعتماد الموقع» and «تصحيح»', () => {
    const html = row(detail({ warnings: ['weakReference'] }));
    expect(html).toContain(t('atm.map.unlocated.reviewNote'));
    expect(html).toContain(t('atm.map.unlocated.weakNote'));
    expect(html).toContain(t('atm.map.unlocated.approve'));
    expect(html).toContain(t('atm.map.unlocated.correct'));
  });

  it('a placed pin outside Egypt says so, though it is not under review (DM-35)', () => {
    const html = row(
      detail({
        state: 'located',
        needsReview: false,
        source: 'registerPlusCode',
        warnings: ['outsideEgypt'],
      }),
    );
    expect(html).toContain(t('atm.map.location.outsideEgypt'));
    expect(html).not.toContain(t('atm.map.unlocated.reviewNote'));
  });
});

describe('the link card (DM-46)', () => {
  it('has one button, «بدء التحويل» — no stop and no retry', () => {
    const qc = new QueryClient();
    const html = wrap(qc, <LinkResolutionCard branchId={null} pending={3} locale="ar" />);
    expect(html.match(/<button/g) ?? []).toHaveLength(1);
    expect(html).toContain(t('atm.map.links.start'));
    expect(html).toContain(
      t('atm.map.links.progress').replace('{{done}}', '٠').replace('{{total}}', '٣'),
    );
  });
});
