// «اعملى ايقون اقدر اجيب منه اللى اتمسح» — the history's deleted shipments, rendered against the
// real Arabic catalog and a real store and query client: the toolbar icon with its count, and each
// deleted shipment as the board shows a row — van, bank, من → إلى, the money in the board's
// currency order, captain, day — with when and by whom it was deleted, «السجل» for everyone and
// «استرجاع» only for whoever may delete (the grant that takes a shipment off brings it back).
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type Locale,
  type MeDto,
  type OperationsCurrencyDto,
  type OperationsDeletedShipmentDto,
  type OperationsDeletedShipmentsDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatNumber } from '../../../shared/lib/format';
import { __deletedShipmentsKey } from '../api/operations-queries';
import { DeletedShipmentsControl, DeletedShipmentsList } from './DeletedShipments';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

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

const render = (node: JSX.Element, permissions: string[] = [], qc = new QueryClient()): string => {
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
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </Provider>,
  );
};

const currency = (id: string, code: string, name: string): OperationsCurrencyDto => ({
  id,
  code,
  name,
  legacyAliases: [],
  // Nobody has dragged this catalog: its codes decide the order («1», «2», «3»).
  sortOrder: null,
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
// The production catalog's shape: legacy numbers as codes.
const CATALOG = [
  currency('egp', '1', 'مصري'),
  currency('usd', '2', 'دولار'),
  currency('eur', '3', 'يورو'),
];
const currencyOf = (id: string) => CATALOG.find((c) => c.id === id);
const BANKS: Record<string, string> = { 'b-ahly': 'الأهلي', 'b-misr': 'مصر' };
const bankNameOf = (id: string): string => BANKS[id] ?? '';

const side = (name: string, bankId: string) => ({
  id: name,
  name,
  code: 'X',
  bankId,
  bankName: BANKS[bankId] ?? '',
});

const deletedRow = (
  id: string,
  over: Partial<OperationsDeletedShipmentDto> = {},
): OperationsDeletedShipmentDto => ({
  id,
  shipmentType: 'daily',
  status: 'draft',
  mainBankId: 'b-ahly',
  secondaryBankId: null,
  originBranchId: 'o',
  destinationBranchId: 'd',
  areaName: 'الجيزة',
  // Stored in an order the board does not read them in: the euro first.
  lines: [
    { currencyId: 'eur', amount: 30_000 },
    { currencyId: 'usd', amount: 50_000 },
    { currencyId: 'egp', amount: 1_200_000 },
  ],
  collectionDate: '2026-11-10T00:00:00.000Z',
  deliveryDate: null,
  receiptNumber: null,
  vaultReceiptNumber: null,
  receiptImage: null,
  serialTracked: false,
  notes: null,
  receivedById: null,
  receivedAt: null,
  version: 1,
  createdAt: '2026-11-10T06:00:00.000Z',
  updatedAt: '2026-11-10T12:00:00.000Z',
  origin: side('المعادي', 'b-ahly'),
  destination: side('الدقي', 'b-ahly'),
  crew: {
    crewAssignmentId: 'cr-207',
    vehicleId: 'v-207',
    vehicleCode: '207',
    captainEmployeeId: 'c1',
    captainName: 'محمود حسن عبد الله',
    captainCode: 'BR100',
    captainPhone: null,
    captainBranchId: null,
  },
  captainDeliveredAt: null,
  // A daily row has no secured stage; the secured one below says where it stood.
  securedStage: null,
  captainPickedUpAt: null,
  deletedAt: '2026-11-10T12:05:00.000Z',
  deletedByName: 'منى عبد الرحمن',
  ...over,
});

const ROWS = [
  deletedRow('d-1'),
  deletedRow('d-2', {
    shipmentType: 'secured',
    status: 'dispatched',
    mainBankId: 'b-misr',
    collectionDate: '2026-11-06T00:00:00.000Z',
    deliveryDate: '2026-11-09T00:00:00.000Z',
    lines: [{ currencyId: 'egp', amount: 3_000_000 }],
    origin: side('وسط البلد', 'b-misr'),
    destination: side('الزمالك', 'b-misr'),
    crew: null,
    securedStage: 'dispatched',
    captainPickedUpAt: '2026-11-06T08:10:00.000Z',
    deletedAt: '2026-11-09T21:45:00.000Z',
    deletedByName: null,
  }),
];

const list = (canRestore: boolean, restoringId: string | null = null): string =>
  render(
    <DeletedShipmentsList
      rows={ROWS}
      bankNameOf={bankNameOf}
      currencyOf={currencyOf}
      locale="ar"
      canRestore={canRestore}
      restoringId={restoringId}
      onLog={() => undefined}
      onRestore={() => undefined}
    />,
  );

/** One card's markup. */
const cardOf = (html: string, id: string): string => {
  const start = html.indexOf(`data-deleted-shipment="${id}"`);
  const next = html.indexOf('data-deleted-shipment=', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
};

describe('a deleted shipment reads as the board reads its row', () => {
  const html = list(true);
  const daily = cardOf(html, 'd-1');

  it('lists them in the server’s order — newest deleted first', () => {
    expect([...html.matchAll(/data-deleted-shipment="([\w-]+)"/g)].map((m) => m[1])).toEqual([
      'd-1',
      'd-2',
    ]);
  });

  it('shows the van, the bank, من → إلى and the captain', () => {
    expect(daily).toContain('>207<');
    expect(daily).toContain('الأهلي');
    expect(daily).toContain('المعادي');
    expect(daily).toContain('الدقي');
    expect(daily.indexOf('المعادي')).toBeLessThan(daily.indexOf('الدقي'));
    expect(daily).toContain('محمود حسن عبد الله');
    expect(daily).toContain(ar('operations.board.vehicle'));
    expect(daily).toContain(ar('operations.board.captain'));
  });

  it('shows the money in the catalog’s order — here its codes: مصري «1», دولار «2», يورو «3»', () => {
    const egp = daily.indexOf('مصري');
    const usd = daily.indexOf('دولار');
    const eur = daily.indexOf('يورو');
    expect(egp).toBeGreaterThan(-1);
    expect(egp).toBeLessThan(usd);
    expect(usd).toBeLessThan(eur);
    expect(daily).toContain('1,200,000');
    expect(daily).toContain('50,000');
  });

  it('dates a daily shipment by its collection day, and a secured one by both its days', () => {
    expect(daily).toContain('2026-11-10');
    const secured = cardOf(html, 'd-2');
    expect(secured).toContain('2026-11-06');
    expect(secured).toContain('2026-11-09');
    expect(secured).toContain(ar('operations.shipment.type.secured'));
    // No crew yet: the board's dash.
    expect(secured).toMatch(/>—</);
  });

  it('says when and by whom it was deleted, the Cairo hour in Latin digits', () => {
    const by = daily.slice(daily.indexOf('data-deleted-by'));
    expect(by).toContain('حُذفت في ');
    expect(by).toMatch(/<bdi dir="ltr"[^>]*>2026-11-10 14:05<\/bdi> بواسطة منى عبد الرحمن/);
    // Unknown deleter: the sentence without a name. 21:45Z is the next Cairo day.
    const secured = cardOf(html, 'd-2');
    expect(secured).toMatch(/حُذفت في <bdi dir="ltr"[^>]*>2026-11-09 23:45<\/bdi>/);
    expect(secured).not.toContain('بواسطة');
  });
});

describe('what may be done with a deleted shipment', () => {
  it('opens its log for everyone', () => {
    const html = list(false);
    expect(html).toContain('data-deleted-log="d-1"');
    expect(html).toContain('data-deleted-log="d-2"');
    expect(html).toContain(ar('operations.shipment.deletedList.log'));
  });

  it('offers «استرجاع» only to whoever may delete', () => {
    expect(list(true)).toContain('data-deleted-restore="d-1"');
    expect(list(true)).toContain(ar('operations.shipment.deletedList.restore'));
    expect(list(false)).not.toContain('data-deleted-restore');
  });

  it('holds the button of the row being restored, and that row’s alone', () => {
    const html = list(true, 'd-2');
    expect(html).toMatch(/<button[^>]*data-deleted-restore="d-2"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*data-deleted-restore="d-2"[^>]*aria-busy="true"/);
    expect(html).not.toMatch(/<button[^>]*data-deleted-restore="d-1"[^>]*disabled=""/);
  });

  it('says nothing was deleted, rather than an empty frame', () => {
    const html = render(
      <DeletedShipmentsList
        rows={[]}
        bankNameOf={bankNameOf}
        currencyOf={currencyOf}
        locale="ar"
        canRestore
        restoringId={null}
        onLog={() => undefined}
        onRestore={() => undefined}
      />,
    );
    expect(html).toContain(ar('operations.shipment.deletedList.empty'));
    expect(html).not.toContain('data-deleted-shipments-list');
  });
});

describe('the toolbar icon', () => {
  const range = { from: '2026-11-01', to: '2026-11-11' };
  const answer: OperationsDeletedShipmentsDto = {
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-11T00:00:00.000Z',
    shipments: ROWS,
    crews: [],
  };
  const control = (enabled: boolean, seeded: OperationsDeletedShipmentsDto | null): string => {
    const qc = new QueryClient();
    if (seeded !== null) qc.setQueryData(__deletedShipmentsKey(range), seeded);
    return render(
      <DeletedShipmentsControl
        range={range}
        enabled={enabled}
        bankNameOf={bankNameOf}
        currencyOf={currencyOf}
      />,
      ['operationsShipment.view'],
      qc,
    );
  };

  it('counts the range’s deleted shipments on its corner, and names the count', () => {
    const html = control(true, answer);
    const button = html.match(/<button[^>]*data-deleted-shipments="true"[^>]*>/)?.[0] ?? '';
    expect(button).toContain(
      `aria-label="${ar('operations.shipment.deletedList.openCount', { count: formatNumber(2, 'ar') })}"`,
    );
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).not.toContain('disabled=""');
    expect(html).toContain('data-deleted-count="2"');
  });

  it('shows no count when nothing was deleted', () => {
    const html = control(true, { ...answer, shipments: [] });
    expect(html).not.toContain('data-deleted-count');
    expect(html).toContain(`aria-label="${ar('operations.shipment.deletedList.open')}"`);
  });

  it('waits, disabled and saying why, while the page’s range is one the server would refuse', () => {
    const html = control(false, answer);
    expect(html).toMatch(/<button[^>]*data-deleted-shipments="true"[^>]*disabled=""/);
    expect(html).toContain(ar('operations.shipment.deletedList.unavailable'));
    expect(html).not.toContain('data-deleted-count');
  });

  it('opens nothing until clicked', () => {
    expect(control(true, answer)).not.toContain('data-deleted-shipments-dialog');
  });
});
