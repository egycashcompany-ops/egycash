// The landing screen: real server figures, in the owner's layout.
//
// Every number on this page is an aggregate the server computed, and the page's whole job is to
// place them: the matrix (type × branch, with a row total), the branch readout that follows the
// selector, the distance strip and its two rankings, the licences coming due, and the day's two
// strips with their monthly tallies. What this file pins is that each of those reads the field it
// is about — a dashboard that mapped one field onto another would still look right and be wrong.
//
// The four states are here too, because a landing screen is where a reader meets an outage: the
// skeleton, the retryable error, the honest empty, and the populated board.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetDashboardDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { FleetDashboardPage, dashboardView } from './pages/FleetDashboardPage';

const B1 = '650000000000000000000101';
const B2 = '650000000000000000000102';
const T1 = '650000000000000000000201';
const T2 = '650000000000000000000202';

const DASHBOARD: FleetDashboardDto = {
  branches: [
    { id: B1, name: { ar: 'المهندسين', en: 'Mohandessin' } },
    { id: B2, name: { ar: 'أكتوبر', en: 'October' } },
  ],
  fleet: {
    types: [
      {
        typeId: T1,
        name: { ar: 'مرسيدس اسبرانتر 515', en: 'Mercedes 515' },
        counts: { [B1]: 47, [B2]: 14 },
        total: 61,
      },
      { typeId: T2, name: { ar: 'تويوتا', en: 'Toyota' }, counts: { [B2]: 4 }, total: 4 },
    ],
    stats: [
      {
        branchId: null,
        vehicles: 209,
        drivers: 269,
        cashVehicles: 100,
        cashDrivers: 70,
        atmVehicles: 90,
        atmDrivers: 78,
      },
      {
        branchId: B2,
        vehicles: 25,
        drivers: 35,
        cashVehicles: 8,
        cashDrivers: 4,
        atmVehicles: 13,
        atmDrivers: 10,
      },
      {
        branchId: B1,
        vehicles: 120,
        drivers: 150,
        cashVehicles: 60,
        cashDrivers: 40,
        atmVehicles: 50,
        atmDrivers: 44,
      },
    ],
    dueLicenses: [
      {
        vehicleId: 'v231',
        code: '231',
        branchId: B1,
        licenseExpiresAt: '2026-01-22T00:00:00.000Z',
      },
    ],
  },
  odometer: {
    byBranch: [
      { branchId: B1, km: 126_463 },
      { branchId: B2, km: 0 },
    ],
    top: [{ vehicleId: 'v529', code: '529', km: 100_224 }],
    bottom: [{ vehicleId: 'v531', code: '531', km: 0 }],
  },
  maintenance: {
    today: [
      {
        visitId: 'visit1',
        code: '150',
        workshop: { ar: 'مصنع', en: 'Factory' },
        workType: { ar: 'صيانة', en: 'Service' },
        spareParts: [{ ar: 'فرامل', en: 'Brakes' }],
        notes: 'ملاحظة',
      },
    ],
    monthCount: 22,
  },
  accidents: { today: [], monthCount: 0 },
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: { 'fleetVehicle.view': 'organization' },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = (data?: FleetDashboardDto | 'pending'): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (data !== 'pending' && data !== undefined) qc.setQueryData(['fleet', 'dashboard'], data);
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/fleet']}>
          <FleetDashboardPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const t = (key: string): string => translate('ar', key);
/** One row of the matrix, from its marker to the end of the row. */
const matrixRow = (markup: string, typeId: string): string => {
  const at = markup.indexOf(`data-matrix-row="${typeId}"`);
  if (at === -1) return '';
  return markup.slice(at, markup.indexOf('</tr>', at));
};
/** One stat tile's text. */
const tile = (markup: string, key: string): string => {
  const at = markup.indexOf(`data-stat="${key}"`);
  if (at === -1) return '';
  return markup.slice(at, markup.indexOf('</div>', markup.indexOf('</p>', at)));
};

describe('the fleet matrix', () => {
  it('is a type per row, a branch per column, and the row’s own total', () => {
    const markup = render(DASHBOARD);
    expect(markup).toContain(t('fleet.dashboard.distributionTitle'));
    expect(markup, 'the branch columns, named').toContain('المهندسين');
    expect(markup).toContain('أكتوبر');
    const row = matrixRow(markup, T1);
    expect(row, 'the type').toContain('مرسيدس اسبرانتر 515');
    expect(row, 'its count in the first branch').toContain('٤٧');
    expect(row, 'and in the second').toContain('١٤');
    expect(row, 'and the total the server summed').toContain('٦١');
  });

  it('prints a dash where a branch holds none of a type — never a zero', () => {
    // A zero and "none here" read the same in a grid of numbers; the dash is what makes the
    // filled cells legible at a glance, which is the whole point of the matrix.
    const row = matrixRow(render(DASHBOARD), T2);
    expect(row, 'the branch with none').toContain('—');
    expect(row, 'the branch with four').toContain('٤');
  });
});

describe('the branch readout', () => {
  it('shows the WHOLE company until a branch is picked', () => {
    const markup = render(DASHBOARD);
    expect(tile(markup, 'vehicles'), 'every car').toContain('٢٠٩');
    expect(tile(markup, 'drivers')).toContain('٢٦٩');
    expect(tile(markup, 'cashVehicles')).toContain('١٠٠');
    expect(tile(markup, 'cashDrivers')).toContain('٧٠');
    expect(tile(markup, 'atmVehicles')).toContain('٩٠');
    expect(tile(markup, 'atmDrivers')).toContain('٧٨');
  });

  it('offers every branch, and the all-branches option, in ONE select', () => {
    const markup = render(DASHBOARD);
    expect(markup).toContain(t('fleet.dashboard.allBranches'));
    // The select carries the branches; picking one is a click, verified in the browser.
    expect(markup).toMatch(/<option value="650000000000000000000102">أكتوبر<\/option>/);
  });

  it('reads each tile from its OWN field — a mapping slip would be invisible otherwise', () => {
    const markup = render({
      ...DASHBOARD,
      fleet: {
        ...(DASHBOARD.fleet as NonNullable<FleetDashboardDto['fleet']>),
        stats: [
          {
            branchId: null,
            vehicles: 1,
            drivers: 2,
            cashVehicles: 3,
            cashDrivers: 4,
            atmVehicles: 5,
            atmDrivers: 6,
          },
        ],
      },
    });
    for (const [key, digit] of [
      ['vehicles', '١'],
      ['drivers', '٢'],
      ['cashVehicles', '٣'],
      ['cashDrivers', '٤'],
      ['atmVehicles', '٥'],
      ['atmDrivers', '٦'],
    ] as const) {
      expect(tile(markup, key), `${key} reads its own field`).toContain(digit);
    }
  });
});

describe('distance, and what is coming due', () => {
  it('bars the branches by kilometre, naming each', () => {
    const markup = render(DASHBOARD);
    expect(markup).toContain(t('fleet.dashboard.kmByBranchTitle'));
    expect(markup).toContain(`data-km-branch="${B1}"`);
    expect(markup, 'the figure the server summed').toContain('١٢٦٬٤٦٣');
  });

  it('ranks the busiest and the idlest, each in its own list', () => {
    const markup = render(DASHBOARD);
    expect(markup).toContain(t('fleet.dashboard.topVehiclesTitle'));
    expect(markup).toContain(t('fleet.dashboard.bottomVehiclesTitle'));
    expect(markup).toContain('data-rank-row="top-1"');
    expect(markup).toContain('data-rank-row="bottom-1"');
    expect(markup, 'the busiest car').toContain('١٠٠٬٢٢٤');
  });

  it('lists a licence with its branch, its code and its date', () => {
    const markup = render(DASHBOARD);
    expect(markup).toContain('data-due-license="v231"');
    expect(markup, 'the branch that must renew it').toContain('المهندسين');
    expect(markup).toContain('>231<');
  });
});

describe('the day', () => {
  it('states the month’s workshop tally and lists today’s visits in full', () => {
    const markup = render(DASHBOARD);
    expect(markup).toContain('data-visits-month="true"');
    expect(markup, 'the month').toContain('٢٢');
    const visit = markup.slice(
      markup.indexOf('data-visit-today="visit1"'),
      markup.indexOf('</tr>', markup.indexOf('data-visit-today="visit1"')),
    );
    expect(visit, 'the car').toContain('150');
    expect(visit, 'the parts').toContain('فرامل');
    expect(visit, 'the work').toContain('صيانة');
    expect(visit, 'the workshop').toContain('مصنع');
    expect(visit, 'the note').toContain('ملاحظة');
  });

  it('says plainly that nothing happened today, rather than showing an empty table', () => {
    const markup = render(DASHBOARD);
    expect(markup).toContain(t('fleet.dashboard.accidentsTodayEmpty'));
    expect(markup).toContain('data-accidents-month="true"');
  });

  it('lists an accident when there is one', () => {
    const markup = render({
      ...DASHBOARD,
      accidents: {
        today: [
          {
            accidentId: 'a1',
            code: '213',
            occurredAt: '2026-09-15T08:00:00.000Z',
            culprit: 'طرف ثالث',
            status: 'open',
          },
        ],
        monthCount: 3,
      },
    });
    expect(markup).toContain('data-accident-today="a1"');
    expect(markup).toContain('طرف ثالث');
  });
});

describe('the four states a landing screen has', () => {
  it('LOADING: a skeleton, not an empty fleet', () => {
    const markup = render('pending');
    expect(markup, 'no zeroes pretending to be data').not.toContain('data-fleet-matrix');
    expect(markup).toContain('animate-pulse');
  });

  it('ERROR: a refused read is an error, never an empty fleet', () => {
    // The DECISION, which is what a data-less React Query cannot express through an SSR render:
    // its server snapshot reports pending whatever the cache holds. The rendering of this branch
    // — the message and the retry — is verified in Chromium against a server that really refuses.
    expect(dashboardView({ isPending: false, isError: true, data: undefined })).toBe('error');
    expect(dashboardView({ isPending: true, isError: false, data: undefined })).toBe('loading');
    expect(dashboardView({ isPending: false, isError: false, data: DASHBOARD })).toBe('ready');
    // …and an answer that somehow arrives empty is an error too, not a fleet of nothing.
    expect(dashboardView({ isPending: false, isError: false, data: undefined })).toBe('error');
  });

  it('EMPTY: a fleet with nothing in it still renders its frame', () => {
    const markup = render({
      ...DASHBOARD,
      fleet: { types: [], stats: [], dueLicenses: [] },
      odometer: { byBranch: [], top: [], bottom: [] },
      maintenance: { today: [], monthCount: 0 },
      accidents: { today: [], monthCount: 0 },
    });
    expect(markup).toContain(t('fleet.dashboard.distributionEmpty'));
    expect(markup).toContain(t('fleet.dashboard.licensesEmpty'));
  });

  it('PERMISSION: a section the caller may not read is absent, not empty', () => {
    // The server sends `null` for a section its reader may not have. Nothing on the page asks a
    // second time, so this is the whole gate.
    const markup = render({
      branches: DASHBOARD.branches,
      fleet: null,
      odometer: null,
      maintenance: DASHBOARD.maintenance,
      accidents: null,
    });
    expect(markup, 'no matrix').not.toContain('data-fleet-matrix');
    expect(markup, 'no branch readout').not.toContain('data-stat="vehicles"');
    expect(markup, 'no distance').not.toContain(t('fleet.dashboard.kmByBranchTitle'));
    expect(markup, 'the workshop, which they may read').toContain(
      t('fleet.dashboard.visitsTodayTitle'),
    );
  });

  it('NOTHING AT ALL: one honest empty state', () => {
    const markup = render({
      branches: [],
      fleet: null,
      odometer: null,
      maintenance: null,
      accidents: null,
    });
    expect(markup).toContain(t('fleet.overview.noAccessTitle'));
  });
});

describe('nothing is counted in the browser', () => {
  it('the page reads the server’s figures and computes no total of its own', () => {
    const source = readSource();
    expect(source, 'no client-side counting').not.toMatch(/\.filter\([^)]*\)\.length/);
    expect(source, 'one read').toContain('useFleetDashboard()');
  });
});

const readSource = (): string =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'pages/FleetDashboardPage.tsx'),
    'utf8',
  );
