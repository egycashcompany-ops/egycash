// «تمام نفذا الـ Dashboard بتاعت الفحص» — `/it/vehicle-checks`, proven against what it renders: every
// panel of the sample in its order; «تقرير جديد» and «حذف التقرير» by their grants; the filters read
// from the URL and asked of the server; a bar pressed for the device that is the filter; the matrix
// narrowed by the car, «بها عطل» and the device, each cell saying its answer in words; the report's
// side panel; and a count that failed saying so. What each request holds and how the words count is
// `lib/vehicle-check-dashboard.spec.ts`; the files are `lib/vehicle-check-export.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  IT_VEHICLE_CHECK_ITEMS,
  type ItVehicleCheckAnswer,
  type ItVehicleCheckDashboardDto,
  type ItVehicleCheckDto,
  type ItVehicleCheckItem,
  type ItVehicleCheckLatestDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { detailKey, listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import {
  cairoToday,
  dashboardQuery,
  periodWindow,
  reportsQuery,
  type VehicleCheckFilters,
} from '../lib/vehicle-check-dashboard';
import { VehicleCheckReport } from '../components/VehicleCheckReport';
import { VehicleChecksPage } from './VehicleChecksPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'VehicleChecksPage.tsx'), 'utf8');
const REPORT_SOURCE = readFileSync(join(HERE, '../components/VehicleCheckReport.tsx'), 'utf8');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const me = (permissions: string[]): MeDto =>
  ({
    id: 'u-1',
    email: 'user@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: null,
    branchIds: [],
    employeeId: null,
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const B_ENG = 'b-eng';
const B_OCT = 'b-oct';
const TODAY = cairoToday();

type Items = Record<ItVehicleCheckItem, ItVehicleCheckAnswer | null>;
const items = (over: Partial<Items> = {}): Items => ({
  ...(Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((item) => [item, 'works'])) as Items),
  ...over,
});
const noFaults = Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((item) => [item, 0])) as Record<
  ItVehicleCheckItem,
  number
>;

const latest = (over: Partial<ItVehicleCheckLatestDto>): ItVehicleCheckLatestDto => ({
  reportId: 'r-150',
  vehicleId: 'v-150',
  vehicleCode: '150',
  branchId: B_ENG,
  checkDate: TODAY,
  createdAt: `${TODAY}T06:12:00.000Z`,
  items: items(),
  photoCount: 3,
  hasNotes: false,
  reportedByName: 'وليد صفوت جلال',
  ...over,
});

const LATEST = [
  latest({ items: items({ camera7: 'notWorking' }), hasNotes: true }),
  latest({ reportId: 'r-152', vehicleId: 'v-152', vehicleCode: '152', branchId: B_OCT }),
  latest({
    reportId: 'r-corolla',
    vehicleId: 'v-corolla',
    vehicleCode: 'كورولا 1',
    branchId: B_OCT,
    items: items({ dvr: 'notWorking', radio: 'notWorking' }),
    photoCount: 4,
  }),
  latest({
    reportId: 'r-1003',
    vehicleId: 'v-1003',
    vehicleCode: '1003',
    items: items({ camera8: null }),
    photoCount: 0,
  }),
];

const window7 = periodWindow('7', TODAY);
const DASH: ItVehicleCheckDashboardDto = {
  ...window7,
  totals: {
    reports: 184,
    reporters: 12,
    carsChecked: 62,
    activeCars: 71,
    carsWithFaults: 2,
    devicesNotWorking: 3,
    overdueCars: 2,
    reportsWithoutPhoto: 4,
  },
  faultsByDevice: { ...noFaults, camera7: 1, dvr: 1, radio: 1 },
  latest: LATEST,
  overdue: [
    {
      vehicleId: 'v-518',
      vehicleCode: '518',
      branchId: B_OCT,
      lastCheckDate: null,
      daysSince: null,
    },
    {
      vehicleId: 'v-160',
      vehicleCode: '160',
      branchId: B_ENG,
      lastCheckDate: '2026-10-30',
      daysSince: 11,
    },
  ],
  overdueDays: 7,
};

/** «آخر ٣٠ يومًا» in أكتوبر — figures no other view has, so the page proves which it asked for. */
const NARROWED: ItVehicleCheckDashboardDto = {
  ...DASH,
  ...periodWindow('30', TODAY),
  totals: { ...DASH.totals, reports: 37, carsChecked: 9 },
};

const report = (over: Partial<ItVehicleCheckDto>): ItVehicleCheckDto => ({
  id: 'r-corolla',
  version: 0,
  vehicleId: 'v-corolla',
  vehicleCode: 'كورولا 1',
  branchId: B_OCT,
  checkDate: TODAY,
  items: items({ dvr: 'notWorking', radio: 'notWorking' }),
  notes: 'الـ DVR لا يسجّل، وجهاز الاتصال بلا إرسال.',
  photos: ['f-1', 'f-2'].map((fileId) => ({
    clientPhotoId: `0b8f7a8e-2d4c-4f61-9a7b-3c2d1e0f9a${fileId === 'f-1' ? '01' : '02'}`,
    fileId,
    fileName: `${fileId}.jpg`,
    mime: 'image/jpeg',
    size: 1000,
    uploadedAt: `${TODAY}T14:36:00.000Z`,
  })),
  reportedByUserId: 'u-2',
  reportedByName: 'شريف ممدوح فاروق',
  clientRequestId: '0b8f7a8e-2d4c-4f61-9a7b-3c2d1e0f9a8b',
  createdAt: `${TODAY}T14:35:00.000Z`,
  ...over,
});

const REPORTS = [
  report({}),
  report({
    id: 'r-152',
    vehicleId: 'v-152',
    vehicleCode: '152',
    items: items(),
    notes: null,
    photos: [],
    reportedByName: 'سامح نبيل',
  }),
];

const NONE: VehicleCheckFilters = {
  period: '7',
  branchId: '',
  car: '',
  vehicleId: '',
  faults: false,
  device: null,
};
const FILTERED: VehicleCheckFilters = {
  period: '30',
  branchId: B_OCT,
  car: '15',
  vehicleId: '',
  faults: true,
  device: 'camera7',
};
const FILTERED_URL = `/it/vehicle-checks?period=30&branch=${B_OCT}&car=15&faults=true&device=camera7`;

const branch = (id: string, name: string) => ({
  id,
  code: id,
  name: { ar: name, en: name },
  parentId: null,
});

/** «كل تقارير هذه السيارة» on the كورولا's report: the car pinned by its id, its code in the box. */
const PINNED: VehicleCheckFilters = { ...NONE, car: 'كورولا 1', vehicleId: 'v-corolla' };
const PINNED_URL = `/it/vehicle-checks?car=${encodeURIComponent('كورولا 1')}&vehicle=v-corolla`;

const client = ({
  failed = false,
  dash = DASH,
}: { failed?: boolean; dash?: ItVehicleCheckDashboardDto } = {}): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryOnMount: false, staleTime: Infinity, refetchOnMount: false },
    },
  });
  const dashKey = (filters: VehicleCheckFilters) =>
    listKey('it', 'vehicleChecks', { dashboard: true, ...dashboardQuery(filters, TODAY) });
  if (failed) {
    const query = qc.getQueryCache().build(qc, { queryKey: dashKey(NONE) });
    query.setState({
      ...query.state,
      status: 'error',
      error: new Error('boom'),
      errorUpdatedAt: 1,
      fetchStatus: 'idle',
    });
  } else {
    qc.setQueryData(dashKey(NONE), dash);
  }
  qc.setQueryData(dashKey(FILTERED), NARROWED);
  const page = { page: 1, pageSize: 12, totalItems: 25, totalPages: 3 };
  qc.setQueryData(listKey('it', 'vehicleChecks', reportsQuery(NONE, TODAY)), {
    items: REPORTS,
    meta: page,
  });
  qc.setQueryData(listKey('it', 'vehicleChecks', reportsQuery(FILTERED, TODAY)), {
    items: [],
    meta: { ...page, totalItems: 0, totalPages: 0 },
  });
  qc.setQueryData(listKey('it', 'vehicleChecks', reportsQuery(PINNED, TODAY)), {
    items: [REPORTS[0]],
    meta: { ...page, totalItems: 1, totalPages: 1 },
  });
  qc.setQueryData(listKey('it', 'branchOptions'), [
    branch(B_ENG, 'المهندسين'),
    branch(B_OCT, 'أكتوبر'),
  ]);
  qc.setQueryData(detailKey('it', 'vehicleChecks', 'r-corolla'), REPORTS[0]);
  return qc;
};

