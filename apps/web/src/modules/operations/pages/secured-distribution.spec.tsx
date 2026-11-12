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
  type OperationsDayBoardVehicleCrewDto,
  type OperationsSecuredDistributionDto,
  type OperationsSecuredDistributionRowDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { formatNumber } from '../../../shared/lib/format';
import { ApiError } from '../../../shared/lib/api-client';
import { HISTORY_TOO_LARGE, cairoToday } from '../lib/shipment-history';
import { __securedDistributionKey } from '../api/operations-queries';
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
  over: Partial<OperationsDayBoardVehicleCrewDto> = {},
): OperationsDayBoardVehicleCrewDto => ({
  crewAssignmentId: `cr-${code}`,
  vehicleId: `v-${code}`,
  vehicleCode: code,
  drivers: [],
  captains,
  specialist1: [person(`s1-${code}`, `أخصائي أول ${code}`)],
  specialist2: [person(`s2-${code}`, `أخصائي ثان ${code}`)],
  direction,
  plannedTime: '08:30',
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
}: {
  path: '/operations/secured/distribution' | '/operations/vault/handover';
  permissions: string[];
  data: OperationsSecuredDistributionDto | null;
  /** The server refused the day as too large to show — with `data` kept from an earlier answer. */
  refused?: boolean;
  /** A day after today (`?date=`) — the read filed under its own key; null for today. */
  date?: string | null;
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
  qc.setQueryData(
    listKey('operations', 'vault', { packaging: true }),
    new Map([['s-maadi', { bags: 4, cartons: 0, boxes: 1 }]]),
  );
  if (data !== null) qc.setQueryData(__securedDistributionKey(date), data);
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

  it('says on each van its number, time, direction, captain(s) and both specialists', () => {
    const v104 = vanOf(html, 'cr-104');
    expect(v104).toContain('data-van-code="104"');
    expect(v104).toContain('08:30');
    expect(v104).toContain('data-van-direction="مدينة نصر"');
    expect(v104).toContain('شادي محمد أحمد · كريم سمير علي');
    expect(v104).toContain(ar('operations.distribution.captains'));
    expect(v104).toContain('أخصائي أول 104');
    expect(v104).toContain('أخصائي ثان 104');
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
    expect(html).toContain(ar('operations.distribution.save', { count: formatNumber(2, 'ar') }));
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

  it('on a two-captain van, says who the shipment goes with and offers the other', () => {
    const card = cardOf(html, 's-104');
    expect(card).toContain('data-captain-switch="s-104"');
    expect(card).toContain(ar('operations.distribution.withCaptain', { name: 'كريم سمير علي' }));
    expect(card).toContain(ar('operations.distribution.switchCaptain', { name: 'شادي محمد أحمد' }));
  });

  it('sums each van’s load — the money, and the packages the vault counted', () => {
    const v101 = vanOf(html, 'cr-101');
    expect(v101).toContain(`data-van-count="2"`);
    expect(v101).toMatch(/data-money="EGP"[\s\S]*2,000,000/);
    expect(cardOf(html, 's-maadi')).toContain('data-packages="4/0/1"');
  });

  it('opens on the day with no day before today, and the drag hint', () => {
    expect(html).toMatch(
      new RegExp(
        `type="date"[^>]*value="${TODAY}"[^>]*min="${TODAY}"|min="${TODAY}"[^>]*value="${TODAY}"`,
      ),
    );
    expect(html).toContain(ar('operations.distribution.dragHint'));
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
    expect(v101).toContain(ar('operations.handover.handover', { count: formatNumber(1, 'ar') }));
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
          max: formatNumber(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS, 'ar'),
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
    const body = ar('operations.handover.confirmBody', { count: '1', code: '101', day: TODAY });
    expect(body).toContain(TODAY);
    expect(translate('en', 'operations.handover.confirmBody', { day: TODAY })).toContain(TODAY);
  });
});

// ── Source pins — what each screen is built from ───────────────────────────────────────────────

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const DIST = read('./SecuredDistributionPage.tsx');
const HANDOVER = read('./VaultHandoverPage.tsx');
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
