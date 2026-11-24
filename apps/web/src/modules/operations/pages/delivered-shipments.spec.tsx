// Round 33 B — «الشحنات المسلَّمة», rendered against the real catalogs, a real store and query client:
//
//   · «زى شاشةاليوم التشغيلى»: the day board's board (`ShipmentsBoard`, `kind="delivered"`) — its
//     figures, filters and table — over the server's delivered rows, with «يوم التسليم» (today by
//     default, nothing after it) and «حالة التأكيد» («بانتظار التأكيد» / «مؤكَّدة» / «الكل»);
//   · «هتظهرلى لما تكون تم التسليم بس»: a row awaiting its ✓ is the day board's yellow «تم التسليم»; a
//     confirmed one green, with its receipt's number and the bank billed — and «بدون صورة» without a
//     photo («اختيارية مع تنبيه»);
//   · «الاجراءات هيكون فيه علامة صح»: the ✓ on a row awaiting it, «إلغاء التأكيد» on a confirmed one,
//     for the day board's ✓ grant only — and nothing else of the day board's acts;
//   · the ✓'s dialog: «رقم الإيصال» required, «صورة الإيصال» optional with its warning, «من» / «إلى» by
//     bank and branch, «تأكيد» / «إلغاء». Its checks are pure (lib/delivered-board.spec.ts);
//   · Round 33 C — «عاوز رثم الايصال فى عمود لوحده»: the number in a column of its own, «رقم الإيصال»,
//     just before «صورة الإيصال» — this screen's alone — with its box after «ملاحظات», and no longer
//     a line of «الحالة».
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
  addDaysYmd,
  type Locale,
  type MeDto,
  type OperationsCurrencyDto,
  type OperationsDayBoardBranchDto,
  type OperationsDeliveredBoardDto,
  type OperationsDeliveredShipmentDto,
  type OperationsDeliveryConfirmationDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { ApiError } from '../../../shared/lib/api-client';
import { __deliveredBoardKey, isDeliveryConflict } from '../api/operations-queries';
import { DeliveryConfirmDialog } from '../components/DeliveredShipmentParts';
import { RECEIPT_ONE_LINE, ShipmentsBoard } from '../components/ShipmentsBoard';
import { rowTint, type BoardKind } from '../lib/day-board';
import { cairoToday } from '../lib/shipment-history';
import { DeliveredShipmentsPage } from './DeliveredShipmentsPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const ar = (key: string, params?: Record<string, string>): string => translate('ar', key, params);
const en = (key: string, params?: Record<string, string>): string => translate('en', key, params);
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

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
const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: items.length, totalPages: 1 },
});

const branch = (
  id: string,
  name: string,
  bankId: string,
  bankName: string,
): OperationsDayBoardBranchDto => ({
  id,
  name,
  code: '',
  bankId,
  bankName,
});
const MAADI = branch('br-maadi', 'فرع المعادي', 'b-ahly', 'الأهلي');
const HARAM = branch('br-haram', 'فرع الهرم', 'b-misr', 'مصر');
const HELWAN = branch('br-helwan', 'فرع حلوان', 'b-ahly', 'الأهلي');

const confirmation = (
  over: Partial<OperationsDeliveryConfirmationDto> = {},
): OperationsDeliveryConfirmationDto => ({
  receiptNumber: 'RC-1001',
  billedSide: 'origin',
  billedBranchId: MAADI.id,
  billedBankId: 'b-ahly',
  billedBankName: 'الأهلي',
  confirmedById: 'u-9',
  confirmedByName: 'منى',
  confirmedAt: '2026-11-20T10:00:00.000Z',
  ...over,
});
const IMAGE = {
  fileId: 'f-1',
  fileName: 'receipt.png',
  mime: 'image/png',
  size: 10,
  uploadedAt: '2026-11-20T10:00:00.000Z',
};

const shipment = (
  id: string,
  over: Partial<OperationsDeliveredShipmentDto> = {},
): OperationsDeliveredShipmentDto =>
  ({
    id,
    shipmentType: 'daily',
    status: 'draft',
    mainBankId: 'b-ahly',
    secondaryBankId: null,
    originBranchId: MAADI.id,
    destinationBranchId: HELWAN.id,
    areaName: 'المعادي',
    lines: [{ currencyId: 'egp', amount: 1_000 }],
    collectionDate: '2026-11-20T00:00:00.000Z',
    deliveryDate: null,
    receiptNumber: null,
    vaultReceiptNumber: null,
    receiptImage: null,
    serialTracked: false,
    notes: null,
    receivedById: null,
    receivedAt: null,
    version: 2,
    createdAt: '2026-11-20T06:00:00.000Z',
    updatedAt: '2026-11-20T06:00:00.000Z',
    origin: MAADI,
    destination: HELWAN,
    crew: null,
    // 10:15 in Cairo (UTC+2 in November).
    captainDeliveredAt: '2026-11-20T08:15:00.000Z',
    securedStage: null,
    pickedUpBy: null,
    pickedUpAt: null,
    deliveryConfirmation: null,
    ...over,
  }) as OperationsDeliveredShipmentDto;