const wrap = (permissions: string[], path: string, node: JSX.Element, qc: QueryClient): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/it/vehicle-checks" element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const VIEW = ['itVehicleCheck.view'];
const render = (
  permissions: string[] = VIEW,
  path = '/it/vehicle-checks',
  options: { failed?: boolean; dash?: ItVehicleCheckDashboardDto } = {},
): string => wrap(permissions, path, <VehicleChecksPage />, client(options));

const renderReport = (permissions: string[]): string =>
  wrap(
    permissions,
    '/it/vehicle-checks',
    <VehicleCheckReport
      reportId="r-corolla"
      onClose={() => undefined}
      onCarReports={() => undefined}
      branchName={(id) => (id === B_OCT ? 'أكتوبر' : '—')}
    />,
    client(),
  );

const text = (markup: string): string =>
  markup
    .replace(/<[^>]*>/gu, ' ')
    .replaceAll('&quot;', '"')
    .replace(/\s+/gu, ' ');

const hrefs = (html: string): string[] =>
  [...html.matchAll(/href="([^"]*)"/gu)].map((m) => (m[1] ?? '').replaceAll('&amp;', '&'));

/** The markup of the element carrying `attr`, to ITS closing tag — nested ones of the same name counted. */
const block = (html: string, attr: string, tag: string): string => {
  const start = html.indexOf(attr);
  expect(start, attr).toBeGreaterThan(-1);
  const open = html.lastIndexOf(`<${tag}`, start);
  const tags = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'gu');
  tags.lastIndex = open;
  let depth = 0;
  for (let m = tags.exec(html); m !== null; m = tags.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index + m[0].length);
  }
  return html.slice(open);
};

