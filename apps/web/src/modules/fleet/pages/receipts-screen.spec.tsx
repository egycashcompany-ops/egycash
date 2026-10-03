// The receipts screen (خصم الإيصالات) and the custody ledger (العهدة), proven against what they
// produce: the totals between the filters and the table, the card or the fund as the source of a
// row, the modal that asks the kind first, and the ledger's per-car summary with its grand total.
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
  type FleetCustodyMovementDto,
  type FleetCustodySummaryDto,
  type FleetFuelCardDto,
  type FleetVehicleDto,
  type FleetReceiptDto,
  type FleetReceiptTotalsDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { detailKey, listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { ReceiptsPage } from './ReceiptsPage';
import { CustodyPage } from './CustodyPage';
import { ReceiptDialog } from '../components/ReceiptDialog';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const FORM = readFileSync(join(HERE, '../components/ReceiptDialog.tsx'), 'utf8');
const CELL = readFileSync(join(HERE, '../components/ReceiptImageCell.tsx'), 'utf8');
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

const receipt = (over: Partial<FleetReceiptDto> = {}): FleetReceiptDto => ({
  id: 'r-1',
  date: '2026-10-01T00:00:00.000Z',
  vehicleId: 'v-204',
  vehicleCode: '204',
  driverEmployeeId: null,
  driverName: 'أيمن حسن مصطفى',
  kind: 'fuel',
  source: 'card',
  cardId: 'c-1',
  cardCompany: 'wataniya',
  cardNumber: '7045 1120 0098 2231',
  fuelType: 'petrol92',
  pricePerLitre: 17.25,
  litres: 37.1,
  amount: 640,
  image: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const receiptTotals: FleetReceiptTotalsDto = {
  count: 5,
  custodyTotal: 2020,
  cardTotal: 1440,
  fuelTotal: 1940,
  fuelLitres: 115.74,
  tyresTotal: 1400,
  washTotal: 120,
};

const RECEIPT_FILTERS = {
  from: undefined,
  to: undefined,
  vehicleCodes: undefined,
  kind: undefined,
  source: undefined,
  driver: undefined,
};
const CUSTODY_FILTERS = {
  from: undefined,
  to: undefined,
  vehicleCodes: undefined,
  source: undefined,
  driver: undefined,
};

const custodySummary: FleetCustodySummaryDto = {
  count: 5,
  total: 4220,
  dealership: 850,
  fuel: 1850,
  tyres: 1400,
  wash: 120,
  vehicles: [
    {
      vehicleId: 'v-204',
      vehicleCode: '204',
      dealership: 0,
      fuel: 1350,
      tyres: 0,
      wash: 0,
      total: 1350,
    },
    {
      vehicleId: 'v-63',
      vehicleCode: '63',
      dealership: 850,
      fuel: 0,
      tyres: 0,
      wash: 0,
      total: 850,
    },
  ],
};
const movement = (over: Partial<FleetCustodyMovementDto> = {}): FleetCustodyMovementDto => ({
  id: 'r-2',
  ref: 'receipt',
  source: 'fuel',
  date: '2026-10-01T00:00:00.000Z',
  vehicleId: 'v-204',
  vehicleCode: '204',
  driverEmployeeId: null,
  driverName: 'أيمن حسن مصطفى',
  fuelType: 'petrol92',
  detail: null,
  amount: 1350,
  ...over,
});

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
const client = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
const mount = (qc: QueryClient, permissions: string[], path: string, page: JSX.Element): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path} element={page} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const renderReceipts = ({
  permissions = [
    'fleetReceipt.view',
    'fleetReceipt.create',
    'fleetReceipt.edit',
    'fleetReceipt.delete',
  ],
  rows = [receipt()],
}: { permissions?: string[]; rows?: FleetReceiptDto[] } = {}): string => {
  const qc = client();
  qc.setQueryData(
    listKey('fleet', 'receipts', {
      ...RECEIPT_FILTERS,
      page: 1,
      pageSize: 25,
      sortBy: 'date',
      sortDir: 'desc',
      sort: 'date:desc',
    }),
    { items: rows, meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 } },
  );
  qc.setQueryData(
    listKey('fleet', 'receipts', { summary: true, ...RECEIPT_FILTERS }),
    receiptTotals,
  );
  return mount(qc, permissions, '/fleet/receipts', <ReceiptsPage />);
};

const renderCustody = (rows: FleetCustodyMovementDto[] = [movement()]): string => {
  const qc = client();
  qc.setQueryData(
    listKey('fleet', 'custody', { summary: true, ...CUSTODY_FILTERS }),
    custodySummary,
  );
  qc.setQueryData(listKey('fleet', 'custody', { ...CUSTODY_FILTERS, page: 1, pageSize: 25 }), {
    items: rows,
    meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
  });
  return mount(qc, ['fleetCustody.view'], '/fleet/custody', <CustodyPage />);
};

/** The table row holding `text` — searched from the body, past the filter options and the totals. */
const rowWith = (html: string, text: string, from = 0): string => {
  const body = html.indexOf('<tbody', from);
  const at = html.indexOf(text, body);
  expect(at, `a row holding «${text}»`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
};

describe('the receipts table', () => {
  it('shows a fuel receipt taken off a card with the company’s logo and the card’s last digits', () => {
    const html = renderReceipts();
    const row = rowWith(html, '640.00');
    expect(row).toContain('data-fuel-company="wataniya"');
    expect(row).toContain('•••• 2231');
    expect(row).toContain(ar('fleet.receipts.kind.fuel'));
    expect(row).toContain(ar('fleet.receipts.fuelType.petrol92'));
    expect(row).toContain('37.10');
    expect(row).toContain('أيمن حسن مصطفى');
  });

  it('says «العهدة» on a receipt the fund paid, and shows no litres on tyres', () => {
    const html = renderReceipts({
      rows: [
        receipt({
          id: 'r-3',
          kind: 'tyres',
          source: 'custody',
          cardId: null,
          cardCompany: null,
          cardNumber: null,
          fuelType: null,
          pricePerLitre: null,
          litres: null,
          amount: 1400,
        }),
      ],
    });
    const row = rowWith(html, '1,400.00');
    expect(row).toContain(ar('fleet.receipts.source.custody'));
    expect(row).toContain(ar('fleet.receipts.kind.tyres'));
    expect(row).not.toContain('data-fuel-company=');
  });

  it('puts the totals BETWEEN the filters and the table — the fund, the cards, fuel with its litres', () => {
    const html = renderReceipts();
    const filters = html.indexOf('data-date-caption="from"');
    const strip = html.indexOf('2,020.00');
    const table = html.indexOf('<table');
    expect(filters).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(filters);
    expect(table).toBeGreaterThan(strip);
    expect(html).toContain(ar('fleet.receipts.totals.custody'));
    expect(html).toContain('1,440.00');
    expect(html).toContain('115.74');
  });

  it('offers print and Excel as icons in the page header, and «إيصال جديد» to whoever may create', () => {
    const html = renderReceipts();
    expect(html).toContain('data-print="receipts"');
    expect(html).toContain('data-export="receipts"');
    expect(html).toContain('data-receipt-new="true"');
    const viewer = renderReceipts({ permissions: ['fleetReceipt.view'] });
    expect(viewer).not.toContain('data-receipt-new=');
    expect(viewer).not.toContain('data-receipt-edit=');
    expect(viewer).not.toContain('data-receipt-delete=');
    expect(viewer).not.toContain(ar('fleet.receipts.image.upload'));
  });

  it('carries the image column exactly as the vehicle licence does — upload, then view / print / delete', () => {
    const none = renderReceipts();
    expect(none).toContain(ar('fleet.receipts.image.upload'));
    const has = renderReceipts({
      rows: [
        receipt({
          image: { fileId: 'f-1', fileName: 'a.jpg', mime: 'image/jpeg', size: 1, uploadedAt: '' },
        }),
      ],
    });
    expect(has).toContain('data-receipt-print="r-1"');
    expect(has).toContain('data-receipt-image-delete="r-1"');
    expect(CELL).toContain('LICENSE_IMAGE_ACCEPT');
    expect(CELL).toContain('printLicenceRecord(');
  });
});

describe('the receipt modal', () => {
  it('asks the kind first — «وقود / كاوتش / غسيل» — and takes a card only for fuel', () => {
    expect(FORM).toContain('<KindSwitch value={kind} onChange={setKind} />');
    expect(FORM).toContain('const byCard = isFuel && useCard && !noCards;');
    expect(FORM).toContain('cardId: byCard ? cardId : null,');
    expect(FORM).toContain('fuelType: isFuel ? fuelType : null,');
    expect(FORM).toContain('disabled={!isFuel || noCards}');
  });

  it('reads the driver off the daily roster for the date and the car, and lets the clerk type over it', () => {
    expect(FORM).toContain("useRosterDay(open && row === null && vehicleId !== '' ? date : '')");
    expect(FORM).toContain('line?.driver1EmployeeId');
    expect(FORM).toContain('if (!driverTouched && rosterDriver !== null) setDriver(rosterDriver);');
    expect(FORM).toContain('list="receipt-drivers"');
  });

  it('prices the litres from the fleet settings and shows what the card was and becomes', () => {
    expect(FORM).toContain('FLEET_FUEL_PRICE_KEY[fuelType]');
    expect(FORM).toContain(
      "kind === 'fuel' && amountOk && price > 0 ? round(value / price) : null",
    );
    expect(FORM).toContain("t('fleet.receipts.summary.card', {");
    expect(FORM).toContain('const after = card === null ? 0 : round(before - value);');
  });

  it('offers every car — the whole registry — and uploads the photo with the receipt', () => {
    // Every car-code box in Fleet offers the whole registry now; the receipt asks for every status.
    expect(FORM).toMatch(/<VehicleCodeCombobox[\s\S]*?anyStatus/u);
    expect(FORM).toContain('if (file !== null) await upload.mutateAsync({ id: saved.id, file });');
  });
});

describe('the custody ledger', () => {
  it('sums the fund by source between the filters and the tables', () => {
    const html = renderCustody();
    const filters = html.indexOf('data-date-caption="from"');
    const strip = html.indexOf('4,220.00');
    const table = html.indexOf('<table');
    expect(strip).toBeGreaterThan(filters);
    expect(table).toBeGreaterThan(strip);
    expect(html).toContain(ar('fleet.custody.totals.dealership'));
    expect(html).toContain('1,850.00');
    expect(html).toContain('1,520.00');
  });

  it('shows «ملخص لكل سيارة» with a grand-total row, then every movement with where it came from', () => {
    const html = renderCustody([
      movement(),
      movement({
        id: 'd-1',
        ref: 'dealershipInvoice',
        source: 'dealership',
        vehicleId: 'v-63',
        vehicleCode: '63',
        driverName: null,
        fuelType: null,
        detail: 'إصلاح',
        amount: 850,
      }),
    ]);
    const perVehicle = html.indexOf('data-custody-per-vehicle="true"');
    const movements = html.indexOf('data-custody-movements="true"');
    expect(perVehicle).toBeGreaterThan(-1);
    expect(movements).toBeGreaterThan(perVehicle);
    const total = rowWith(html, ar('fleet.custody.grandTotal'), perVehicle);
    expect(total).toContain('4,220.00');
    expect(total).toContain('850.00');
    const bill = rowWith(html, ar('fleet.custody.from.dealershipInvoice'), movements);
    expect(bill).toContain('63');
    expect(bill).toContain('إصلاح');
    const fuel = rowWith(html, ar('fleet.custody.from.receipt'), movements);
    expect(fuel).toContain(ar('fleet.receipts.fuelType.petrol92'));
    expect(fuel).toContain('أيمن حسن مصطفى');
    expect(html).toContain('data-print="custody"');
    expect(html).toContain('data-export="custody"');
  });
});

describe('the card after a car is picked — «هل فى كارت واحد على العربيه او اتنين او مفيش»', () => {
  const fuelCard = (over: Partial<FleetFuelCardDto>): FleetFuelCardDto =>
    ({
      id: 'c-1',
      vehicleId: 'v-160',
      vehicleCode: '160',
      company: 'wataniya',
      name: 'كارت وطنية 160',
      number: '7045 1120 0098 4410',
      expiresAt: '2099-01-01T00:00:00.000Z',
      hasPassword: false,
      balance: 1200,
      requestedAmount: null,
      requestedAt: null,
      lastChargedAt: null,
      version: 0,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      ...over,
    }) as FleetFuelCardDto;

  /** The modal open on a fuel receipt of car 160, the car's cards already read. */
  const openOn = (cards: FleetFuelCardDto[], over: Partial<FleetReceiptDto> = {}): string => {
    const qc = client();
    qc.setQueryData(detailKey('fleet', 'vehicles', 'v-160'), {
      id: 'v-160',
      code: '160',
    } as FleetVehicleDto);
    qc.setQueryData(listKey('fleet', 'fuelCards', { whole: true, vehicleCodes: ['160'] }), {
      items: cards,
      meta: { page: 1, pageSize: 100, totalItems: cards.length, totalPages: 1 },
    });
    const row = receipt({
      vehicleId: 'v-160',
      vehicleCode: '160',
      cardId: null,
      cardCompany: null,
      cardNumber: null,
      amount: 500,
      ...over,
    });
    return mount(
      qc,
      ['fleetReceipt.view', 'fleetReceipt.edit'],
      '/fleet/receipts',
      <ReceiptDialog open onClose={() => undefined} row={row} />,
    );
  };

  it('never asks for a car once one is picked', () => {
    const html = openOn([fuelCard({})], { cardId: 'c-1' });
    expect(html).not.toContain(ar('fleet.receipts.fields.pickCar'));
  });

  it('one card: shows it and says what it was and becomes', () => {
    const html = openOn([fuelCard({})], { cardId: 'c-1' });
    expect(html).toContain('data-receipt-card="c-1"');
    expect(html).toContain('data-receipt-summary="card"');
    expect(html).toContain('1,200.00');
  });

  it('two cards and none picked: shows both and asks which one, in amber', () => {
    const html = openOn([
      fuelCard({}),
      fuelCard({ id: 'c-2', company: 'chillout', number: '5522 8810 3340 1177' }),
    ]);
    expect(html).toContain('data-receipt-card="c-1"');
    expect(html).toContain('data-receipt-card="c-2"');
    expect(html).toContain('data-receipt-summary="pickCard"');
    expect(html).toContain(ar('fleet.receipts.summary.pickCard'));
    expect(html).toContain('bg-amber-50');
  });

  it('no card: says so, turns the tick off and locks it, and the fund pays', () => {
    const html = openOn([]);
    expect(html).toContain('data-receipt-cards="none"');
    expect(html).toContain(ar('fleet.receipts.fields.noCardCustody'));
    expect(html).toContain('data-receipt-source="custody"');
    expect(html).toContain('data-receipt-summary="custody"');
    const tick = html.slice(
      html.indexOf('data-receipt-use-card'),
      html.indexOf('data-receipt-use-card') + 400,
    );
    expect(tick).toContain('disabled');
    expect(html).not.toContain(ar('fleet.receipts.fields.pickCar'));
  });

  it('only another car’s cards in hand: still LOADING, never «no cards»', () => {
    const qc = client();
    qc.setQueryData(detailKey('fleet', 'vehicles', 'v-160'), {
      id: 'v-160',
      code: '160',
    } as FleetVehicleDto);
    const html = mount(
      qc,
      ['fleetReceipt.view', 'fleetReceipt.edit'],
      '/fleet/receipts',
      <ReceiptDialog
        open
        onClose={() => undefined}
        row={receipt({ vehicleId: 'v-160', vehicleCode: '160', cardId: 'c-1' })}
      />,
    );
    expect(html).toContain('data-receipt-cards="loading"');
    expect(html).toContain('data-receipt-summary="loading"');
    expect(html).not.toContain(ar('fleet.receipts.fields.noCards'));
  });
});