const AWAITING = shipment('s-awaiting');
const CONFIRMED = shipment('s-confirmed', {
  deliveryConfirmation: confirmation(),
  receiptImage: IMAGE,
});
// A محصنة out of the vault and delivered, confirmed — «إلى» billed — with no photo yet.
const SECURED = shipment('s-secured', {
  shipmentType: 'secured',
  status: 'dispatched',
  securedStage: 'dispatched',
  deliveryDate: '2026-11-20T00:00:00.000Z',
  destination: HARAM,
  destinationBranchId: HARAM.id,
  secondaryBankId: 'b-misr',
  deliveryConfirmation: confirmation({
    receiptNumber: 'RC-3003',
    billedSide: 'destination',
    billedBranchId: HARAM.id,
    billedBankId: 'b-misr',
    billedBankName: 'مصر',
  }),
});
// A محصنة out of the vault and delivered, NOT confirmed, no photo: its first one may be taken.
const SECURED_AWAITING = shipment('s-secured-awaiting', {
  shipmentType: 'secured',
  status: 'dispatched',
  securedStage: 'dispatched',
  deliveryDate: '2026-11-20T00:00:00.000Z',
});

const DESK = [
  'operationsShipment.view',
  'operationsShipment.complete',
  'operationsShipment.edit',
  'operationsCrew.view',
];
const READER = ['operationsShipment.view'];

const storeFor = (permissions: string[], locale: Locale = 'ar') =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
    },
  });

/**
 * The page's read seeded where the page asks for it: `date` null is the default — NO day named,
 * keyed by the PC's Cairo day (Round 33 critic) — answered as `answered`, the server's `today`
 * beside it.
 */
const clientWith = (
  date: string | null,
  shipments: OperationsDeliveredShipmentDto[],
  serverToday: string = cairoToday(),
  answered: string = date ?? serverToday,
): QueryClient => {
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
    page([
      { id: 'b-ahly', opsName: 'الأهلي' },
      { id: 'b-misr', opsName: 'مصر' },
    ]),
  );
  qc.setQueryData(
    listKey('operations', 'currencies', { page: 1, pageSize: MAX_PAGE_SIZE }),
    page(CURRENCIES),
  );
  const board: OperationsDeliveredBoardDto = {
    date: answered,
    today: serverToday,
    shipments,
    crews: [],
  };
  qc.setQueryData(__deliveredBoardKey(date, cairoToday()), board);
  return qc;
};

/** The page's address: its `?date=` (none for the default) and any filters after it. */
const addressOf = (path: string, date: string | null, query: string): string => {
  const search = [date === null ? '' : `date=${date}`, query].filter((p) => p !== '').join('&');
  return search === '' ? path : `${path}?${search}`;
};

