// «توزيع المحصنات» and «تسليم المحصنات» (Round 12), rendered against the real Arabic catalog, a real
// store and query client — what reaches the screen; the rules are pinned in
// lib/secured-distribution.spec.ts, the wire in api/secured-distribution-wire.spec.ts.
//
//   · «هتبقى العربيات على اليمين والمحصنات على الشمال»: the vans are the FIRST column (the right, in
//     RTL), the shipments on no van the second;
//   · «هيكون فيها العربيه اللى اتحط عليها القادة والاخصائين والاتجاه»: each van's card says its number,
//     captains, specialists, direction and time, and what it carries;
//   · «او المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى»: on the day's first read, a shipment
//     whose area one van's direction names is on that van, marked «مقترحة» — and «حفظ» counts it;
//   · «نفس الشاشة هنعمل زيها للخزنة هيكون فوق كل عربيه تسليم وطباعه»: the vault's screen is the same
//     two columns, read-only, with «تسليم» and «طباعة» over each van — «تسليم» on TODAY's screen
//     only: a future day is the plan, to read and print.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
  type Locale,
  type MeDto,
  type OperationsCurrencyDto,
  type OperationsSecuredDistributionCrewDto,
  type OperationsSecuredDistributionDto,
  type OperationsSecuredDistributionRowDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { formatAmount, formatNumber } from '../../../shared/lib/format';
import { ApiError } from '../../../shared/lib/api-client';
import { HISTORY_TOO_LARGE, cairoToday } from '../lib/shipment-history';
import { __securedDistributionKey } from '../api/operations-queries';
import {
  CAPTAIN_FRAME,
  CHIP_LOOK,
  COLUMN_WARN,
  COUNT_LOOK,
  KEPT_NOTICE,
  LOAD_LOOK,
  VAN_CARD,
  VAN_LOOK,
  VAN_STATE_STRIPE,
} from '../components/distribution-look';
import { RecordNotice, dayText } from '../components/SecuredDistributionParts';
import { SecuredDistributionPage } from './SecuredDistributionPage';
import { VaultHandoverPage } from './VaultHandoverPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const TODAY = cairoToday();
const TOMORROW = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

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

const currency = (id: string, code: string, name: string, sortOrder: number) =>
  ({
    id,
    code,
    name,
    legacyAliases: [],
    sortOrder,
    isActive: true,
    version: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) satisfies OperationsCurrencyDto;
const CURRENCIES = [currency('egp', 'EGP', 'مصري', 0), currency('usd', 'USD', 'دولار', 1)];

const person = (employeeId: string, fullNameAr: string) => ({ employeeId, code: null, fullNameAr });

const van = (
  code: string,
  captains: ReturnType<typeof person>[],
  direction: string | null,
  over: Partial<OperationsSecuredDistributionCrewDto> = {},
): OperationsSecuredDistributionCrewDto => ({
  crewAssignmentId: `cr-${code}`,
  vehicleId: `v-${code}`,
  vehicleCode: code,
  drivers: [],
  captains,
  specialist1: [person(`s1-${code}`, `أخصائي أول ${code}`)],
  specialist2: [person(`s2-${code}`, `أخصائي ثان ${code}`)],
  direction,
  plannedTime: '08:30',
  // Round 25 — the screen lists the «محصنة» rows (a kept row of another type says so).
  securedType: true,
  shiftTypeName: 'محصنة',
  looseNumber: null,
  ...over,
});

const V101 = van('101', [person('c1', 'أحمد فتحي السيد')], 'المعادي - حلوان');
const V104 = van(
  '104',
  [person('c2', 'شادي محمد أحمد'), person('c3', 'كريم سمير علي')],
  'مدينة نصر',
);
const V112 = van('112', [person('c4', 'محمود حسن عبد الله')], 'الجيزة');
const V125 = van('125', [person('c6', 'هاني عادل منصور')], '6 أكتوبر - الجيزة');
const V130 = van('130', [], 'وسط البلد');
const VANS = [V101, V104, V112, V125, V130];

const shipment = (
  id: string,
  over: Partial<OperationsSecuredDistributionRowDto> = {},
): OperationsSecuredDistributionRowDto => ({
  id,
  shipmentType: 'secured',
  status: 'inVault',
  mainBankId: 'b-ahly',
  secondaryBankId: null,
  originBranchId: 'o',
  destinationBranchId: 'd',
  areaName: 'المعادي',
  lines: [
    { currencyId: 'egp', amount: 1_000_000 },
    { currencyId: 'usd', amount: 20_000 },
  ],
  collectionDate: `${TODAY}T00:00:00.000Z`,
  deliveryDate: `${TODAY}T00:00:00.000Z`,
  receiptNumber: 'R-1',
  vaultReceiptNumber: null,
  receiptImage: null,
  serialTracked: false,
  notes: null,
  receivedById: null,
  receivedAt: null,
  version: 6,
  createdAt: '2026-11-08T08:00:00.000Z',
  updatedAt: '2026-11-09T08:00:00.000Z',
  origin: { id: 'o', name: 'فرع المهندسين', code: 'O1', bankId: 'b-ahly', bankName: 'الأهلي' },
  destination: { id: 'd', name: 'فرع المعادي', code: 'D1', bankId: 'b-ahly', bankName: 'الأهلي' },
  crew: null,
  captainDeliveredAt: null,
  securedStage: 'inVault',
  pickedUpBy: 'captain',
  pickedUpAt: '2026-11-08T07:30:00.000Z',
  vaultReceivedAt: '2026-11-08T09:15:00.000Z',
  overdue: false,
  delivery: null,
  deliveryLegVersion: null,
  placedCrewAssignmentId: null,
  directionCrewAssignmentIds: [],
  ...over,
});

const leg = (
  vanId: string,
  captain: string,
  executionStatus: 'pending' | 'active' = 'pending',
) => ({
  crewAssignmentId: vanId,
  captainEmployeeId: captain,
  vehicleId: 'v',
  executionStatus,
});

/** Proposed onto 101 (its only direction match). */
const MAADI = shipment('s-maadi', { directionCrewAssignmentIds: ['cr-101'] });
/** «الجيزة»: two vans name it — left for the person. */
const GIZA = shipment('s-giza', {
  areaName: 'الجيزة',
  directionCrewAssignmentIds: ['cr-112', 'cr-125'],
});
/** No van's direction names it. */
const ABBASSIA = shipment('s-abbassia', { areaName: 'العباسية' });
/** Overdue in the vault, its leg still on yesterday's van — proposed onto 104, re-dated by the save. */
const LATE = shipment('s-late', {
  areaName: 'مدينة نصر',
  overdue: true,
  deliveryDate: '2026-01-01T00:00:00.000Z',
  delivery: leg('cr-old', 'c1'),
  deliveryLegVersion: 3,
  directionCrewAssignmentIds: ['cr-104'],
});
/** Still with its captain (a draft): on van 101 already, saved. */
const WITH_CAPTAIN = shipment('s-captain', {
  status: 'draft',
  securedStage: 'withCaptain',
  vaultReceivedAt: null,
  delivery: leg('cr-101', 'c1'),
  deliveryLegVersion: 0,
  placedCrewAssignmentId: 'cr-101',
});
/** On the two-captain van with its second captain, saved. */
const ON_104 = shipment('s-104', {
  areaName: 'مدينة نصر',
  delivery: leg('cr-104', 'c3'),
  deliveryLegVersion: 1,
  placedCrewAssignmentId: 'cr-104',
});
/** The captain has started it in the app: fixed. */
const STARTED = shipment('s-started', {
  areaName: 'الجيزة',
  delivery: leg('cr-112', 'c4', 'active'),
  deliveryLegVersion: 2,
  placedCrewAssignmentId: 'cr-112',
});
const ROWS = [LATE, MAADI, GIZA, ABBASSIA, WITH_CAPTAIN, ON_104, STARTED];

const answer = (
  over: Partial<OperationsSecuredDistributionDto> = {},
): OperationsSecuredDistributionDto => ({
  date: `${TODAY}T00:00:00.000Z`,
  today: `${TODAY}T00:00:00.000Z`,
  past: false,
  recordPackages: null,
  crewPlanVisible: true,
  crews: VANS,
  shipments: ROWS,
  ...over,
});

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: items.length, totalPages: 1 },
});

const DESK = ['operationsShipment.view', 'operationsShipment.edit', 'operationsCrew.view'];
const VAULT = ['operationsVault.view', 'operationsVault.dispatch'];

const storeFor = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
    },
  });