const matrixCodes = (html: string): string[] =>
  [...html.matchAll(/data-matrix-row="([^"]+)"/gu)].map((m) => m[1] ?? '');

describe('the panels, in the sample’s order', () => {
  const html = render();

  it('shows the title, the bar, the six tiles and the four panels, in that order', () => {
    const order = [
      ar('it.vehicleChecks.title'),
      'data-period=""',
      'data-tiles=""',
      ar('it.vehicleChecks.byDevice.title'),
      ar('it.vehicleChecks.overdue.title', { days: '٧ أيام' }),
      ar('it.vehicleChecks.matrix.title'),
      // The hint, not the title: «آخر التقارير» is also inside a tile's line.
      ar('it.vehicleChecks.recent.hint'),
    ].map((needle) => html.indexOf(needle));
    expect(
      order.every((at) => at > -1),
      JSON.stringify(order),
    ).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('says no sentence under the title', () => {
    expect(html).not.toContain('تقارير الفحص التي يرسلها المكلّفون من الهاتف');
  });

  it('gives the six tiles the server’s figures, in Arabic digits', () => {
    const tiles = text(block(html, 'data-tiles=""', 'div'));
    expect(tiles).toContain(`${ar('it.vehicleChecks.tiles.reports')} ١٨٤ أرسلها ١٢ مستخدمًا`);
    expect(tiles).toContain(`${ar('it.vehicleChecks.tiles.carsChecked')} ٦٢ من ٧١ سيارة نشطة`);
    expect(tiles).toContain(`${ar('it.vehicleChecks.tiles.carsWithFaults')} ٢`);
    expect(tiles).toContain(`${ar('it.vehicleChecks.tiles.devicesNotWorking')} ٣`);
    expect(tiles).toContain('لم تُفحص منذ ٧ أيام ٢');
    expect(tiles).toContain(`${ar('it.vehicleChecks.tiles.withoutPhoto')} ٤`);
  });

  it('bars each device with its count of cars «لا يعمل»', () => {
    // One digit system in the label: «داخل الخزينة ١», as the approved sample wrote it.
    expect(text(block(html, 'data-device-bar="camera7"', 'button'))).toContain(
      'كاميرا ٧ — داخل الخزينة ١ ١',
    );
    expect(text(block(html, 'data-device-bar="screen"', 'button'))).toContain('الشاشة ٠');
    expect(html.match(/data-device-bar="/gu)).toHaveLength(11);
  });

  it('lists the overdue cars — never checked first — with their branch now', () => {
    const never = text(block(html, 'data-overdue="v-518"', 'li'));
    expect(never).toContain('518');
    expect(never).toContain('أكتوبر');
    expect(never).toContain(ar('it.vehicleChecks.overdue.never'));
    expect(text(block(html, 'data-overdue="v-160"', 'li'))).toContain('آخر فحص منذ ١١ يومًا');
    expect(html.indexOf('data-overdue="v-518"')).toBeLessThan(html.indexOf('data-overdue="v-160"'));
  });

  it('says every active car was checked only when the reader sees one', () => {
    const none = (activeCars: number): string =>
      text(
        block(
          render(VIEW, '/it/vehicle-checks', {
            dash: { ...DASH, overdue: [], totals: { ...DASH.totals, activeCars, overdueCars: 0 } },
          }),
          'data-overdue-empty=""',
          'p',
        ),
      );
    expect(none(71)).toContain(ar('it.vehicleChecks.overdue.empty', { days: '٧ أيام' }));
    // No active car in the reader's view: not «every active car was checked».
    expect(none(0)).toContain(ar('it.vehicleChecks.tiles.noActiveCars'));
    expect(none(0)).not.toContain(ar('it.vehicleChecks.overdue.empty', { days: '٧ أيام' }));
  });

  it('shows each car’s latest report in Fleet’s order, with its faults counted', () => {
    expect(matrixCodes(html)).toEqual(['v-150', 'v-152', 'v-corolla', 'v-1003']);
    const corolla = text(block(html, 'data-matrix-row="v-corolla"', 'tr'));
    expect(corolla).toContain('كورولا 1');
    expect(corolla).toContain('عطلان');
    expect(corolla).toContain('أكتوبر');
    expect(corolla).toContain(ar('it.vehicleChecks.openReport'));
    // The eleven device heads, short, each with its full label for a pointer.
    expect(html).toContain('title="كاميرا ٧ — داخل الخزينة ١"');
    expect(html).toContain('>ك٧</th>');
  });

  it('says each cell’s answer in words — the mark alone is a picture', () => {
    const row150 = block(html, 'data-matrix-row="v-150"', 'tr');
    expect(row150).toContain('role="img" aria-label="كاميرا ٧ — داخل الخزينة ١: لا يعمل"');
    expect(row150).toContain('aria-label="الشاشة: يعمل"');
    const row1003 = block(html, 'data-matrix-row="v-1003"', 'tr');
    expect(row1003).toContain('aria-label="كاميرا ٨ — داخل الخزينة ٢: لم يُفحص"');
    // Every one of the eleven cells of every row says so.
    expect(html.match(/role="img" aria-label="/gu)).toHaveLength(11 * LATEST.length);
  });

  it('lets the matrix scroll in its own box at phone width, never the page', () => {
    expect(block(html, 'data-matrix=""', 'table')).toContain('min-w-[68rem]');
    expect(html).toMatch(/<div class="overflow-x-auto[^"]*"><table[^>]*data-matrix=""/u);
  });

  // As a header action that does not shrink, the legend squeezed the panel's title to a few
  // letters at 360px. It sits in the body, above the table that scrolls.
  it('puts the legend in the panel’s body above the table, never beside its title', () => {
    const title = html.indexOf(`>${ar('it.vehicleChecks.matrix.title')}</h3>`);
    // The panel's body — the card's header ends where it opens.
    const body = html.indexOf('<div class="px-5 py-4 min-w-0 flex-1">', title);
    expect(title).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(title);
    const legend = html.indexOf('data-legend', title);
    expect(legend).toBeGreaterThan(body);
    expect(legend).toBeLessThan(html.indexOf('data-matrix=""'));
    // …and it wraps, rather than pushing the panel wider than a phone.
    expect(block(html, 'data-legends=""', 'div')).toContain('flex-wrap');
  });

  it('carries each report as a card: car, day and time, reporter, chip, faults, note, photos', () => {
    const card = text(block(html, 'data-report="r-corolla"', 'article'));
    expect(card).toContain('كورولا 1');
    expect(card).toContain('شريف ممدوح فاروق');
    expect(card).toContain('عطلان');
    expect(card).toContain('DVR');
    expect(card).toContain('جهاز الاتصال (موتورولا)');
    expect(card).toContain('الـ DVR لا يسجّل');
    expect(card).toContain('صورتان');
    const clean = text(block(html, 'data-report="r-152"', 'article'));
    expect(clean).toContain(ar('it.vehicleChecks.status.allWork'));
    expect(clean).toContain('بلا صور');
  });

  it('pages the reports with the app’s pager, on the server', () => {
    expect(text(html)).toContain(
      ar('common.pagination.showing', { from: '١', to: '١٢', total: '٢٥' }),
    );
    expect(SOURCE).toContain('onPageChange={(next) => patch({ page: String(next) }, false)}');
  });

  it('offers Excel and PDF of the reports', () => {
    expect(html).toContain('data-export="it-vehicle-checks"');
    expect(html).toContain('data-print="it-vehicle-checks"');
    expect(SOURCE).toContain('gatherRegister(reportsParams, api.listVehicleChecks)');
  });
});

describe('by grant', () => {
  it('offers «تقرير جديد» → the phone form to a holder of itVehicleCheck.create only', () => {
    expect(hrefs(render([...VIEW, 'itVehicleCheck.create']))).toContain('/it/vehicle-checks/new');
    expect(render(VIEW)).not.toContain(ar('it.vehicleChecks.newReport'));
  });

  it('offers «حذف التقرير» on a report to a holder of itVehicleCheck.delete only', () => {
    expect(renderReport([...VIEW, 'itVehicleCheck.delete'])).toContain(
      'data-delete-report="r-corolla"',
    );
    expect(renderReport(VIEW)).not.toContain('data-delete-report');
    expect(REPORT_SOURCE).toContain('<Can permission="itVehicleCheck.delete">');
  });
});

describe('the filters and the URL', () => {
  const html = render(VIEW, FILTERED_URL);

  it('ask the server for the period and the branch the URL names', () => {
    // 37 reports — NARROWED's figure, which only the 30-day, أكتوبر request answers.
    expect(text(block(html, 'data-tiles=""', 'div'))).toContain(
      `${ar('it.vehicleChecks.tiles.reports')} ٣٧`,
    );
  });

  it('show each filter as set: the period pressed, the branch, the car, «بها عطل», the device', () => {
    expect(block(html, 'data-period-option="30"', 'button')).toContain('aria-pressed="true"');
    expect(block(html, 'data-period-option="7"', 'button')).toContain('aria-pressed="false"');
    expect(html).toMatch(new RegExp(`<option value="${B_OCT}" selected="">`, 'u'));
    expect(html).toMatch(/<input type="search"[^>]*value="15"/u);
    // The checkbox's own tag — an <input> has no closing tag to read to.
    const faultsBox = (markup: string): string =>
      /<input[^>]*data-faults-only=""[^>]*>/u.exec(markup)?.[0] ?? '';
    expect(faultsBox(html)).toContain('checked=""');
    expect(faultsBox(render())).not.toContain('checked=""');
    expect(faultsBox(render())).not.toBe('');
    expect(text(block(html, 'data-device-chip="camera7"', 'span'))).toContain(
      'الجهاز: كاميرا ٧ — داخل الخزينة ١',
    );
    expect(html).toContain(`aria-label="${ar('it.vehicleChecks.filters.clearDevice')}"`);
  });

  it('offer «مسح الفلاتر» only while one is set — the period is not one', () => {
    expect(html).toContain('data-clear-filters=""');
    expect(render()).not.toContain('data-clear-filters');
    expect(render(VIEW, '/it/vehicle-checks?period=today')).not.toContain('data-clear-filters');
  });

  it('remember every filter, the period with them', () => {
    expect(SOURCE).toContain(
      "const REMEMBERED_FILTERS = ['branch', 'car', 'device', 'faults', 'period', 'vehicle'] as const;",
    );
    expect(SOURCE).toContain('useRememberedFilters([sp, setSp], REMEMBERED_FILTERS)');
  });

  it('keep the default period off the URL, so a bare arrival still means «آخر ٧ أيام»', () => {
    expect(SOURCE).toContain("onPatch({ period: period === '7' ? null : period })");
    expect(block(render(), 'data-period-option="7"', 'button')).toContain('aria-pressed="true"');
  });

  // «   » in the car box was mapped to nothing: the URL never changed, the box still differed from
  // it, and wrote again every 300 ms. What the box holds is kept, as on every IT register, and a
  // write that changes nothing is not made (`patchedSearch`, specced in the lib).
  it('keep the car box’s text as typed, and write the URL only when it changes', () => {
    expect(SOURCE).toContain(
      'onChange={(value) => onPatch({ car: value || null, vehicle: null })}',
    );
    expect(SOURCE).toContain('const next = patchedSearch(sp, updates, resetPage);');
    expect(SOURCE).toContain('if (next !== null) setSp(next, { replace });');
    // Spaces alone narrow nothing, and offer nothing to clear.
    const spaces = render(VIEW, '/it/vehicle-checks?car=+++');
    expect(matrixCodes(spaces)).toEqual(['v-150', 'v-152', 'v-corolla', 'v-1003']);
    expect(spaces).not.toContain('data-clear-filters');
  });

  it('move a page past the last to the last, replacing the entry', () => {
    expect(SOURCE).toContain('reportsPageBeyondEnd(page, reports.data.meta)');
    expect(SOURCE).toContain(
      'if (lastPage !== null) patch({ page: lastPage === 1 ? null : String(lastPage) }, false, true);',
    );
  });
});

// «كل تقارير هذه السيارة»: a car last checked nine days ago, under «آخر ٧ أيام», listed nothing
// although its report had just been open.
describe('a car pinned by its id', () => {
  const html = render(VIEW, PINNED_URL);

  it('lists the car’s reports on every day, and the header says the period does not apply', () => {
    const list = block(html, 'id="vehicle-check-reports"', 'section');
    expect(text(list)).toContain(ar('it.vehicleChecks.recent.allDaysHint'));
    expect(text(list)).toContain(ar('it.vehicleChecks.recent.allDays'));
    expect(list).toContain('data-report="r-corolla"');
    // Only while pinned.
    const plain = block(render(), 'id="vehicle-check-reports"', 'section');
    expect(text(plain)).toContain(ar('it.vehicleChecks.recent.hint'));
    expect(plain).not.toContain('data-all-days');
  });

  it('is what «كل تقارير هذه السيارة» sets — «بها عطل» and the device cleared', () => {
    expect(SOURCE).toContain('patch(carReportsPatch(car));');
  });

  it('prints its files over every day too', () => {
    expect(SOURCE).toContain('window: reportsWindow(filters, today),');
  });
});

describe('a bar pressed is the device filter', () => {
  it('marks the device the URL names, and dims the others', () => {
    const html = render(VIEW, '/it/vehicle-checks?device=dvr');
    expect(block(html, 'data-device-bar="dvr"', 'button')).toContain('aria-pressed="true"');
    const radio = block(html, 'data-device-bar="radio"', 'button');
    expect(radio).toContain('aria-pressed="false"');
    expect(radio).toContain('opacity-60');
  });

  it('wires a click to the rule that sets the device, or clears it when pressed again', () => {
    expect(SOURCE).toContain(
      'onDevice={(item) => patch({ device: toggleDevice(filters.device, item) })}',
    );
  });
});

describe('the matrix follows the car, «بها عطل» and the device', () => {
  it('by the car, its digits folded', () => {
    expect(matrixCodes(render(VIEW, '/it/vehicle-checks?car=١٥'))).toEqual(['v-150', 'v-152']);
  });

  it('by a car picked from a report, by its id', () => {
    expect(matrixCodes(render(VIEW, '/it/vehicle-checks?car=1&vehicle=v-1003'))).toEqual([
      'v-1003',
    ]);
  });

  it('by «بها عطل», and by one device «لا يعمل»', () => {
    expect(matrixCodes(render(VIEW, '/it/vehicle-checks?faults=true'))).toEqual([
      'v-150',
      'v-corolla',
    ]);
    expect(matrixCodes(render(VIEW, '/it/vehicle-checks?device=radio'))).toEqual(['v-corolla']);
  });

  it('says when nothing matches — and not that no car has a report', () => {
    const html = render(VIEW, '/it/vehicle-checks?car=999');
    expect(matrixCodes(html)).toEqual([]);
    expect(html).toContain(ar('it.vehicleChecks.matrix.empty'));
    expect(html).not.toContain(ar('it.vehicleChecks.matrix.none'));
  });
});

describe('the report’s side panel', () => {
  const html = renderReport(VIEW);

  it('names the car, its branch and day, who sent it, and the three counts', () => {
    const words = text(html);
    expect(words).toContain(ar('it.vehicleChecks.report.title', { code: 'كورولا 1' }));
    expect(words).toContain('أكتوبر');
    expect(words).toContain('شريف ممدوح فاروق');
    expect(words).toContain('٩ يعمل');
    expect(words).toContain('٢ لا يعمل');
    expect(words).toContain('٠ لم يُفحص');
  });

  it('lists the eleven devices, each with its answer', () => {
    expect(html.match(/data-report-device="/gu)).toHaveLength(11);
    expect(text(block(html, 'data-report-device="dvr"', 'li'))).toContain('DVR لا يعمل');
    expect(text(block(html, 'data-report-device="camera1"', 'li'))).toContain(
      'كاميرا ١ — أمام المركبة يعمل',
    );
    expect(text(block(html, 'data-report-device="camera7"', 'li'))).toContain(
      'كاميرا ٧ — داخل الخزينة ١ يعمل',
    );
  });

  it('shows the note, a box for each photo, and «كل تقارير هذه السيارة»', () => {
    expect(text(html)).toContain('الـ DVR لا يسجّل، وجهاز الاتصال بلا إرسال.');
    expect(html).toContain('data-report-photo="f-1"');
    expect(html).toContain('data-report-photo="f-2"');
    expect(html).toContain('data-car-reports="v-corolla"');
  });

  it('reads each photo through its route with the token, and lets its URL go on close', () => {
    expect(REPORT_SOURCE).toContain('fetchPhoto: api.fetchVehicleCheckPhoto');
    expect(REPORT_SOURCE).toContain('URL.createObjectURL(blob)');
    expect(REPORT_SOURCE).toContain('for (const url of made) URL.revokeObjectURL(url);');
  });

  it('confirms before it deletes, then the dashboard reads the subtree again', () => {
    expect(REPORT_SOURCE).toContain("title={t('it.vehicleChecks.report.deleteTitle')}");
    expect(REPORT_SOURCE).toContain('await remove.mutateAsync(id);');
  });

  // The hooks' half — what is read again, and that the global handler stays silent — is
  // `api/vehicle-check-delete.spec.tsx`; the rule of when to let go is the lib's.
  it('lets the deleted report’s read go once the panel has closed, and says a refusal once', () => {
    expect(REPORT_SOURCE).toContain('setDeletedId(id);');
    expect(REPORT_SOURCE).toContain(
      'if (deletedId === null || !forgetsDeletedReport(deletedId, reportId)) return;',
    );
    expect(REPORT_SOURCE).toContain('forget(deletedId);');
    expect(REPORT_SOURCE.match(/toast\.error\(/gu)).toHaveLength(1);
  });

  it('«كل تقارير هذه السيارة» hands the page the car by its id and its code', () => {
    expect(REPORT_SOURCE).toContain(
      'onCarReports({ vehicleId: data.vehicleId, vehicleCode: data.vehicleCode })',
    );
  });
});

describe('a dashboard read that failed', () => {
  it('says the figures could not be fetched, and offers to try again — never a 0', () => {
    const html = render(VIEW, '/it/vehicle-checks', { failed: true });
    expect(html).toContain(ar('it.overview.countUnavailable'));
    expect(html).toContain(ar('common.retry'));
    // The reports list rides its own read, and still stands.
    expect(html).toContain('data-report="r-corolla"');
  });
});