const render = ({
  permissions = DESK,
  shipments = [AWAITING, CONFIRMED, SECURED, SECURED_AWAITING],
  date = null,
  locale = 'ar',
  serverToday = cairoToday(),
  url = date,
  query = '',
}: {
  permissions?: string[];
  shipments?: OperationsDeliveredShipmentDto[];
  /** A past day asked by name (`?date=`); null for the default — no day named. */
  date?: string | null;
  locale?: Locale;
  /** The server's Cairo today, as its read says it (Round 33 critic). */
  serverToday?: string;
  /** The URL's `?date=` when it is not the day asked (a day the screen bounds away); null none. */
  url?: string | null;
  /** More of the address — the board's filters (`receipt=…`), without `?` or `&`. */
  query?: string;
} = {}): string => {
  const path = '/operations/shipments/delivered';
  return renderToStaticMarkup(
    <Provider store={storeFor(permissions, locale)}>
      <QueryClientProvider client={clientWith(date, shipments, serverToday)}>
        <MemoryRouter initialEntries={[addressOf(path, url, query)]}>
          <Routes>
            <Route path={path} element={<DeliveredShipmentsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const renderDialog = (row: OperationsDeliveredShipmentDto, permissions = DESK): string =>
  renderToStaticMarkup(
    <Provider store={storeFor(permissions)}>
      <QueryClientProvider client={clientWith(null, [row])}>
        <DeliveryConfirmDialog row={row} onClose={() => undefined} />
      </QueryClientProvider>
    </Provider>,
  );

/** The markup of one table row, by its shipment's id (its ✓, log or photo carry it). */
const rowOf = (html: string, id: string): string => {
  const at = html.indexOf(`="${id}"`);
  expect(at, id).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<tr', at);
  return html.slice(start, html.indexOf('</tr>', at));
};

const PAGE = read('./DeliveredShipmentsPage.tsx');
const PARTS = read('../components/DeliveredShipmentParts.tsx');
const BOARD = read('../components/ShipmentsBoard.tsx');
const QUERIES = read('../api/operations-queries.ts');
const API = read('../api/operations-api.ts');

describe('Round 33 B — «الشحنات المسلَّمة»: the day board’s board, delivered rows only', () => {
  it('is the day board’s board — its figures, filters and table — of the delivered kind', () => {
    const html = render();
    expect(html).toContain('data-shipments-toolbar="true"');
    expect(html).toContain('data-shipment-filters="true"');
    expect(html).toContain('data-shipment-figures="true"');
    expect(PAGE).toContain('kind="delivered"');
    expect(PAGE).toContain('<ShipmentsBoard');
    // The day board's columns: «النوع» is kept (daily and محصنات side by side), no delivery-date column.
    const body = text(html);
    expect(body).toContain(ar('operations.shipment.type'));
    expect(BOARD).toContain("const secured = kind === 'secured' || kind === 'vault';");
  });

  it('opens on «يوم التسليم» = today, a box that takes no later day', () => {
    const html = render();
    const today = cairoToday();
    expect(html).toContain(`aria-label="${ar('operations.delivered.day')}"`);
    expect(html).toContain(`max="${today}"`);
    expect(html).toContain(`value="${today}"`);
    // A past day asked in the URL is the day shown — «الأيام اللى فاتت» included.
    const past = render({ date: '2026-11-02' });
    expect(past).toContain('value="2026-11-02"');
  });

  it('filters by «حالة التأكيد» — «بانتظار التأكيد» / «مؤكَّدة» / «الكل» — the box saying «الكل»', () => {
    const html = render();
    expect(html).toContain(`aria-label="${ar('operations.delivered.filter')}"`);
    expect(text(html)).toContain(ar('operations.delivered.filter.all'));
    // The day board's «التسليم» is not this board's box.
    expect(html).not.toContain(`aria-label="${ar('operations.dailyOps.received')}"`);
    expect(BOARD).toContain("{ value: 'no', label: t('operations.delivered.filter.awaiting') },");
    expect(BOARD).toContain("{ value: 'yes', label: t('operations.delivered.filter.confirmed') },");
    expect(BOARD).toContain("{ value: 'all', label: t('operations.delivered.filter.all') },");
  });

  it('an unconfirmed row is the day board’s yellow «تم التسليم», with when its captain delivered it', () => {
    const row = rowOf(render(), 's-awaiting');
    expect(row).toContain(rowTint('captain')!.split(' ')[0]!);
    expect(row).toContain('data-delivered-state="awaiting"');
    expect(row).toContain('data-delivery="captain"');
    expect(text(row)).toContain(ar('operations.board.status.delivered'));
    expect(text(row)).toContain(ar('operations.delivered.awaiting'));
    expect(text(row)).toContain('10:15');
  });

  it('a confirmed row is green with its receipt number and the bank billed — «بدون صورة» without a photo', () => {
    const html = render();
    const confirmed = rowOf(html, 's-confirmed');
    expect(confirmed).toContain(rowTint('desk')!.split(' ')[0]!);
    expect(confirmed).toContain('data-delivered-state="confirmed"');
    expect(text(confirmed)).toContain(ar('operations.delivered.confirmed'));
    expect(text(confirmed)).toContain('RC-1001');
    expect(text(confirmed)).toContain(
      ar('operations.delivered.billedTo', {
        bank: 'الأهلي',
        side: ar('operations.delivered.side.origin'),
      }),
    );
    // It has its photo: no warning.
    expect(confirmed).not.toContain('data-delivered-no-photo');
    const secured = rowOf(html, 's-secured');
    expect(text(secured)).toContain('RC-3003');
    expect(text(secured)).toContain(
      ar('operations.delivered.billedTo', {
        bank: 'مصر',
        side: ar('operations.delivered.side.destination'),
      }),
    );
    expect(secured).toContain('data-delivered-no-photo="s-secured"');
    expect(text(secured)).toContain(ar('operations.delivered.noPhoto'));
  });

  it('offers the ✓ on a row awaiting it and «إلغاء التأكيد» on a confirmed one — the day board’s ✓ grant only', () => {
    const html = render();
    expect(html).toContain('data-delivered-confirm="s-awaiting"');
    expect(html).toContain('data-delivered-confirm="s-secured-awaiting"');
    expect(html).not.toContain('data-delivered-confirm="s-confirmed"');
    expect(html).toContain('data-delivered-undo="s-confirmed"');
    expect(html).toContain('data-delivered-undo="s-secured"');
    expect(html).toContain(`aria-label="${ar('operations.delivered.confirm')}"`);
    expect(html).toContain(`aria-label="${ar('operations.delivered.undo')}"`);
    // A reader without `operationsShipment.complete` sees the rows and acts on none of them.
    const reader = render({ permissions: READER });
    expect(reader).not.toContain('data-delivered-confirm=');
    expect(reader).not.toContain('data-delivered-undo=');
    expect(reader).toContain('data-delivered-state="confirmed"');
  });

  it('is its own act only — no «إضافة شحنة», no day board ✓, no edit or delete; «السجل» stays', () => {
    const html = render();
    expect(html).not.toContain('data-shipment-new="true"');
    expect(html).not.toContain(`aria-label="${ar('operations.shipment.receive')}"`);
    expect(html).not.toContain(`aria-label="${ar('common.edit')}"`);
    expect(html).not.toContain(`aria-label="${ar('common.remove')}"`);
    expect(html).toContain('data-shipment-log="s-awaiting"');
    expect(PAGE).toContain('canCreate={false}');
    expect(PAGE).toContain('canToggleReceived={false}');
    expect(PAGE).toContain('canEditRows={false}');
    expect(PAGE).toMatch(/^\s+canManageReceipts$/m);
  });

  it('manages the receipt photo as the day board does — a FIRST one on a delivered محصنة too', () => {
    const html = render();
    // A daily row with no photo: the day board's cloud.
    expect(html).toContain('data-shipment-receipt-upload="s-awaiting"');
    // A locked محصنة that reached its bank, no photo: its first one may be added (Round 33 B)…
    expect(html).toContain('data-shipment-receipt-upload="s-secured"');
    expect(html).toContain('data-shipment-receipt-upload="s-secured-awaiting"');
    // …and one already there is looked at, never replaced or deleted on a locked row.
    const lockedWithPhoto = render({
      shipments: [shipment('s-locked', { ...SECURED, id: 's-locked', receiptImage: IMAGE })],
    });
    expect(lockedWithPhoto).toContain('data-shipment-receipt-view="s-locked"');
    expect(lockedWithPhoto).not.toContain('data-shipment-receipt-replace="s-locked"');
    expect(lockedWithPhoto).not.toContain('data-shipment-receipt-delete="s-locked"');
    // A daily row with one: view, replace, delete — the day board's box.
    expect(html).toContain('data-shipment-receipt-replace="s-confirmed"');
    // A reader who may not edit shipments uploads nothing.
    expect(render({ permissions: READER })).not.toContain('data-shipment-receipt-upload=');
  });

  it('says so when nothing was delivered on the day', () => {
    expect(text(render({ shipments: [] }))).toContain(ar('operations.delivered.empty'));
  });

  it('reads in English too', () => {
    const html = render({ locale: 'en' });
    const body = text(html);
    expect(body).toContain(en('operations.delivered.awaiting'));
    expect(body).toContain(en('operations.delivered.confirmed'));
    expect(body).toContain(en('operations.delivered.noPhoto'));
    expect(html).toContain(`aria-label="${en('operations.delivered.day')}"`);
    expect(
      en('operations.delivered.billedTo', {
        bank: 'NBE',
        side: en('operations.delivered.side.origin'),
      }),
    ).toBe('Billed to NBE (From)');
  });
});

describe('Round 33 B — the ✓’s dialog: «لازم يكون فيه رقم الايصال … و يحدد البنك من او الى»', () => {
  it('asks for the receipt number — required — the photo — optional, warned — and the side', () => {
    const html = renderDialog(AWAITING);
    const body = text(html);
    expect(html).toContain('data-delivered-dialog="s-awaiting"');
    expect(body).toContain(ar('operations.delivered.dialog.title'));
    expect(body).toContain(ar('operations.delivered.receipt.label'));
    expect(html).toContain('data-delivered-receipt-input="true"');
    expect(html).toContain('aria-required="true"');
    expect(body).toContain(ar('operations.delivered.photo.label'));
    expect(body).toContain(ar('operations.delivered.photo.optional'));
    expect(html).toContain('data-delivered-photo-pick="true"');
    // No photo yet: the warning that the row will keep «بدون صورة».
    expect(html).toContain('data-delivered-photo-warning="true"');
    expect(body).toContain(ar('operations.delivered.photo.warning'));
    expect(body).toContain(ar('operations.delivered.side.label'));
    expect(body).toContain(ar('operations.delivered.dialog.save'));
    expect(body).toContain(ar('common.cancel'));
  });

  it('offers exactly «من» and «إلى», each by its bank and its branch, nothing chosen', () => {
    const html = renderDialog(
      shipment('s-x', { destination: HARAM, destinationBranchId: HARAM.id }),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="true"/g)).toBeNull();
    const origin = html.slice(html.indexOf('data-delivered-side="origin"'));
    expect(text(origin.slice(0, origin.indexOf('</button>')))).toContain('الأهلي');
    expect(text(origin.slice(0, origin.indexOf('</button>')))).toContain('فرع المعادي');
    const destination = html.slice(html.indexOf('data-delivered-side="destination"'));
    expect(text(destination.slice(0, destination.indexOf('</button>')))).toContain('مصر');
    expect(text(destination.slice(0, destination.indexOf('</button>')))).toContain('فرع الهرم');
    expect(html).not.toContain('data-delivered-one-bank');
  });

  it('says so when both branches are of one bank — the side is still recorded', () => {
    const html = renderDialog(AWAITING);
    expect(html).toContain('data-delivered-one-bank="true"');
    expect(text(html)).toContain(ar('operations.delivered.side.sameBank', { bank: 'الأهلي' }));
  });

  it('shows the photo already there instead of the warning', () => {
    const html = renderDialog(shipment('s-photo', { receiptImage: IMAGE }));
    expect(html).toContain('data-delivered-photo="current"');
    expect(html).not.toContain('data-delivered-photo-warning');
    expect(html).not.toContain('data-delivered-photo-pick');
  });

  it('a reader who may not edit shipments is warned, offered no picker', () => {
    const html = renderDialog(AWAITING, ['operationsShipment.view', 'operationsShipment.complete']);
    expect(html).not.toContain('data-delivered-photo-pick');
    expect(text(html)).toContain(ar('operations.delivered.photo.warningCannotPick'));
  });

  it('checks before sending, sends no bank or person, uploads the photo AFTER the confirmation', () => {
    // The two boxes the server would refuse are checked first (`deliveryDraftProblems`).
    expect(PARTS).toContain(
      'if (sending.current || problems.receiptNumber !== null || problems.billedSide !== null) return;',
    );
    expect(PARTS).toContain('body: deliveryRequestBody(draft, row.version)');
    // The photo goes up through the day board's own upload, after the record is written.
    expect(PARTS).toMatch(
      /confirm\s*\.mutateAsync\([\s\S]*?await upload\.mutateAsync\(\{ id: row\.id, file \}\)/,
    );
    // A row that moved closes the dialog onto the fresh screen; a box the server named stays marked.
    expect(PARTS).toContain("if (refusal?.kind === 'stale') onClose();");
    expect(QUERIES).toMatch(
      /export const useConfirmShipmentDelivery[\s\S]*?if \(isDeliveryConflict\(error\)\) void invalidate\(\);/,
    );
  });

  it('says a refused «إلغاء التأكيد» ONCE — the global notifier’s, no toast of its own (Round 33 verifier)', () => {
    // The real stack: a colleague took the confirmation back first, the desk's undo got 409
    // `OPERATIONS_DELIVERY_NOT_CONFIRMED`, and the same sentence was toasted twice — the global
    // notifier (the hook declares no `onError`, shared/lib/query-client.ts) and the row's own.
    const hook = /export const useUndoShipmentDelivery = \(\) => \{[\s\S]*?\n\};/.exec(
      QUERIES,
    )?.[0];
    expect(hook).toBeDefined();
    expect(hook).not.toMatch(/\bonError\s*:/);
    expect(hook).toContain('if (isDeliveryConflict(error)) await invalidate();');
    const takeBack = /const takeBack = \(\): void => \{[\s\S]*?\n {2}\};/.exec(PARTS)?.[0];
    expect(takeBack).toBeDefined();
    expect(takeBack).toContain("onSuccess: () => toast.success(t('operations.delivered.undone'))");
    expect(takeBack).not.toMatch(/\bonError\s*:/);
    expect(takeBack).not.toContain('toast.error');
  });

  it('keeps Tab inside, closes on Escape, and asks before undoing', () => {
    expect(PARTS).toContain('useFocusTrap(inside, () => numberBox.current);');
    // Escape is the board design's own window (`DesignDialog`).
    expect(PARTS).toContain('<DesignDialog');
    expect(PARTS).toContain("if (!window.confirm(t('operations.delivered.undoConfirm'))) return;");
  });

  // Rewritten (Round 33 critic): the key took the day only, always named — the PC's today on the
  // default. It now takes `null` for the default (no day named: the server's today) beside the PC's
  // clock day, which only says when to ask again. Still under the day board's key.
  it('lives under the day board’s key, so every act that moves the board moves it', () => {
    expect(QUERIES).toMatch(
      /const deliveredBoardKey = \(date: string \| null, clock: string\): readonly unknown\[\] => \[\s*\.\.\.featureKey\(MODULE, 'dayBoard'\),\s*'delivered',\s*date === null \? \{ date: null, clock \} : \{ date \},/,
    );
    expect(__deliveredBoardKey(null, '2026-11-23')).toEqual([
      'operations',
      'dayBoard',
      'delivered',
      { date: null, clock: '2026-11-23' },
    ]);
    // A day named is keyed by itself alone: midnight does not re-ask a past day.
    expect(__deliveredBoardKey('2026-11-02', '2026-11-23')).toEqual([
      'operations',
      'dayBoard',
      'delivered',
      { date: '2026-11-02' },
    ]);
  });
});

describe('Round 33 critic — the server’s day, the dialog past midnight, a deleted row, the keys', () => {
  const PC = cairoToday();

  it('opens on the SERVER’s today, not the PC’s — a PC clock a day AHEAD', () => {
    const server = addDaysYmd(PC, -1);
    const html = render({ serverToday: server });
    // The default names no day: the read is the server's today, and the box goes no later.
    expect(html).toContain(`value="${server}"`);
    expect(html).toContain(`max="${server}"`);
    expect(html).not.toContain(`max="${PC}"`);
    expect(API).toMatch(/export const getDeliveredBoard = \(date: string \| null\)/);
  });

  it('reaches the server’s today from a PC clock a day BEHIND — its ?date= is the default', () => {
    const server = addDaysYmd(PC, 1);
    const html = render({ serverToday: server, url: server });
    expect(html).toContain(`value="${server}"`);
    expect(html).toContain(`max="${server}"`);
  });

  it('keeps the open dialog on its row while the screen reads another day', () => {
    expect(PAGE).toContain('const open = deliveredDialogRow(confirming, read);');
    expect(PAGE).toContain(
      'const openOn = (row: OperationsDeliveredShipmentDto): void => setConfirming({ row, day });',
    );
    // One window per row: the row as opened and the row re-read are the same window, its draft kept.
    expect(PARTS).toContain('<DeliveryConfirmWindow key={row.id} row={row} onClose={onClose} />');
  });

  it('says once that the default day moved on, with the day it left', () => {
    expect(PAGE).toContain('const left = defaultDayLeft(lastDefault.current, answeredDefault);');
    expect(PAGE).toContain("t('operations.delivered.dayMoved.title'),");
    expect(ar('operations.delivered.dayMoved', { day: '2026-11-22' })).toBe(
      'انتقلت الشاشة إلى تسليمات اليوم. تسليمات يوم 2026-11-22 تجدها باختياره في «يوم التسليم».',
    );
    expect(en('operations.delivered.dayMoved', { day: '2026-11-22' })).toContain('“Delivery day”');
  });

  it('re-reads the screen on a deleted shipment’s 404 — as on every refusal that closes the dialog', () => {
    const err = (code: string, status: number) => new ApiError(code, code, status);
    expect(isDeliveryConflict(err('NOT_FOUND', 404))).toBe(true);
    for (const code of [
      'OPERATIONS_SHIPMENT_NOT_DELIVERED',
      'OPERATIONS_DELIVERY_ALREADY_CONFIRMED',
      'OPERATIONS_DELIVERY_NOT_CONFIRMED',
      'STALE_DOCUMENT',
    ]) {
      expect(isDeliveryConflict(err(code, 409)), code).toBe(true);
    }
    expect(isDeliveryConflict(err('OPERATIONS_DELIVERY_RECEIPT_NUMBER_REQUIRED', 422))).toBe(false);
    expect(isDeliveryConflict(err('FORBIDDEN', 403))).toBe(false);
    expect(isDeliveryConflict(err('INTERNAL', 500))).toBe(false);
    expect(isDeliveryConflict(new Error('offline'))).toBe(false);
  });

  it('names the undo for what it does, with no aria-pressed beside it', () => {
    const undo = rowOf(render(), 's-confirmed');
    const button = undo.slice(undo.indexOf('<button', undo.indexOf('data-delivered-undo') - 200));
    const tag = button.slice(0, button.indexOf('>'));
    expect(tag).toContain('data-delivered-undo="s-confirmed"');
    expect(tag).toContain(`aria-label="${ar('operations.delivered.undo')}"`);
    expect(tag).not.toContain('aria-pressed');
  });

  it('makes «من» / «إلى» one Tab stop, the arrows inside', () => {
    const html = renderDialog(AWAITING);
    const tagOf = (side: string): string => {
      const at = html.indexOf(`data-delivered-side="${side}"`);
      return html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at));
    };
    // Nothing chosen yet: the first side is the group's one stop.
    expect(tagOf('origin')).toContain('tabindex="0"');
    expect(tagOf('destination')).toContain('tabindex="-1"');
    expect(PARTS).toMatch(
      /const next = billedSideAfterKey\(\s*options,\s*draft\.billedSide,\s*event\.key,\s*locale === 'ar',\s*\);/,
    );
    expect(PARTS).toContain('sideButtons.current[next]?.focus();');
  });
});

/** The table's column names, in the order drawn. */
const headersOf = (html: string): string[] => {
  const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
  return [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1] ?? ''));
};
/** One row's cells, in the columns' order. */
const cellsOf = (rowHtml: string): string[] =>
  [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? '');