const render = ({
  path,
  permissions,
  data,
  refused = false,
  date = null,
  packaging = 'ready',
  updatedAt,
}: {
  path: '/operations/secured/distribution' | '/operations/vault/handover';
  permissions: string[];
  data: OperationsSecuredDistributionDto | null;
  /** The server refused the day as too large to show — with `data` kept from an earlier answer. */
  refused?: boolean;
  /** A day after today (`?date=`) — the read filed under its own key; null for today. */
  date?: string | null;
  /** The vault's packaging read: answered, still out, or failed. */
  packaging?: 'ready' | 'pending' | 'failed';
  /** R30 critic — when the read arrived (ms); now when not given. */
  updatedAt?: number;
}): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(
    listKey('operations', 'banks', {
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      sortBy: 'code',
      sortDir: 'asc',
    }),
    page([{ id: 'b-ahly', opsName: 'بنك الأهلي' }]),
  );
  qc.setQueryData(
    listKey('operations', 'currencies', { page: 1, pageSize: MAX_PAGE_SIZE }),
    page(CURRENCIES),
  );
  if (packaging === 'ready') {
    qc.setQueryData(
      listKey('operations', 'vault', { packaging: true }),
      new Map([['s-maadi', { bags: 4, cartons: 0, boxes: 1 }]]),
    );
  } else if (packaging === 'failed') {
    qc.setDefaultOptions({ queries: { ...qc.getDefaultOptions().queries, retryOnMount: false } });
    const query = qc
      .getQueryCache()
      .build(qc, { queryKey: [...listKey('operations', 'vault', { packaging: true })] });
    query.setState({
      ...query.state,
      status: 'error',
      error: new ApiError('INTERNAL', 'down', 500),
      errorUpdatedAt: 2,
      fetchStatus: 'idle',
    });
  }
  if (data !== null) {
    qc.setQueryData(
      __securedDistributionKey(date),
      data,
      updatedAt === undefined ? undefined : { updatedAt },
    );
  }
  if (refused) {
    qc.setDefaultOptions({ queries: { ...qc.getDefaultOptions().queries, retryOnMount: false } });
    const query = qc.getQueryCache().build(qc, { queryKey: [...__securedDistributionKey(null)] });
    query.setState({
      ...query.state,
      status: 'error',
      error: new ApiError(HISTORY_TOO_LARGE, 'too many', 422),
      errorUpdatedAt: 2,
      fetchStatus: 'idle',
    });
  }
  return renderToStaticMarkup(
    <Provider store={storeFor(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[date === null ? path : `${path}?date=${date}`]}>
          <Routes>
            <Route path="/operations/secured/distribution" element={<SecuredDistributionPage />} />
            <Route path="/operations/vault/handover" element={<VaultHandoverPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The markup of one van's card. */
const vanOf = (html: string, id: string): string => {
  const start = html.indexOf(`data-distribution-van="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  const next = html.indexOf('data-distribution-van="', start + 10);
  const column = html.indexOf('data-distribution-column="unplaced"', start);
  const handoverColumn = html.indexOf('data-handover-column="unplaced"', start);
  const ends = [next, column, handoverColumn].filter((at) => at > -1);
  return html.slice(start, ends.length === 0 ? undefined : Math.min(...ends));
};
/** The markup of the left column. */
const leftOf = (html: string): string => {
  const at = Math.max(
    html.indexOf('data-distribution-column="unplaced"'),
    html.indexOf('data-handover-column="unplaced"'),
  );
  expect(at).toBeGreaterThan(-1);
  return html.slice(at);
};
/** One shipment's card. */
const cardOf = (html: string, id: string): string => {
  const start = html.indexOf(`data-distribution-shipment="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  const next = html.indexOf('data-distribution-shipment="', start + 10);
  return html.slice(html.lastIndexOf('<div', start), next === -1 ? undefined : next);
};

/** The opening tag of the `tag` element carrying `attr` (Round 30). */
const openingTag = (html: string, attr: string, tag = 'input'): string => {
  const at = html.indexOf(attr);
  expect(at, attr).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf(`<${tag}`, at), html.indexOf('>', at));
};

describe('«توزيع المحصنات» — the desk', () => {
  const html = render({
    path: '/operations/secured/distribution',
    permissions: DESK,
    data: answer(),
  });

  it('puts the vans FIRST (the right, in RTL) and the shipments on no van second (the left)', () => {
    const vans = html.indexOf('data-distribution-column="vans"');
    const left = html.indexOf('data-distribution-column="unplaced"');
    expect(vans).toBeGreaterThan(-1);
    expect(left).toBeGreaterThan(vans);
    // Every van of the day, in the read's order.
    const at = VANS.map((v) => html.indexOf(`data-distribution-van="${v.crewAssignmentId}"`));
    expect(at.every((i) => i > -1 && i < left)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('says on each van its number, time and direction, then the count, then the FIRST captain in his own frame', () => {
    const v104 = vanOf(html, 'cr-104');
    expect(v104).toContain('data-van-code="104"');
    expect(v104).toContain('08:30');
    expect(v104).toContain('data-van-direction="مدينة نصر"');
    // Round 25 — «العربيه لو عليها اتنين قادة انا عاوز اللى يظهر اللى انا ضيفته ف الاول»: the first
    // captain on the row only, the count of محصنات before him («الصف نفسه بتاع القائد يكون قبله عدد
    // المحصنات»). Round 26b — «وافصل الاليطار بتاع القائد عن المحصنة»: each in a frame of its own.
    const crew = v104.slice(v104.indexOf('data-van-crew='));
    expect(crew).toMatch(/^data-van-crew="cr-104"[^>]*><span data-van-count="2"/);
    expect(crew.indexOf('data-van-count="2"')).toBeLessThan(crew.indexOf('data-van-captain="c2"'));
    const line = v104.slice(v104.indexOf('data-van-captain-line='));
    expect(line).toMatch(/^data-van-captain-line="cr-104"[^>]*><span data-van-captain="c2"/);
    expect(line.slice(0, line.indexOf('data-van-packages='))).not.toContain('data-van-count');
    expect(v104).toContain('شادي محمد أحمد');
    expect(v104).not.toContain('data-van-captain="c3"');
    expect(vanOf(html, 'cr-104').slice(0, v104.indexOf('data-van-load='))).not.toContain(
      'كريم سمير علي',
    );
    // «مش عاوز يظهر اخصائيين ولا اجمالى المصرى ولا اجمالى الدولار ولا اجمالى العملات».
    expect(v104).not.toContain('أخصائي أول 104');
    expect(v104).not.toContain('أخصائي ثان 104');
    expect(v104).not.toContain('data-van-slot');
    expect(v104).not.toContain('data-money=');
    // A van with no captain is listed, and says it takes nothing.
    expect(vanOf(html, 'cr-130')).toContain(ar('operations.distribution.noCaptain'));
  });

  it('proposes by direction on the first read: one match → on that van, marked «مقترحة»', () => {
    const v101 = vanOf(html, 'cr-101');
    expect(v101).toContain('data-distribution-shipment="s-maadi"');
    expect(cardOf(html, 's-maadi')).toContain('data-shipment-tone="proposed"');
    expect(cardOf(html, 's-maadi')).toContain(`>${ar('operations.distribution.proposed')}<`);
    // The overdue one, onto 104 — and the save will move its day to this one, said before the click.
    expect(vanOf(html, 'cr-104')).toContain('data-distribution-shipment="s-late"');
    expect(cardOf(html, 's-late')).toContain('data-mark="overdue"');
    expect(cardOf(html, 's-late')).toContain('data-mark="reschedule"');
  });

  it('leaves two matches and no match for the person, on the left', () => {
    const left = leftOf(html);
    expect(left).toContain('data-distribution-shipment="s-giza"');
    expect(left).toContain('data-distribution-shipment="s-abbassia"');
    expect(left).not.toContain('data-distribution-shipment="s-maadi"');
  });

  it('keeps the saved places — a shipment still with its captain on its van, with its stage', () => {
    expect(vanOf(html, 'cr-101')).toContain('data-distribution-shipment="s-captain"');
    expect(cardOf(html, 's-captain')).toContain('data-secured-stage="withCaptain"');
    expect(cardOf(html, 's-captain')).toContain('data-shipment-tone="saved"');
  });

  it('counts the proposals as changes: «حفظ» is on, with how many', () => {
    expect(html).toMatch(/data-distribution-save="2"/);
    const save = html.slice(
      html.indexOf('data-distribution-save="2"') - 300,
      html.indexOf('data-distribution-save="2"') + 600,
    );
    expect(save).not.toMatch(/disabled=""/);
    // R26 critic — a count on this screen in the figures' face, as the page's bar writes it.
    expect(html).toContain(ar('operations.distribution.save', { count: '2' }));
    expect(html).not.toContain(
      ar('operations.distribution.save', { count: formatNumber(2, 'ar') }),
    );
    expect(html).toContain(`data-proposed-count="2"`);
  });

  it('drags and moves what can move — «نقل إلى…» on each card; a started leg is held, and says why', () => {
    expect(cardOf(html, 's-giza')).toContain('draggable="true"');
    expect(cardOf(html, 's-giza')).toContain('data-move-open="s-giza"');
    const started = cardOf(html, 's-started');
    expect(started).toContain('draggable="false"');
    expect(started).not.toContain('data-move-open');
    expect(started).toContain(`${ar('operations.distribution.started')}<`);
  });

  it('on a two-captain van, a محصنة with the OTHER captain says so — the switch is in its «نقل إلى…»', () => {
    const chip = cardOf(html, 's-104');
    expect(chip).toContain('data-mark="captain"');
    expect(chip).toContain(ar('operations.distribution.withCaptain', { name: 'كريم سمير علي' }));
    expect(chip).toContain('data-move-open="s-104"');
    // The menu lists the van's captains first («مع …»), each a switch.
    expect(DIST).toContain('key: `captain|${captain.employeeId}`');
    expect(DIST).toContain('onSelect: () => switchCaptain(row, current, captain.employeeId)');
    // The first captain's محصنة carries no such mark.
    expect(cardOf(html, 's-captain')).not.toContain('data-mark="captain"');
  });

  it('counts each van’s load in its Arabic form; the packages are «—» to a reader who cannot read the vault', () => {
    const v101 = vanOf(html, 'cr-101');
    expect(v101).toContain(`data-van-count="2"`);
    // Round 17 — the count's own Arabic form: two are «محصنتان», never «2 محصنة».
    expect(v101).toContain(`>${ar('operations.distribution.loadCount.two')}<`);
    expect(ar('operations.distribution.loadCount.two')).toBe('محصنتان');
    expect(v101).not.toContain('2 محصنة');
    expect(v101).toContain('data-van-packages="unknown"');
  });

  // REWRITTEN in Round 30 — it was «opens on the day with no day before today» (`min` = today on
  // the day box). The owner: «عاوز هنا يقدر يجيب اليوم اللى قبله ك رؤيى بس ميقدرش يعدل عليه او يعمل
  // حاجه ك سجل يعنى» — the box has no floor now: a past day opens as its record (the suite below).
  it('opens on the day — with no floor: a past day can be picked, as its record — and the drag hint', () => {
    const box = openingTag(html, 'data-distribution-day="true"');
    expect(box).toContain(`value="${TODAY}"`);
    expect(box).not.toContain('min=');
    expect(html).toContain(ar('operations.distribution.dragHint'));
    // Today is no record: its acts are there, its notice is not.
    expect(html).toContain('data-distribution-acts="true"');
    expect(html).not.toContain('data-distribution-record');
    expect(html).not.toContain('data-distribution-today');
  });
});

describe('«توزيع المحصنات» — a reader who may not distribute', () => {
  const html = render({
    path: '/operations/secured/distribution',
    permissions: ['operationsShipment.view'],
    data: answer({
      crewPlanVisible: false,
      crews: VANS.map((v) => ({ ...v, specialist1: [], specialist2: [] })),
    }),
  });

  it('sees the plan as saved: no proposal, no drag, no menu, no save', () => {
    expect(html).not.toContain('data-shipment-tone="proposed"');
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain('data-move-open');
    expect(html).not.toContain('data-distribution-save');
    expect(html).not.toContain('data-distribution-auto');
    expect(html).toContain(ar('operations.distribution.viewOnly'));
    expect(leftOf(html)).toContain('data-distribution-shipment="s-maadi"');
  });

  it('draws no specialist slot without the crew plan’s grant (rather than an empty one)', () => {
    expect(vanOf(html, 'cr-101')).not.toContain(ar('operations.crew.slot.specialist1'));
  });
});

describe('«توزيع المحصنات» — the day’s edges', () => {
  it('says when no van is planned', () => {
    const html = render({
      path: '/operations/secured/distribution',
      permissions: DESK,
      data: answer({ crews: [] }),
    });
    expect(html).toContain(ar('operations.distribution.noVans'));
    // Critic — Round 25 lists only the SAVED «محصنة» rows: ten saved «يومي» vans are no «no vans
    // planned». The words say what is listed, and where a row becomes one.
    const words = ar('operations.distribution.noVans');
    expect(words).not.toContain('لا توجد سيارات مخططة');
    expect(words).toContain('«محصنة»');
    expect(words).toContain('محفوظة');
    expect(words).toContain('لوحة التشغيلة');
    expect(words).toContain('«حفظ»');
    const en = translate('en', 'operations.distribution.noVans');
    expect(en).not.toContain('No vans are planned');
    expect(en).toContain('«محصنة»');
    expect(en).toMatch(/saved/i);
    // The vault's screen reads the same list, and says the same.
    expect(
      render({
        path: '/operations/vault/handover',
        permissions: VAULT,
        data: answer({ crews: [] }),
      }),
    ).toContain(words);
  });

  it('says when nothing is due', () => {
    const html = render({
      path: '/operations/secured/distribution',
      permissions: DESK,
      data: answer({ shipments: [] }),
    });
    expect(html).toContain(ar('operations.distribution.empty'));
    expect(html).toMatch(
      /data-distribution-save="0"[^>]*disabled=""|disabled=""[^>]*data-distribution-save="0"/,
    );
  });
});

// ── Round 30 — «عاوز هنا يقدر يجيب اليوم اللى قبله ك رؤيى بس ميقدرش يعدل عليه او يعمل حاجه ك سجل يعنى» ──
describe('«توزيع المحصنات» — a PAST day is its record, read only (Round 30)', () => {
  const PATH_DIST = '/operations/secured/distribution' as const;
  const YESTERDAY = new Date(Date.parse(`${TODAY}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  // The read as the server answers a past day — with a direction id left on a row all the same, so
  // the screen is seen to propose NOTHING whatever reaches it.
  const recordOf = (over: Partial<OperationsSecuredDistributionDto> = {}) =>
    answer({ date: `${YESTERDAY}T00:00:00.000Z`, past: true, ...over });
  const html = render({ path: PATH_DIST, permissions: DESK, data: recordOf(), date: YESTERDAY });
  const WRITES = [
    'data-distribution-acts',
    'data-distribution-auto',
    'data-distribution-discard',
    'data-distribution-save',
    'data-proposed-count',
  ];

  it('opens the past day in «يوم التسليم» and says it is a record — view only, it cannot be changed', () => {
    expect(openingTag(html, 'data-distribution-day="true"')).toContain(`value="${YESTERDAY}"`);
    expect(html).toContain(`data-distribution-record="${YESTERDAY}"`);
    const title = ar('operations.distribution.record.title', {
      day: dayText(`${YESTERDAY}T00:00:00.000Z`),
    });
    expect(title).toContain('للعرض فقط، لا يمكن التعديل');
    expect(title).toContain(YESTERDAY);
    expect(html).toContain(title);
    expect(html).toContain(ar('operations.distribution.record.body'));
    expect(translate('en', 'operations.distribution.record.title', { day: YESTERDAY })).toContain(
      'view only',
    );
    // Not the hint of a day that can be distributed, nor the grant's words.
    expect(html).not.toContain(ar('operations.distribution.dragHint'));
    expect(html).not.toContain(ar('operations.distribution.viewOnly'));
  });

  it('offers no write — no «توزيع تلقائي», «تراجع» or «حفظ» — and the way back to today where they stood', () => {
    for (const write of WRITES) expect(html, write).not.toContain(write);
    expect(html).toContain('data-distribution-record-mark="true"');
    expect(html).toContain(ar('operations.distribution.record.mark'));
    const back = openingTag(html, 'data-distribution-today="true"', 'button');
    expect(back).toContain('type="button"');
    expect(back).toContain(
      `title="${ar('operations.distribution.record.todayHint', { day: dayText(`${TODAY}T00:00:00.000Z`) })}"`,
    );
    expect(html).toContain(`${ar('operations.distribution.record.today')}</button>`);
  });

  it('moves nothing — no drag, no «نقل إلى…» (the keyboard’s way and the phone’s), no proposal applied', () => {
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain('data-move-open');
    expect(html).not.toContain('data-shipment-tone="proposed"');
    expect(html).not.toContain('data-shipment-tone="moved"');
    expect(html).not.toContain('data-mark="reschedule"');
    // The one whose direction names van 101 stays where the record has it — on no van.
    expect(leftOf(html)).toContain('data-distribution-shipment="s-maadi"');
    expect(vanOf(html, 'cr-101')).not.toContain('data-distribution-shipment="s-maadi"');
    // No van invites a drop.
    expect(html).not.toContain(ar('operations.distribution.dropHere'));
    expect(html).not.toContain('data-drop-armed');
    expect(html).not.toContain(ar('operations.distribution.dropBack'));
  });

  it('shows the day as it is saved — the vans and their loads, the marks — and keeps the filters', () => {
    expect(vanOf(html, 'cr-101')).toContain('data-distribution-shipment="s-captain"');
    expect(vanOf(html, 'cr-104')).toContain('data-distribution-shipment="s-104"');
    expect(vanOf(html, 'cr-112')).toContain('data-distribution-shipment="s-started"');
    expect(cardOf(html, 's-late')).toContain('data-mark="overdue"');
    expect(cardOf(html, 's-started')).toContain('data-mark="started"');
    expect(cardOf(html, 's-104')).toContain('data-mark="captain"');
    // Every van of the day, with its direction; the figures read the record.
    for (const v of VANS) expect(html).toContain(`data-distribution-van="${v.crewAssignmentId}"`);
    expect(html).toContain('data-van-direction="مدينة نصر"');
    expect(html).toContain('data-figure="unplaced"');
    // Reading is not changing: both filter bars are there.
    expect(html).toContain('data-filter-bar="vans"');
    expect(html).toContain('data-filter-bar="unplaced"');
    // A van that would have said «اسحب المحصنات إلى هنا» says it holds nothing.
    const empty = render({
      path: PATH_DIST,
      permissions: DESK,
      data: recordOf({ shipments: [] }),
      date: YESTERDAY,
    });
    expect(vanOf(empty, 'cr-101')).toContain(ar('operations.distribution.emptyVan'));
  });

  it('counts a record’s packages from the read — what went out on a van still counts, not the vault’s holdings', () => {
    const vaultDesk = [...DESK, 'operationsVault.view'];
    const counted = render({
      path: PATH_DIST,
      permissions: vaultDesk,
      data: recordOf({
        recordPackages: [{ shipmentId: 's-captain', bags: 3, cartons: 1, boxes: 2 }],
      }),
      date: YESTERDAY,
    });
    // 101 carries «s-captain» on the record (handed over since, so the holdings know nothing of it):
    // its counts are the read's. The holdings' «s-maadi» (on no van) adds nothing to it.
    expect(vanOf(counted, 'cr-101')).toContain('data-van-packages="1/3/2"');
    // A reader without the vault's grant has no packages, record or not.
    expect(vanOf(html, 'cr-101')).toContain('data-van-packages="unknown"');
  });

  // REWRITTEN by the R30 critic — it judged the read left open past midnight by the read's `today`
  // against the PC's live day alone, so a read that arrived NOW with the server's `past: false` (a PC
  // clock running ahead) was drawn as a record too. Midnight passing is now the days the screen's own
  // clock saw go by since the read arrived (`isRecordScreen`): the stale read below arrived yesterday.
  it('is a record before the server has answered (the URL’s day), and on yesterday’s read left open past midnight', () => {
    const loading = render({ path: PATH_DIST, permissions: DESK, data: null, date: YESTERDAY });
    expect(loading).toContain(`data-distribution-record="${YESTERDAY}"`);
    for (const write of WRITES) expect(loading, write).not.toContain(write);
    // No `?date=`: the screen opened on "today", read YESTERDAY (before midnight) — the server then
    // said `past: false`. The live Cairo day has moved on since: those vans have left.
    const stale = render({
      path: PATH_DIST,
      permissions: DESK,
      data: answer({
        date: `${YESTERDAY}T00:00:00.000Z`,
        today: `${YESTERDAY}T00:00:00.000Z`,
        past: false,
      }),
      updatedAt: Date.parse(`${YESTERDAY}T12:00:00.000Z`),
    });
    expect(stale).toContain(`data-distribution-record="${YESTERDAY}"`);
    for (const write of WRITES) expect(stale, write).not.toContain(write);
    expect(stale).not.toContain('data-shipment-tone="proposed"');
    expect(stale).not.toContain('draggable="true"');
  });

  // R30 critic — `isRecord` let the PC's own clock override the server's `past: false`: a desk PC a
  // day ahead (or minutes ahead just before midnight) saw today's screen as a record and could not
  // distribute at all.
  it('R30 critic — trusts the server’s `past: false` over a PC clock that runs ahead: the desk still distributes', () => {
    // The server's today is what this PC calls yesterday; the read arrived just now.
    const ahead = render({
      path: PATH_DIST,
      permissions: DESK,
      data: answer({
        date: `${YESTERDAY}T00:00:00.000Z`,
        today: `${YESTERDAY}T00:00:00.000Z`,
        past: false,
      }),
    });
    expect(ahead).not.toContain('data-distribution-record=');
    expect(ahead).toContain('data-distribution-acts="true"');
    expect(ahead).toContain('data-distribution-save');
    expect(ahead).toContain('draggable="true"');
    expect(ahead).toContain(ar('operations.distribution.dragHint'));
  });

  it('is the same record for a reader without the edit grant — the notice and the way back', () => {
    const viewer = render({
      path: PATH_DIST,
      permissions: ['operationsShipment.view'],
      data: recordOf({ crewPlanVisible: false }),
      date: YESTERDAY,
    });
    expect(viewer).toContain(`data-distribution-record="${YESTERDAY}"`);
    expect(viewer).toContain('data-distribution-today="true"');
    expect(viewer).not.toContain(ar('operations.distribution.viewOnly'));
  });

  // REWRITTEN by the R30 critic — it pinned `isRecord` as the server's `past` OR the PC's clock
  // (`isRecordDay(day, today, minDay)`), «تراجع»'s gate as `!canEdit || lastMove === null`, and two
  // `if (!canEdit) return;` (the move and the captain switch). The record is now the server's word
  // plus midnight passing (`isRecordScreen`), «تراجع» and its keys ask `mayUndo` (the keys through
  // `distributionUndoKey`, driven in lib/secured-distribution.spec.ts), and the gate stands in the
  // draft's one writer too (`applyDraft`) and in «توزيع تلقائي».
  it('shuts every act through ONE gate — the drop, the menu, the captain switch, the proposals, «تراجع» and Ctrl+Z', () => {
    expect(DIST).toContain('const isRecord = isRecordScreen(');
    expect(DIST).toContain('const canEdit = mayEdit && !isRecord;');
    // A record draws what the server holds, never a draft.
    expect(DIST).toContain('const draft = isRecord ? EMPTY_DRAFT : history.now;');
    // «تراجع», its button and its keys (Ctrl+Z, ⌘Z) end at the gate.
    expect(DIST).toContain('const undoAllowed = mayUndo(canEdit, lastMove) && undoWords !== null;');
    expect(DIST).toContain('if (!undoAllowed) return;');
    expect(DIST).toContain('const onKey = distributionUndoKey({');
    expect(DIST).toContain('allowed: () => undoRef.current.allowed,');
    // The draft's one writer (a drop, the menu, a captain, «توزيع تلقائي»), the move, the captain
    // switched and «توزيع تلقائي» itself.
    expect(DIST.match(/^ {4}if \(!canEdit\) return;$/gm) ?? []).toHaveLength(4);
    expect(DIST.match(/setHistory\(\(current\) =>\n\s+record\(/g) ?? []).toHaveLength(1);
    // The screen takes no drop, and the first read proposes nothing.
    expect(DIST).toMatch(
      /'onDragOver' \| 'onDragEnter' \| 'onDragLeave' \| 'onDrop'\n {2}> = canEdit\n/,
    );
    expect(DIST).toContain('openingDistributionHistory(data.shipments, data.crews, canEdit)');
    // The day box has no floor here; the vault's keeps today's, and opens no past day.
    expect(DIST).toContain('readDistributionDay(sp.get(');
    expect(DIST).not.toContain('min={minDay}');
    expect(HANDOVER).toContain('min={minDay}');
    expect(HANDOVER).toContain("readDistributionDate(sp.get('date'), today)");
  });

  // R30 critic — the record still drew the alarms about PLACING: 130 (no captain) framed rose with
  // «بلا قائد — لا تأخذ محصنات», a kept row's amber «ليس من نوع محصنة», and the «بلا سيارة» head and
  // figure in the rose warning, though nothing can or should be done on a record.
  it('R30 critic — draws the record calmly: no placing alarm on a van, the column or the figure', () => {
    const KEPT = van('140', [person('c7', 'سامي رأفت')], 'الهرم', {
      securedType: false,
      shiftTypeName: 'يومية',
    });
    const ON_KEPT = shipment('s-kept', {
      areaName: 'الهرم',
      delivery: leg('cr-140', 'c7'),
      deliveryLegVersion: 0,
      placedCrewAssignmentId: 'cr-140',
    });
    const day = (data: OperationsSecuredDistributionDto, date: string | null) =>
      render({ path: PATH_DIST, permissions: DESK, data, date });
    const record = day(
      recordOf({ crews: [...VANS, KEPT], shipments: [...ROWS, ON_KEPT] }),
      YESTERDAY,
    );
    const today = day(answer({ crews: [...VANS, KEPT], shipments: [...ROWS, ON_KEPT] }), null);
    const tag = (html: string, id: string, attr: string, el: string) =>
      openingTag(vanOf(html, id), attr, el);

    // Today: 130 wears the owner's «بلا قائد» rose, its empty load refuses; 140 its kept amber.
    expect(openingTag(today, 'data-distribution-van="cr-130"', 'article')).toContain(
      VAN_CARD.noCaptain,
    );
    expect(vanOf(today, 'cr-130')).toContain(ar('operations.distribution.noCaptain'));
    expect(vanOf(today, 'cr-130')).toContain('data-empty-load="refuse"');
    expect(openingTag(today, 'data-distribution-van="cr-140"', 'article')).toContain(VAN_CARD.kept);

    // The record: the same vans, read back — the card's rest look, the van's own stripe…
    const card130 = openingTag(record, 'data-distribution-van="cr-130"', 'article');
    expect(card130).toContain(VAN_CARD.rest);
    expect(card130).not.toContain(VAN_CARD.noCaptain);
    expect(tag(record, 'cr-130', 'data-van-stripe="true"', 'span')).toContain(VAN_LOOK.stripe);
    expect(tag(record, 'cr-130', 'data-van-stripe="true"', 'span')).not.toContain(
      VAN_STATE_STRIPE.noCaptain,
    );
    // …«بلا قائد» still said, in the neutral frame…
    expect(tag(record, 'cr-130', 'data-van-captain-line="cr-130"', 'div')).toContain(
      CAPTAIN_FRAME.quiet,
    );
    expect(tag(record, 'cr-130', 'data-van-captain="none"', 'span')).toContain(
      CAPTAIN_FRAME.quietWords,
    );
    expect(vanOf(record, 'cr-130')).toContain(ar('operations.distribution.noCaptainShort'));
    // …and its empty load says it held nothing — not that it takes nothing.
    expect(vanOf(record, 'cr-130')).toContain('data-empty-load="empty"');
    expect(vanOf(record, 'cr-130')).toContain(ar('operations.distribution.emptyVan'));
    expect(vanOf(record, 'cr-130')).not.toContain(ar('operations.distribution.noCaptain'));
    expect(tag(record, 'cr-130', 'data-van-load="cr-130"', 'div')).not.toContain(LOAD_LOOK.refuse);
    // The kept row: its words stay (what the row was), read back in slate.
    const card140 = openingTag(record, 'data-distribution-van="cr-140"', 'article');
    expect(card140).toContain(VAN_CARD.rest);
    expect(card140).toContain(VAN_CARD.keptShape);
    expect(card140).not.toContain(VAN_CARD.kept);
    expect(tag(record, 'cr-140', 'data-van-not-secured=', 'p')).toContain(KEPT_NOTICE.quietStrip);
    expect(vanOf(record, 'cr-140')).toContain('data-distribution-shipment="s-kept"');
    // «بلا سيارة»: its head and the top figure count, calmly — the محصنات' own cyan.
    const left = leftOf(record);
    const head = left.slice(0, left.indexOf('</header>'));
    expect(head).toContain('data-column-icon="plain"');
    expect(head).not.toContain(COLUMN_WARN.count);
    const at = record.indexOf('data-figure="unplaced"');
    const pill = record.slice(
      record.lastIndexOf('<span', at),
      record.indexOf('data-figure="', at + 10),
    );
    expect(pill).toContain(COUNT_LOOK.shipments.square);
    expect(pill).not.toContain(COLUMN_WARN.figure);
  });

  // R30 critic — on a screen with no `?date=` that midnight turned into yesterday's record, picking
  // today in «يوم التسليم» changed neither the URL nor the read's key: nothing was read again.
  it('R30 critic — asks the read again when «يوم التسليم» leaves the URL as it is; «العودة إلى اليوم» is the same act', () => {
    expect(DIST).toContain(
      "const { date: asked, reread } = distributionDayChange(sp.get('date'), value, today);",
    );
    expect(DIST).toContain('if (reread) void board.refetch();');
    expect(DIST).toContain("const backToToday = (): void => setDay('');");
  });

  // R30 critic — moves left unsaved when midnight passed vanished without a word.
  it('R30 critic — says what became of work left unsaved when the day turned into a record', () => {
    const words = ar('operations.distribution.record.unsaved', { count: '٦' });
    expect(words).toContain('٦');
    expect(words).toContain('لا يمكن حفظها');
    expect(translate('en', 'operations.distribution.record.unsaved', { count: 6 })).toContain(
      'can no longer be saved',
    );
    const notice = (unsaved: string | null) =>
      renderToStaticMarkup(
        <RecordNotice title="t" body="b" unsaved={unsaved} data-distribution-record={YESTERDAY} />,
      );
    expect(notice(words)).toContain('data-record-unsaved="true"');
    expect(notice(words)).toContain(words);
    expect(notice(null)).not.toContain('data-record-unsaved');
    // The page counts it from the history behind the record (`unsavedOnRecord`), says it once as
    // it happens and on the notice while the record stands; a deep-linked record has none.
    expect(DIST).toContain('const lostOnRecord = unsavedOnRecord(isRecord, rows, history.now);');
    expect(DIST).toContain("t('operations.distribution.record.unsavedTitle')");
    expect(DIST).toContain('unsaved={');
    expect(html).not.toContain('data-record-unsaved');
  });
});

describe('«تسليم المحصنات» — the vault', () => {
  const saved = answer({
    shipments: [
      shipment('h-1', {
        delivery: leg('cr-101', 'c1'),
        deliveryLegVersion: 0,
        placedCrewAssignmentId: 'cr-101',
      }),
      WITH_CAPTAIN,
      ON_104,
      GIZA,
    ],
  });
  const html = render({ path: '/operations/vault/handover', permissions: VAULT, data: saved });

  it('is the same two columns — the vans on the right, the day’s unplaced on the left, for information', () => {
    expect(html.indexOf('data-handover-column="vans"')).toBeLessThan(
      html.indexOf('data-handover-column="unplaced"'),
    );
    expect(leftOf(html)).toContain('data-distribution-shipment="s-giza"');
    expect(html).toContain(ar('operations.handover.unplacedHint'));
  });

  it('moves nothing: no drag, no menu, no proposal, no save', () => {
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain('data-move-open');
    expect(html).not.toContain('data-captain-switch');
    expect(html).not.toContain('data-distribution-save');
    expect(html).not.toContain('data-shipment-tone="proposed"');
  });

  it('puts «تسليم» and «طباعة» over each van; «تسليم» counts only what the vault holds', () => {
    const v101 = vanOf(html, 'cr-101');
    expect(v101).toContain('data-handover-open="cr-101"');
    expect(v101).toContain('data-handover-print="cr-101"');
    // R26 critic — «تسليم (1)» over the van's «1 محصنة»: one numeral system on the card.
    expect(v101).toContain(ar('operations.handover.handover', { count: '1' }));
    // The one still with its captain is listed, marked, and said not to go.
    expect(cardOf(html, 's-captain')).toContain('data-mark="not-in-vault"');
    expect(v101).toContain('data-handover-held="1"');
  });

  it('turns «تسليم» off on a van with nothing in the vault', () => {
    const v112 = vanOf(html, 'cr-112');
    expect(v112).toMatch(
      /data-handover-open="cr-112"[^>]*disabled=""|disabled=""[^>]*data-handover-open="cr-112"/,
    );
    expect(v112).toContain('data-handover-print="cr-112"');
  });

  it('offers no «تسليم» to a reader without the dispatch grant — «طباعة» stays', () => {
    const viewer = render({
      path: '/operations/vault/handover',
      permissions: ['operationsVault.view'],
      data: saved,
    });
    expect(viewer).not.toContain('data-handover-open');
    expect(viewer).toContain('data-handover-print="cr-101"');
  });

  it('says a day too large to show instead of cutting it — never an earlier answer beside it', () => {
    for (const path of [
      '/operations/vault/handover',
      '/operations/secured/distribution',
    ] as const) {
      const refusal = render({
        path,
        permissions: [...VAULT, ...DESK],
        data: saved,
        refused: true,
      });
      expect(refusal).toContain(
        ar('operations.distribution.tooLarge', {
          max: formatAmount(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS, 'ar'),
        }),
      );
      expect(refusal).not.toContain('data-distribution-van=');
      expect(refusal).not.toContain('data-distribution-shipment=');
    }
  });
});

describe('«تسليم المحصنات» — «تسليم» on the day the van goes out, and on no other', () => {
  const placedOn = (day: string) =>
    answer({
      date: `${day}T00:00:00.000Z`,
      shipments: [
        shipment('h-1', {
          deliveryDate: `${day}T00:00:00.000Z`,
          delivery: leg('cr-101', 'c1'),
          deliveryLegVersion: 0,
          placedCrewAssignmentId: 'cr-101',
        }),
        { ...ON_104, deliveryDate: `${day}T00:00:00.000Z` },
      ],
    });
  /** One button's opening tag. */
  const tagOf = (html: string, attr: string): string => {
    const at = html.indexOf(attr);
    expect(at, attr).toBeGreaterThan(-1);
    return html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at));
  };

  it('today: «تسليم» is on where the vault holds the load, and the bar keeps its hint', () => {
    const html = render({
      path: '/operations/vault/handover',
      permissions: VAULT,
      data: placedOn(TODAY),
    });
    const open = tagOf(html, 'data-handover-open="cr-101"');
    expect(open).not.toContain('disabled=""');
    expect(open).not.toContain('data-handover-block');
    expect(html).toContain(ar('operations.handover.hint'));
    expect(html).not.toContain('data-handover-plan-day');
  });

  it('a future day: the plan is shown, every «تسليم» is off with why, «طباعة» stays on', () => {
    const html = render({
      path: '/operations/vault/handover',
      permissions: VAULT,
      data: placedOn(TOMORROW),
      date: TOMORROW,
    });
    // The plan: each van's saved load, as on today.
    expect(vanOf(html, 'cr-101')).toContain('data-distribution-shipment="h-1"');
    expect(vanOf(html, 'cr-104')).toContain('data-distribution-shipment="s-104"');
    for (const v of VANS) {
      const open = tagOf(html, `data-handover-open="${v.crewAssignmentId}"`);
      expect(open, v.crewAssignmentId).toContain('disabled=""');
      expect(open).toContain('data-handover-block="notToday"');
      expect(open).toContain(`title="${ar('operations.handover.notToday')}"`);
      const print = tagOf(html, `data-handover-print="${v.crewAssignmentId}"`);
      expect(print).not.toContain('disabled');
    }
    expect(ar('operations.handover.notToday')).toBe('التسليم يتم يوم خروج السيارة فقط');
    // Said once in the day bar, naming the day — in place of the today-only hint.
    expect(html).toContain(`data-handover-plan-day="${TOMORROW}"`);
    expect(html).toContain(ar('operations.handover.planDay', { day: `⁦${TOMORROW}⁩` }));
    expect(html).not.toContain(ar('operations.handover.hint'));
  });

  it('a future day with nothing in the vault on a van says the day, not «nothing» — the day comes first', () => {
    const html = render({
      path: '/operations/vault/handover',
      permissions: VAULT,
      data: placedOn(TOMORROW),
      date: TOMORROW,
    });
    const open = tagOf(html, 'data-handover-open="cr-112"');
    expect(open).toContain('data-handover-block="notToday"');
    expect(open).not.toContain(ar('operations.handover.nothing'));
  });

  it('yesterday’s read left open past Cairo midnight: «تسليم» is off, the load in the vault notwithstanding', () => {
    // No `?date=` — the screen opened on "today", read before midnight and not read again since.
    // The live Cairo day has moved on, so those vans have left: the day the read SHOWS is checked
    // against today, not the day the read was made on.
    const YESTERDAY = new Date(Date.parse(`${TODAY}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const html = render({
      path: '/operations/vault/handover',
      permissions: VAULT,
      data: { ...placedOn(YESTERDAY), today: `${YESTERDAY}T00:00:00.000Z` },
    });
    // cr-101's load is in the vault — on today's read its «تسليم» is on (the first case above).
    for (const v of VANS) {
      const open = tagOf(html, `data-handover-open="${v.crewAssignmentId}"`);
      expect(open, v.crewAssignmentId).toContain('disabled=""');
      expect(open).toContain('data-handover-block="notToday"');
    }
    expect(html).not.toContain(ar('operations.handover.hint'));
  });

  it('the confirmation names the day it hands over on', () => {
    const body = ar('operations.handover.confirmBody', {
      count: '1',
      van: 'السيارة 101',
      day: TODAY,
    });
    expect(body).toContain(TODAY);
    expect(translate('en', 'operations.handover.confirmBody', { day: TODAY })).toContain(TODAY);
  });
});

// ── Source pins — what each screen is built from ───────────────────────────────────────────────

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const DIST = read('./SecuredDistributionPage.tsx');
const HANDOVER = read('./VaultHandoverPage.tsx');
const PARTS = read('../components/SecuredDistributionParts.tsx');
const QUERIES = read('../api/operations-queries.ts');
const REGISTRY = read('../../../platform/realtime/invalidation-registry.ts');

describe('what the screens are built from', () => {
  it('the desk saves through ONE request built by the pure rule, and asks before leaving unsaved', () => {
    expect(DIST).toContain('distributionSaveBody(day, rows, draft)');
    expect(DIST).toContain('useSaveSecuredDistribution()');
    expect(DIST).toContain('useUnsavedGuard({ dirty })');
    expect(DIST).toContain('proposeByDirection(');
    // Never the one-shipment assign (the old dialog's) — a distribution is all or nothing.
    expect(DIST).not.toContain('useAssignSecuredDelivery');
    expect(DIST).not.toContain('useDispatchSecured');
  });

  // Round 24 — «تراجع» is off while «حفظ» is in flight: the save's success starts the history
  // afresh, so a press in that window would vanish unsaid and the move it named would be saved.
  // REWRITTEN by the R30 critic — the gate read `if (!canEdit || lastMove === null || undoWords ===
  // null) return;`; it is now ONE answer (`undoAllowed`, from `mayUndo`) that the button's act and
  // Ctrl+Z (`distributionUndoKey`) both ask — the same rule: no step while «حفظ» is in flight.
  it('takes nothing back while the save is in flight — the button, the press and Ctrl+Z alike', () => {
    expect(DIST).toContain('const lastMove = undoableStep(history, save.isPending);');
    expect(DIST).toContain('disabled={lastMove === null}');
    expect(DIST).toContain('const undoAllowed = mayUndo(canEdit, lastMove) && undoWords !== null;');
    expect(DIST).toContain('if (!undoAllowed) return;');
    expect(DIST).toContain('allowed: () => undoRef.current.allowed,');
  });

  // Round 17 — every count of محصنات on the two screens takes its own Arabic form («محصنة واحدة ·
  // محصنتان · 4 محصنات · 11 محصنة»), through the one helper that joins a key and its form.
  it('counts the محصنات in their Arabic forms on both screens', () => {
    for (const key of ['autoDone', 'saved', 'savedRescheduled']) {
      expect(DIST).toContain(`pluralKey('operations.distribution.${key}', locale,`);
    }
    for (const key of ['done', 'heldNote', 'confirm']) {
      expect(HANDOVER).toContain(`pluralKey('operations.handover.${key}', locale,`);
    }
    expect(PARTS).toContain("pluralKey('operations.distribution.loadCount', locale, count)");
  });

  it('the vault hands over through the existing dispatch with the van’s in-vault shipments only', () => {
    expect(HANDOVER).toContain('handoverRequest(rows, van.crewAssignmentId)');
    // Today only — the button by the pure rule, the dialog's save and the act itself by the day.
    expect(HANDOVER).toContain('handoverBlock(day, today, ready.length)');
    expect(HANDOVER).toContain('const handoverToday = day === today;');
    expect(HANDOVER).toContain('if (body === null || !handoverToday || sending.current) return;');
    expect(HANDOVER).toContain('disabled={confirmLoad.length === 0 || !handoverToday}');
    expect(HANDOVER).toContain('day: dayText(day),');
    expect(HANDOVER).toContain('useDispatchSecured()');
    expect(HANDOVER).toContain('printFleetReport(');
    expect(HANDOVER).not.toContain('useSaveSecuredDistribution');
    expect(HANDOVER).not.toContain('MoveMenu');
    expect(HANDOVER).not.toContain('draggable');
    // A vault-only reader hears no placement: the read re-reads itself for them.
    expect(HANDOVER).toContain(
      "useOperationsSecuredDistribution(date, true, !can('operationsShipment.view'))",
    );
  });

  it('both read the distribution under the day board’s key, so every secured act refreshes them', () => {
    expect(__securedDistributionKey('2026-11-14')).toEqual([
      'operations',
      'dayBoard',
      'securedDistribution',
      { date: '2026-11-14' },
    ]);
    expect(__securedDistributionKey(null)).toEqual([
      'operations',
      'dayBoard',
      'securedDistribution',
      { date: 'today' },
    ]);
    // The save runs the secured acts' invalidation (boards, «محصنات الخزينة», the vault, the logs).
    const save = QUERIES.slice(QUERIES.indexOf('export const useSaveSecuredDistribution'));
    expect(save.slice(0, save.indexOf('});'))).toContain('useSecuredInvalidation()');
    // The vault custody topic — all a vault-only treasurer hears — sweeps it too.
    const custody = REGISTRY.slice(REGISTRY.indexOf("'operations.vaultCustody'"));
    expect(custody.slice(0, custody.indexOf('\n  ],'))).toContain(
      "['operations', 'dayBoard', 'securedDistribution']",
    );
  });
});

// Round 24c — the owner on the round-24 screen: «عاوز اصغر المكان اللى فيه المحصنات واكبر المكان اللى فيه
// المحصنة بالعربيه … عاوز انقل الاتجاه بعد كود السيارة والوقت واحسن الاسماء بتاعت القادة والاخصائيين».
describe('Round 24c — the widths, and the van card', () => {
  const LOOSE = van('loose', [person('c9', 'مصطفى إبراهيم حسين')], 'حلوان', {
    crewAssignmentId: 'cr-loose-1',
    vehicleId: null,
    vehicleCode: null,
    specialist1: [],
    specialist2: [person('s9', 'حسام الدين علي')],
    plannedTime: '11:00',
  });
  const desk = render({
    path: '/operations/secured/distribution',
    permissions: DESK,
    data: answer({ crews: [...VANS, LOOSE] }),
  });
  const vault = render({
    path: '/operations/vault/handover',
    permissions: [...VAULT, 'operationsCrew.view'],
    data: answer({ crews: [...VANS, LOOSE] }),
  });

  it('gives the vans three quarters of a wide screen and the shipments on no van one', () => {
    for (const html of [desk, vault]) {
      expect(html).toContain('lg:grid-cols-[minmax(0,3fr)_minmax(17rem,1fr)]');
      // As many van cards to a row as fit — not two at most; R26 critic: four at the most.
      expect(html).toContain(
        'grid-cols-[repeat(auto-fill,minmax(min(100%,max(17.5rem,calc((100%_-_2.25rem)/4))),1fr))]',
      );
      expect(html).not.toContain('xl:grid-cols-2');
    }
  });

  it('puts code · time · direction on ONE line, the count in the counts’ row — no band of its own for the direction', () => {
    const card = vanOf(desk, 'cr-101');
    const head = card.slice(card.indexOf('data-van-head="true"'), card.indexOf('</header>'));
    const code = head.indexOf('data-van-code="101"');
    const time = head.indexOf('data-van-time="08:30"');
    const direction = head.indexOf('data-van-direction="المعادي - حلوان"');
    expect(code).toBeGreaterThan(-1);
    expect(time).toBeGreaterThan(code);
    expect(direction).toBeGreaterThan(time);
    // The whole direction on hover; the line cuts it.
    expect(head).toContain(`title="${ar('operations.crew.direction')}: المعادي - حلوان"`);
    expect(head).toMatch(/class="min-w-0 truncate">المعادي - حلوان</);
    // The count is not in the head — it opens the captain's row (Round 25), in its own frame.
    expect(head).not.toContain('data-van-count');
    expect(card).toMatch(/data-van-crew="cr-101"[^>]*><span data-van-count="2"/);
  });

  it('marks the captain on his line, after the count; no specialist slot at all (Round 25)', () => {
    const loose = vanOf(desk, 'cr-loose-1');
    expect(loose).toContain('data-no-van="true"');
    expect(loose).toContain(ar('operations.crewPlan.looseRow', { n: formatNumber(1, 'ar') }));
    expect(loose).toMatch(
      /data-van-head="true"[\s\S]*data-van-time="11:00"[\s\S]*data-van-direction="حلوان"/,
    );
    expect(loose).toMatch(
      new RegExp(
        `data-van-captain="c9"[\\s\\S]*data-captain-mark="true"[\\s\\S]*${ar('operations.crewPlan.role.captain')}[\\s\\S]*مصطفى إبراهيم حسين`,
      ),
    );
    expect(loose).not.toContain('data-van-slot');
    expect(loose).not.toContain('حسام الدين علي');
  });

  it('cuts the captain’s name to his line and opens the person card on it — a keyboard reaches it too', () => {
    const card = vanOf(desk, 'cr-104');
    expect(card).toMatch(
      new RegExp(`data-van-person="c2" class="min-w-0 truncate[^"]*" tabindex="0"`),
    );
    for (const id of ['c3', 's1-104', 's2-104'])
      expect(card).not.toContain(`data-van-person="${id}"`);
    expect(PARTS).toContain('<PlanMemberCardBody');
    expect(PARTS).toContain('useOperationsCrewDirectory(day, mayReadDirectory)');
  });

  it('says «بلا قائد» where the captain would be, in red', () => {
    const card = vanOf(desk, 'cr-130');
    expect(card).toMatch(
      new RegExp(`data-van-captain="none"[\\s\\S]*${ar('operations.distribution.noCaptain')}`),
    );
  });

  it('is the same card on «تسليم المحصنات», under «تسليم» and «طباعة»', () => {
    const card = vanOf(vault, 'cr-loose-1');
    expect(card).toContain('data-handover-print="cr-loose-1"');
    expect(card.indexOf('data-handover-print')).toBeLessThan(card.indexOf('data-van-head="true"'));
    expect(card).toContain('data-van-captain="c9"');
    expect(card).toMatch(/data-van-crew="cr-loose-1"[^>]*><span data-van-count="0"/);
    expect(card).toContain('data-van-packages="0/0/0"');
    expect(card).not.toContain('data-van-slot');
  });

  it('on a phone puts the shipments on no van FIRST on the desk, in a column that folds', () => {
    expect(DIST).toContain('const wide = useMinWidth(1024);');
    expect(DIST).toMatch(
      /wide \? \(\s*<>\s*\{vansColumn\}\s*\{unplacedColumn\}\s*<\/>\s*\) : \(\s*<>\s*\{unplacedColumn\}\s*\{vansColumn\}/,
    );
    expect(DIST).toContain(
      'collapse: { open: unplacedOpen, onToggle: () => setUnplacedOpen((v) => !v) }',
    );
    expect(HANDOVER).toContain(
      'collapse: { open: unplacedOpen, onToggle: () => setUnplacedOpen((v) => !v) }',
    );
    // Folded, the column still takes a drop — on its head: the whole section is the left column's
    // mark, which the screen's own drop reads under the pointer (Round 25).
    expect(DIST).toContain('data-drop-unplaced="true"');
    expect(DIST).toContain("unplaced: element.closest('[data-drop-unplaced]') !== null");
    expect(PARTS).toContain('aria-expanded={open}');
  });
});

// Round 25 — the owner on «توزيع المحصنات»: «انا عاوز اللى يظهر اللى نوعها محصنة بس ولازم اكون دايس
// حفظ», «لما بعمل دراج و دروب لل محصنة على العربيه مش بتتحط», the two filter bars, the small chip and
// its card, and «شكل العربية بالمحصنات يتغير».
describe('Round 25 — the screen', () => {
  /** A «سفر» row kept for the محصنة already on it — listed, marked, offered nothing new. */
  const KEPT = van('106', [person('c7', 'حسام الدين رمضان')], 'الزمالك', {
    securedType: false,
    shiftTypeName: 'سفر',
  });
  const ON_KEPT = shipment('s-kept', {
    areaName: 'الزمالك',
    delivery: leg('cr-106', 'c7'),
    deliveryLegVersion: 0,
    placedCrewAssignmentId: 'cr-106',
  });
  const desk = render({
    path: '/operations/secured/distribution',
    permissions: [...DESK, 'operationsVault.view'],
    data: answer({ crews: [...VANS, KEPT], shipments: [...ROWS, ON_KEPT] }),
  });

  it('marks a row that is not «محصنة», with its type — and offers it nothing new', () => {
    const kept = vanOf(desk, 'cr-106');
    expect(kept).toContain('data-not-secured="true"');
    expect(kept).toContain('data-van-not-secured="سفر"');
    expect(kept).toContain(ar('operations.distribution.notSecured'));
    expect(ar('operations.distribution.notSecured')).toBe('ليس من نوع محصنة');
    expect(kept).toContain(ar('operations.distribution.typeIs', { type: 'سفر' }));
    // What it already carries stays on it.
    expect(kept).toContain('data-distribution-shipment="s-kept"');
    // A «محصنة» row is not marked.
    expect(vanOf(desk, 'cr-101')).not.toContain('data-not-secured');
  });

  it('draws each محصنة as a small chip — the bank · the branch, its stage, «نقل إلى…» as an icon', () => {
    const chip = cardOf(desk, 's-giza');
    expect(chip).toMatch(/data-chip-text="true"[^>]*><span[^>]*>بنك الأهلي<\/span>/);
    expect(chip).toContain('data-chip-branch="true"');
    expect(chip).toContain('فرع المعادي');
    expect(chip).toContain('data-secured-stage="inVault"');
    // No money, no area pill, no from → to on the chip itself: its card says them.
    expect(chip).not.toContain('data-money=');
    expect(chip).not.toContain('data-shipment-area');
    expect(chip).toMatch(
      new RegExp(
        `data-move-open="s-giza"[^>]*aria-label="${ar('operations.distribution.moveTo')}"`,
      ),
    );
    // The card opens on hover and on a keyboard focus (a tab stop), and on a tap on a phone.
    expect(chip).toMatch(
      /data-distribution-shipment="s-giza"[^>]*tabindex="0"|tabindex="0"[^>]*data-distribution-shipment="s-giza"/,
    );
    expect(PARTS).toContain('mark="secured-shipment"');
    expect(PARTS).toContain("if (pointer.current !== 'touch') return;");
    // The same chip on a van.
    const onVan = cardOf(desk, 's-captain');
    expect(onVan).toContain('data-chip-text="true"');
  });

  it('writes the three package counts on every van, 0 included — the vault’s own counts', () => {
    // 101: «المعادي» (4 bags, 1 box, proposed) + the one with its captain (not counted yet).
    expect(vanOf(desk, 'cr-101')).toContain('data-van-packages="0/4/1"');
    // An empty van: «0» three times, never left out.
    const empty = vanOf(desk, 'cr-130');
    expect(empty).toContain('data-van-packages="0/0/0"');
    for (const kind of ['cartons', 'bags', 'boxes']) {
      expect(empty).toContain(`data-van-package="${kind}"`);
      expect(empty).toContain(ar(`operations.distribution.${kind}`));
    }
    // A «0» in the figures' face — an Arabic zero would read as a dot.
    expect(empty).toMatch(/data-van-package="cartons"[\s\S]*>0<[\s\S]*data-van-package="bags"/);
  });

  it('puts a filter bar on top of each column — bank or branch and area on the left; code, bank or branch and area on the right', () => {
    const left = leftOf(desk);
    const bar = left.slice(left.indexOf('data-filter-bar="unplaced"'));
    expect(bar).toContain('data-filter="unplaced-search"');
    expect(bar).toContain('data-filter="unplaced-area"');
    // Round 26 — beside the title in a quarter of the screen: the box says less, its name stays whole
    // for a screen reader and on hover.
    expect(bar).toContain(`aria-label="${ar('operations.distribution.filter.search')}"`);
    expect(bar).toContain(`placeholder="${ar('operations.distribution.filter.searchShort')}"`);
    expect(bar).toContain(`>${ar('operations.distribution.filter.allAreasShort')}<`);
    // The areas of the محصنات on the left: «الجيزة» and «العباسية».
    expect(bar).toMatch(/<option value="[^"]+">الجيزة<\/option>/);
    expect(bar).toMatch(/<option value="[^"]+">العباسية<\/option>/);
    const vans = desk.slice(desk.indexOf('data-filter-bar="vans"'));
    expect(vans).toContain('data-filter="van-code"');
    expect(vans).toContain('data-filter="van-search"');
    expect(vans).toContain('data-filter="van-area"');
    expect(vans).toContain(`placeholder="${ar('operations.distribution.filter.vanCode')}"`);
    expect(vans).toContain(`>${ar('operations.distribution.filter.allAreas')}<`);
    // Before anything is typed, nothing is hidden and nothing offers to clear.
    expect(desk).not.toContain('data-filter-clear');
    // The vans' filter bar sits above the vans, under the column's head.
    expect(desk.indexOf('data-filter-bar="vans"')).toBeLessThan(
      desk.indexOf('data-distribution-van="cr-101"'),
    );
  });

  it('takes the drop the crew board’s way — the dragged id in a ref, the whole screen a target, nothing drawn in dragstart', () => {
    expect(DIST).toContain('beginShipmentDrag(event.dataTransfer, shipmentId);');
    expect(DIST).toContain('dragRef.current = shipmentId;');
    const start = DIST.slice(DIST.indexOf('const startDrag ='), DIST.indexOf('const drawDrag ='));
    expect(start).not.toContain('setDragging');
    expect(start).not.toContain('setOver');
    expect(DIST).toContain(
      '<div className={BOARD_FRAME} data-distribution-page="true" {...screenDrop}>',
    );
    expect(DIST).toContain('if (!acceptsShipmentDragOver(shipmentId)) return;');
    expect(DIST).toContain('decide(shipmentId, targetAt(event.target))');
    // No dropEffect named; the browser's types never asked.
    expect(DIST).not.toContain('dropEffect');
    expect(DIST).not.toContain('carriesShipment');
    expect(PARTS).not.toContain('dataTransfer.types');
    // Every part of a van card is that van.
    expect(vanOf(desk, 'cr-101')).toContain('data-drop-van="cr-101"');
  });

  it('names a crew without a van by the BOARD’s number (`looseNumber`), not by its place among the «محصنة» rows', () => {
    const html = render({
      path: '/operations/secured/distribution',
      permissions: DESK,
      data: answer({
        crews: [
          ...VANS,
          van('loose', [person('c9', 'مصطفى إبراهيم حسين')], 'حلوان', {
            crewAssignmentId: 'cr-loose-3',
            vehicleId: null,
            vehicleCode: null,
            looseNumber: 3,
          }),
        ],
      }),
    });
    expect(vanOf(html, 'cr-loose-3')).toContain(
      ar('operations.crewPlan.looseRow', { n: formatNumber(3, 'ar') }),
    );
  });

  // Critic — the vault's read still out, or failed: every van read «0/0/0» and a counted load
  // looked empty. The owner asked for the 0 written «حتى لو ب 0 يتكتب», so a guessed 0 reads as a real one.
  for (const [where, permissions] of [
    ['/operations/secured/distribution', [...DESK, 'operationsVault.view']],
    ['/operations/vault/handover', VAULT],
  ] as const) {
    it(`[${where}] writes no 0 before the vault’s counts are in — «…» while the read is out, «—» when it failed`, () => {
      const data = answer({
        shipments: [
          shipment('s-maadi', {
            delivery: leg('cr-101', 'c1'),
            deliveryLegVersion: 0,
            placedCrewAssignmentId: 'cr-101',
          }),
        ],
      });
      const pending = render({
        path: where,
        permissions: [...permissions],
        data,
        packaging: 'pending',
      });
      for (const id of ['cr-101', 'cr-130']) {
        const card = vanOf(pending, id);
        expect(card).toContain('data-van-packages="pending"');
        expect(card).not.toContain('data-van-packages="0/0/0"');
        expect(card).toContain(`title="${ar('operations.distribution.packagesPending')}"`);
        expect(card).toContain('aria-busy="true"');
      }
      const failed = render({
        path: where,
        permissions: [...permissions],
        data,
        packaging: 'failed',
      });
      for (const id of ['cr-101', 'cr-130']) {
        const card = vanOf(failed, id);
        expect(card).toContain('data-van-packages="failed"');
        expect(card).not.toContain('data-van-packages="0/0/0"');
        expect(card).toContain(`title="${ar('operations.distribution.packagesFailed')}"`);
      }
      // Once the counts are in: the load's sum, and a 0 on the empty van is a real 0.
      const ready = render({ path: where, permissions: [...permissions], data });
      expect(vanOf(ready, 'cr-101')).toContain('data-van-packages="0/4/1"');
      expect(vanOf(ready, 'cr-130')).toContain('data-van-packages="0/0/0"');
    });
  }

  // Critic — a محصنة saved on a kept row and moved off it in the draft could not be put back.
  it('a kept row takes back the محصنة saved on it — the drop and «نقل إلى…» alike', () => {
    expect(DIST).toMatch(
      /isStartedLeg\(row\),\s*\/\/[^\n]*\n\s*row\.placedCrewAssignmentId,\s*\);/,
    );
    expect(DIST).toContain('takesShipments(van, row.placedCrewAssignmentId)');
  });

  it('a board save reads this screen again — a row saved as «محصنة» shows, and only then', () => {
    const plan = QUERIES.slice(QUERIES.indexOf('export const usePlanOperationsCrew'));
    expect(plan.slice(0, plan.indexOf('\n});'))).toContain(
      'await qc.invalidateQueries({ queryKey: securedDistributionPrefix });',
    );
    expect(QUERIES).toMatch(
      /const securedDistributionPrefix: readonly unknown\[\] = \[\s*\.\.\.featureKey\(MODULE, 'dayBoard'\),\s*'securedDistribution',\s*\]/,
    );
  });
});

// Round 26 — the owner: «عاوز الفلاتر دول يكونوا جمبب السيارات و بلا سيارات», «لما اقف على العربية يطلع
// كارت بقى بالقادة والاخصائيين اللى على العربيه والسواقيين», «عاوزك تضيف الوان عشان حاسس ان مش اقدر اميز
// اوى العربيه والمحصنات اللى عليها والاعداد وكدا».
describe('Round 26 — the screens', () => {
  const desk = render({
    path: '/operations/secured/distribution',
    permissions: [...DESK, 'operationsVault.view'],
    data: answer(),
  });
  const vault = render({
    path: '/operations/vault/handover',
    permissions: [...VAULT, 'operationsCrew.view'],
    data: answer(),
  });

  it('puts each column’s filter boxes on its title’s line — inside its head', () => {
    for (const column of ['vans', 'unplaced']) {
      const at = desk.indexOf(`data-distribution-column="${column}"`);
      const head = desk.slice(at, desk.indexOf('</header>', at));
      expect(head, column).toContain(`data-filter-bar="${column}"`);
      expect(head.indexOf('data-column-title="true"')).toBeLessThan(
        head.indexOf('data-filter-bar'),
      );
    }
    // The left column takes a drop on its head still: the head is inside its mark.
    const left = desk.slice(desk.indexOf('data-distribution-column="unplaced"') - 300);
    expect(left).toMatch(
      /<section[^>]*data-distribution-column="unplaced"[^>]*data-drop-unplaced="true"/,
    );
  });

  it('Round 26b — «لون واحد لكل العربيات»: every van the same look on both screens, no colour of its own', () => {
    // Round 26 painted each van by its place in the day's list; the owner: «لا استنى الالوان مش
    // عجبانى بتاعت العربيه». Every card now wears the same stripe, band and code pill.
    const classes = (html: string, id: string, mark: string): string =>
      new RegExp(`${mark}[^>]*? class="([^"]*)"`).exec(vanOf(html, id))?.[1] ?? '';
    const looks = [desk, vault].flatMap((html) =>
      VANS.map((van) =>
        [
          classes(html, van.crewAssignmentId, 'data-van-band="true"'),
          classes(html, van.crewAssignmentId, `data-van-code="${van.vehicleCode}"`),
        ].join(' | '),
      ),
    );
    expect(new Set(looks).size).toBe(1);
    expect(looks[0]).toContain(VAN_LOOK.pill);
    for (const html of [desk, vault]) expect(html).not.toContain('data-van-accent');
    // Round 27 — the van's blue stripe on every van with a captain; 130 has none: the design's rose
    // edge, its stripe rose — on both screens.
    for (const html of [desk, vault]) {
      for (const van of VANS) {
        const none = van.captains.length === 0;
        expect(
          classes(html, van.crewAssignmentId, 'data-van-stripe="true"'),
          van.vehicleCode ?? '',
        ).toContain(none ? VAN_STATE_STRIPE.noCaptain : VAN_LOOK.stripe);
        expect(
          classes(html, van.crewAssignmentId, `data-distribution-van="${van.crewAssignmentId}"`),
          van.vehicleCode ?? '',
        ).toContain(none ? VAN_CARD.noCaptain : VAN_CARD.rest);
      }
    }
  });

  it('paints no chip in a van’s colour — on a van as on the left, a chip is plain', () => {
    for (const id of ['s-maadi', 's-captain', 's-104', 's-giza', 's-abbassia']) {
      expect(cardOf(desk, id), id).not.toContain('data-chip-accent');
      expect(cardOf(desk, id), id).not.toContain('data-chip-stripe');
    }
    expect(cardOf(vault, 's-captain')).not.toContain('data-chip-accent');
    // The saved one on 101 is the design's quiet row with its cyan dot; the proposal keeps its
    // dashed amber (Round 27d: a lighter amber-400, was amber-500).
    expect(cardOf(desk, 's-captain')).toContain(CHIP_LOOK.van);
    expect(cardOf(desk, 's-captain')).toContain('data-chip-dot="van"');
    expect(cardOf(desk, 's-maadi')).toContain('border-dashed border-amber-400');
  });

  it('Round 27 — a محصنة on no van: the design’s waiting row, on both screens; its column’s head rose', () => {
    for (const html of [desk, vault]) {
      const left = leftOf(html);
      const chips = left.match(/data-shipment-tone="saved"[^>]*class="[^"]*"/g) ?? [];
      expect(chips.length).toBeGreaterThan(0);
      for (const one of chips) expect(one).toContain(CHIP_LOOK.unplaced);
      expect(left).toContain('data-chip-dot="unplaced"');
      // Its head: the rose warning icon and the rose count — work still to do.
      const head = left.slice(0, left.indexOf('</header>'));
      expect(head).toContain('data-column-icon="warn"');
      expect(head).toContain(COLUMN_WARN.count);
    }
    // No chip on a van wears it.
    for (const id of ['s-captain', 's-104']) {
      expect(cardOf(desk, id), id).not.toContain(CHIP_LOOK.unplaced);
    }
    // The vans' column keeps its calm head.
    const vansHead = desk.slice(
      desk.indexOf('data-distribution-column="vans"'),
      desk.indexOf('</header>', desk.indexOf('data-distribution-column="vans"')),
    );
    expect(vansHead).toContain('data-column-icon="plain"');
    expect(vansHead).not.toContain(COLUMN_WARN.count);
  });

  it('R27 critic — a محصنة placed on a crew the read no longer lists wears the waiting row too, on both screens', () => {
    // `distributionColumns` puts a row whose place names a van the read no longer lists (re-planned
    // meanwhile) in the left column, so it never disappears: the chip's look follows the column it
    // is drawn in, not its place — the desk drew it as a row on a van (a solid edge, a cyan dot).
    const GONE = shipment('s-gone', {
      areaName: 'العباسية',
      delivery: leg('cr-gone', 'c9'),
      deliveryLegVersion: 4,
      placedCrewAssignmentId: 'cr-gone',
    });
    const data = answer({ shipments: [...ROWS, GONE] });
    for (const html of [
      render({ path: '/operations/secured/distribution', permissions: DESK, data }),
      render({ path: '/operations/vault/handover', permissions: VAULT, data }),
    ]) {
      expect(leftOf(html)).toContain('data-distribution-shipment="s-gone"');
      const chip = cardOf(html, 's-gone');
      expect(chip).toContain(CHIP_LOOK.unplaced);
      expect(chip).toContain('data-chip-dot="unplaced"');
      expect(chip).not.toContain('data-chip-dot="van"');
    }
  });

  it('R27 critic — the top «بلا سيارة» figure wears its column head’s rose while any wait; the محصنات’ cyan when none', () => {
    // One number, one colour: the column's head counts the waiting محصنات in a rose pill beside a
    // rose warning — the page's bar wrote the same number on the محصنات' cyan.
    const pill = (html: string): string => {
      const at = html.indexOf('data-figure="unplaced"');
      expect(at).toBeGreaterThan(-1);
      const next = html.indexOf('data-figure="', at + 10);
      return html.slice(html.lastIndexOf('<span', at), next === -1 ? at + 1500 : next);
    };
    for (const html of [desk, vault]) {
      expect(pill(html)).toContain(COLUMN_WARN.figure);
      expect(pill(html)).not.toContain(COUNT_LOOK.shipments.square);
    }
    // Every محصنة on a van — nothing waits: the figure is the محصنات' own cyan, as its head is calm.
    const placed = answer({ shipments: [WITH_CAPTAIN, ON_104] });
    for (const html of [
      render({ path: '/operations/secured/distribution', permissions: DESK, data: placed }),
      render({ path: '/operations/vault/handover', permissions: VAULT, data: placed }),
    ]) {
      expect(pill(html)).toContain(COUNT_LOOK.shipments.square);
      expect(pill(html)).not.toContain(COLUMN_WARN.figure);
      expect(leftOf(html)).toContain('data-column-icon="plain"');
    }
  });

  it('opens the van’s card from its head and its captain’s line, on both screens', () => {
    for (const html of [desk, vault]) {
      const card = vanOf(html, 'cr-104');
      expect(card).toMatch(/data-van-hover="cr-104" role="group"/);
      const zone = card.slice(card.indexOf('data-van-hover='), card.indexOf('data-van-packages='));
      expect(zone).toContain('data-van-head="true"');
      expect(zone).toContain('data-van-captain-line="cr-104"');
    }
  });

  it('counts on the page’s bar in the counts’ own colours — the محصنات cyan, then the day’s packages', () => {
    const bar = desk.slice(
      desk.indexOf('data-distribution-toolbar'),
      desk.indexOf('data-distribution-bar'),
    );
    for (const figure of ['shipments', 'unplaced', 'cartons', 'bags', 'boxes']) {
      expect(bar, figure).toContain(`data-figure="${figure}"`);
    }
    // Round 27d — the square's tint /10 (was /15): the pill neutral, only its small square tinted.
    expect(bar).toMatch(
      /bg-cyan-500\/10 text-cyan-700[\s\S]*data-figure="shipments"|data-figure="shipments"[\s\S]*bg-cyan-500\/10 text-cyan-700/,
    );
    // Round 27 — the owner's colours: كراتين amber, حقائب blue, صناديق purple: each its own.
    for (const [figure, hue] of [
      ['cartons', 'amber'],
      ['bags', 'blue'],
      ['boxes', 'purple'],
    ] as const) {
      expect(bar).toMatch(
        new RegExp(`data-figure="${figure}"[^>]*>\\s*<span class="[^"]*bg-${hue}-500/10`),
      );
    }
    // s-maadi is the one counted: 4 bags, 1 box.
    expect(bar).toMatch(/data-figure="bags"[\s\S]*?>4</);
    expect(bar).toMatch(/data-figure="cartons"[\s\S]*?>0</);
    // A reader who cannot read the vault: no package figures at all — never a guessed 0.
    const blind = render({
      path: '/operations/secured/distribution',
      permissions: DESK,
      data: answer(),
    });
    expect(blind).not.toContain('data-figure="bags"');
    expect(blind).toContain('data-figure="shipments"');
  });
});

// Round 26b — the owner on Round 26's screens: «عاوز اخلى التاريخ يكون مكان الاحصائيات والاحصائيات
// تكون فى النص» (the top row), «وعاوز اضيف اسم القائد فى الفلاتر بعد العربيه» (the captain's box).
describe('Round 26b — the top row, and the captain’s box', () => {
  const desk = render({
    path: '/operations/secured/distribution',
    permissions: [...DESK, 'operationsVault.view'],
    data: answer(),
  });
  const vault = render({
    path: '/operations/vault/handover',
    permissions: [...VAULT, 'operationsCrew.view'],
    data: answer(),
  });
  /** The top row's markup — from its mark to the line under it. */
  const rowOf = (html: string, mark: string, under: string): string =>
    html.slice(html.indexOf(mark), html.indexOf(under));

  it('the desk’s top row: the DAY first, the figures in the MIDDLE, the acts LAST', () => {
    const row = rowOf(desk, 'data-distribution-toolbar', 'data-distribution-bar');
    const at = [
      row.indexOf('data-top-row="day"'),
      row.indexOf('data-distribution-day="true"'),
      row.indexOf('data-top-row="figures"'),
      row.indexOf('data-figure="vans"'),
      row.indexOf('data-figure="boxes"'),
      row.indexOf('data-top-row="end"'),
      row.indexOf('data-distribution-auto="true"'),
      row.indexOf('data-distribution-save='),
    ];
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The day is no longer in the line under it.
    expect(desk.slice(desk.indexOf('data-distribution-bar'))).not.toContain(
      'data-distribution-day',
    );
  });

  it('the figures stand TRULY in the middle on one line — two sides of EQUAL width; else a line of their own', () => {
    // R26b critic — not `minmax(max-content,1fr)` from a fixed 68rem: a side wider than its share
    // pushed the figures off the middle (29px at 1225 in Arabic) or split them inside the row.
    expect(PARTS).not.toContain('minmax(max-content,1fr)');
    expect(PARTS).not.toMatch(/@container\(min-width:68rem\)/);
    // One line: two sides of one width (each at least the wider of the day and the acts — the row
    // MEASURES them, `lib/top-row.ts`), the figures between them.
    expect(PARTS).toContain("line: 'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',");
    expect(PARTS).toContain("line: 'col-start-2 row-start-1',");
    expect(PARTS).toContain("line: 'col-start-3 row-start-1 justify-end',");
    // Else the day and the acts on the first line, the figures centred on the next; a phone: each
    // its own line.
    expect(PARTS).toContain("split: 'col-span-2 col-start-1 row-start-2',");
    expect(PARTS).toContain("stack: 'col-start-1 row-start-2',");
    expect(PARTS).toContain('topRowLayout(widths, was)');
    expect(PARTS).toContain(
      "export const TOP_FIGURES = 'flex min-w-0 flex-wrap items-center justify-center gap-1.5';",
    );
    // Drawn as `split` until measured (before the first paint) — the layout that cannot overlap.
    expect(desk).toMatch(/data-distribution-toolbar="true" data-top-row-layout="split"/);
    expect(desk).toMatch(/data-top-row="figures" class="min-w-0 justify-self-center col-span-2/);
  });

  it('every act keeps its words at every width — none is cut to its icon to hold the middle', () => {
    // R26b critic — «تراجع» was its icon alone from 1208 to 1367 (Arabic) and to 1495 (English), and
    // «Auto-distribute» a bare arrow from 1208 to 1431: the row now gives the figures a line of their
    // own instead.
    for (const act of ['auto', 'undo'] as const) {
      expect(DIST).toContain(`<span data-act-words="${act}">{t(`);
    }
    expect(DIST).not.toMatch(/data-act-words="[a-z]+"\s+className=/);
    const undo = desk.slice(desk.indexOf('data-distribution-discard="true"'));
    expect(undo.slice(0, undo.indexOf('</button>'))).toMatch(
      new RegExp(`<span data-act-words="undo">${ar('operations.distribution.discard')}</span>`),
    );
    const auto = desk.slice(desk.indexOf('data-distribution-auto="true"'));
    expect(auto.slice(0, auto.indexOf('</button>'))).toContain(
      `<span data-act-words="auto">${ar('operations.distribution.auto')}</span>`,
    );
  });

  it('the hint and the proposals not saved are a slim line under the row — no band of their own', () => {
    const bar = desk.slice(desk.indexOf('data-distribution-bar'));
    expect(bar.slice(0, 200)).toMatch(/data-distribution-bar="true" class="flex min-w-0 flex-wrap/);
    expect(bar).toContain(ar('operations.distribution.dragHint'));
    expect(bar.indexOf(ar('operations.distribution.dragHint'))).toBeLessThan(
      bar.indexOf('data-proposed-count="2"'),
    );
    expect(DIST).not.toContain('DAY_BAR');
  });

  it('«تسليم المحصنات» the same: its day first, its figures in the middle; its acts stay on each van', () => {
    const row = rowOf(vault, 'data-handover-toolbar', 'data-handover-bar');
    const at = [
      row.indexOf('data-top-row="day"'),
      row.indexOf('data-distribution-day="true"'),
      row.indexOf('data-top-row="figures"'),
      row.indexOf('data-figure="ready"'),
    ];
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(row).not.toContain('data-top-row="end"');
    expect(HANDOVER).not.toContain('DAY_BAR');
  });

  it('the vans’ head: «اسم القائد» right after «كود السيارة», before the bank or branch and the area', () => {
    const at = desk.indexOf('data-distribution-column="vans"');
    const head = desk.slice(at, desk.indexOf('</header>', at));
    const order = ['van-code', 'van-captain', 'van-search', 'van-area'].map((box) =>
      head.indexOf(`data-filter="${box}"`),
    );
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Its whole name for a screen reader and on hover; shorter words in the box.
    const box = head.slice(head.indexOf('data-filter="van-captain"') - 400);
    expect(box).toContain(`aria-label="${ar('operations.distribution.filter.captain')}"`);
    expect(box).toContain(`title="${ar('operations.distribution.filter.captain')}"`);
    expect(box).toContain(`placeholder="${ar('operations.distribution.filter.captainShort')}"`);
    // AND-ed with the rest, counted in «المعروض … من …», cleared by «مسح التصفية».
    expect(DIST).toContain(
      'onChange={(captain) => setVanFilter((current) => ({ ...current, captain }))}',
    );
    expect(DIST).toContain('onClear={() => setVanFilter(EMPTY_VAN_FILTER)}');
    expect(DIST).toMatch(/matchesVanFilter\(van, load, vanFilter, \{/);
  });

  for (const locale of ['ar', 'en'] as const) {
    it(`[${locale}] the captain’s box speaks both languages — its short words shorter than its name`, () => {
      const whole = translate(locale, 'operations.distribution.filter.captain');
      const short = translate(locale, 'operations.distribution.filter.captainShort');
      expect(whole).not.toBe('operations.distribution.filter.captain');
      expect(short).not.toBe('operations.distribution.filter.captainShort');
      expect(short.length).toBeLessThan(whole.length);
    });
  }
});