/** The board itself, of a kind, over a confirmed row and one awaiting — `?receipt=RC` in its URL. */
const renderBoard = (kind: BoardKind, rows = [CONFIRMED, AWAITING]): string =>
  renderToStaticMarkup(
    <Provider store={storeFor(DESK)}>
      <QueryClientProvider client={clientWith(null, [])}>
        <MemoryRouter>
          <ShipmentsBoard
            search={[new URLSearchParams('receipt=RC'), () => undefined]}
            kind={kind}
            shipments={rows}
            crews={[]}
            loaded
            loading={false}
            error={null}
            onRetry={() => undefined}
            canCreate={false}
            canToggleReceived={false}
            empty="—"
          />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

describe('Round 33 C — «عاوز رثم الايصال فى عمود لوحده»: «رقم الإيصال» in a column of its own', () => {
  const NUMBER = ar('operations.delivered.receiptNo');

  it('names the column «رقم الإيصال» («Receipt no.»), just before «صورة الإيصال»', () => {
    expect(NUMBER).toBe('رقم الإيصال');
    expect(en('operations.delivered.receiptNo')).toBe('Receipt no.');
    const heads = headersOf(render());
    const at = heads.indexOf(NUMBER);
    expect(at, heads.join(' | ')).toBeGreaterThan(-1);
    expect(heads[at + 1]).toBe(ar('operations.board.receiptImage'));
    // …after «ملاحظات», as the day board's columns end.
    expect(heads[at - 1]).toBe(ar('operations.shipment.notes'));
    expect(heads.filter((h) => h === NUMBER)).toHaveLength(1);
    const english = headersOf(render({ locale: 'en' }));
    expect(english[english.indexOf('Receipt no.') + 1]).toBe(en('operations.board.receiptImage'));
  });

  it('prints the number in the board’s figures, in its own direction, and a quiet «—» awaiting the ✓', () => {
    const html = render();
    const col = headersOf(html).indexOf(NUMBER);
    const confirmed = cellsOf(rowOf(html, 's-confirmed'))[col] ?? '';
    // Round 33 C critic — its own direction (`auto`): a Latin or digit number reads left to right.
    expect(confirmed).toMatch(/^<bdi dir="auto" class="[^"]*tabular-nums[^"]*"/);
    expect(confirmed).toContain('data-delivered-receipt="s-confirmed"');
    expect(confirmed).toContain('whitespace-nowrap');
    expect(text(confirmed)).toBe('RC-1001');
    expect(text(cellsOf(rowOf(html, 's-secured'))[col] ?? '')).toBe('RC-3003');
    // A row still awaiting its ✓: the board's empty cell — the notes' dash — and no number hook.
    for (const id of ['s-awaiting', 's-secured-awaiting']) {
      const cell = cellsOf(rowOf(html, id))[col] ?? '';
      expect(cell).toBe('<span class="text-slate-400">—</span>');
    }
    // Typed on an Arabic keyboard, read in the board's digits.
    const arabic = render({
      shipments: [
        shipment('s-arabic', { deliveryConfirmation: confirmation({ receiptNumber: '٧٧٣١٠' }) }),
      ],
    });
    expect(text(cellsOf(rowOf(arabic, 's-arabic'))[col] ?? '')).toBe('77310');
  });

  // Round 33 C critic — the ✓ takes any text up to 40 characters: a number written with Arabic
  // words was forced left to right («إيصال ١٢٣٤٥» drawn as «12345 إيصال» to an Arabic reader).
  it('lets a number typed in Arabic words keep their order — the cell takes its first letter’s direction', () => {
    const html = render({
      shipments: [
        shipment('s-words', {
          deliveryConfirmation: confirmation({ receiptNumber: 'إيصال ١٢٣٤٥' }),
        }),
      ],
    });
    const col = headersOf(html).indexOf(NUMBER);
    const cell = cellsOf(rowOf(html, 's-words'))[col] ?? '';
    expect(cell).toMatch(/^<bdi dir="auto"/);
    expect(cell).not.toContain('dir="ltr"');
    expect(cell).not.toContain('dir="rtl"');
    // Its digits in the board's figures, its words as typed.
    expect(text(cell)).toBe('إيصال 12345');
  });

  it('keeps a long number inside the column — wrapped in 7rem, every character on screen', () => {
    // The longest the ✓ takes (`OPERATIONS_DELIVERY_RECEIPT_NUMBER_MAX`, 40).
    const longest = 'RC-2026-11-24-'.padEnd(40, '0');
    expect(longest).toHaveLength(40);
    const html = render({
      shipments: [
        shipment('s-long', { deliveryConfirmation: confirmation({ receiptNumber: longest }) }),
        shipment('s-twelve', {
          deliveryConfirmation: confirmation({ receiptNumber: 'R'.repeat(RECEIPT_ONE_LINE) }),
        }),
      ],
    });
    const col = headersOf(html).indexOf(NUMBER);
    const long = cellsOf(rowOf(html, 's-long'))[col] ?? '';
    expect(text(long)).toBe(longest);
    expect(long).toContain('max-w-[7rem]');
    expect(long).toContain('break-words');
    expect(long).not.toContain('truncate');
    // Up to `RECEIPT_ONE_LINE` characters: one line, never broken.
    const twelve = cellsOf(rowOf(html, 's-twelve'))[col] ?? '';
    expect(twelve).toContain('whitespace-nowrap');
    expect(twelve).not.toContain('max-w-[7rem]');
  });

  it('no longer says the number in «الحالة» — «مؤكَّدة», the bank billed and «بدون صورة» stay', () => {
    const html = render();
    const status = headersOf(html).indexOf(ar('operations.common.status'));
    const confirmed = cellsOf(rowOf(html, 's-confirmed'))[status] ?? '';
    expect(confirmed).toContain('data-delivered-state="confirmed"');
    expect(text(confirmed)).toContain(ar('operations.delivered.confirmed'));
    expect(text(confirmed)).toContain(
      ar('operations.delivered.billedTo', {
        bank: 'الأهلي',
        side: ar('operations.delivered.side.origin'),
      }),
    );
    expect(confirmed).not.toContain('RC-1001');
    expect(confirmed).not.toContain('data-delivered-receipt');
    expect(text(confirmed)).not.toContain(NUMBER);
    // The status line «إيصال رقم …» is gone with it.
    expect(html).not.toContain('إيصال رقم');
    const secured = cellsOf(rowOf(html, 's-secured'))[status] ?? '';
    expect(secured).toContain('data-delivered-no-photo="s-secured"');
    expect(secured).not.toContain('RC-3003');
    expect(PARTS).not.toContain('data-delivered-receipt=');
  });

  it('is this screen’s alone — the day board, the history, the secured and the vault boards keep theirs', () => {
    for (const kind of ['shipments', 'secured', 'vault'] as const) {
      const html = renderBoard(kind);
      expect(headersOf(html), kind).not.toContain(NUMBER);
      expect(html, kind).not.toContain('data-delivered-receipt=');
      // Nor its box — and an old link's `?receipt=` narrows none of them: both rows are there.
      expect(html, kind).not.toContain(`aria-label="${NUMBER}"`);
      expect(html, kind).toContain('data-shipment-log="s-confirmed"');
      expect(html, kind).toContain('data-shipment-log="s-awaiting"');
    }
    // The board of this screen: the column, and the box narrowing by it.
    const delivered = renderBoard('delivered');
    expect(headersOf(delivered)).toContain(NUMBER);
    expect(delivered).toContain('data-shipment-log="s-confirmed"');
    expect(delivered).not.toContain('data-shipment-log="s-awaiting"');
    expect(BOARD).toContain("(column.key !== 'receiptNumber' || delivered) &&");
  });

  it('filters by «رقم الإيصال» — its box after «ملاحظات», a fragment of the number, folded', () => {
    const html = render({ query: 'receipt=1001' });
    const bar = html.slice(html.indexOf('data-shipment-filters'), html.indexOf('<table'));
    expect(bar).toContain(`aria-label="${NUMBER}"`);
    expect(bar).toContain(`placeholder="${NUMBER}"`);
    expect(bar).toContain('value="1001"');
    // The last box, after the notes', as its column is the last with words in it.
    expect(bar.indexOf(`aria-label="${ar('operations.shipment.notes')}"`)).toBeLessThan(
      bar.indexOf(`aria-label="${NUMBER}"`),
    );
    expect(bar.slice(bar.indexOf(`aria-label="${NUMBER}"`))).not.toContain('<input');
    expect(html).toContain('data-shipment-log="s-confirmed"');
    for (const id of ['s-awaiting', 's-secured', 's-secured-awaiting'])
      expect(html).not.toContain(`data-shipment-log="${id}"`);
    // Typed on an Arabic keyboard, its hyphen left out.
    const arabic = render({ query: `receipt=${encodeURIComponent('rc ٣٠٠٣')}` });
    expect(arabic).toContain('data-shipment-log="s-secured"');
    expect(arabic).not.toContain('data-shipment-log="s-confirmed"');
    // In English too.
    expect(render({ locale: 'en' })).toContain('placeholder="Receipt no."');
    // Round 33 C critic — its boxes name themselves for the bar's shares by their words; no other
    // board's boxes do.
    for (const name of ['bank', 'origin', 'destination', 'area', 'captain', 'notes', 'receipt'])
      expect(bar).toContain(`data-bar-box="${name}"`);
    for (const kind of ['shipments', 'secured', 'vault'] as const)
      expect(renderBoard(kind), kind).not.toContain('data-bar-box');
    // Round 33 C critic — read from the address (a reload keeps it), never remembered across
    // visits: a number looked up last week would hide every row awaiting its ✓ today.
    expect(PAGE).toMatch(/'confirmed',\s*'notes',\s*\] as const;/);
    expect(PAGE.slice(PAGE.indexOf('const REMEMBERED_FILTERS'))).not.toMatch(
      /^const REMEMBERED_FILTERS = \[[^\]]*'receipt'/,
    );
  });
});
