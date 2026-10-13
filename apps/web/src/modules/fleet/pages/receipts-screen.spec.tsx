// The receipts screen (خصم الإيصالات) and the custody ledger (العهدة), proven against what they
// produce: the totals between the filters and the table (behind «الإحصائيات»), the card or the
// fund as the source of a row, the modal that asks the kind first, and the ledger's per-car
// summary with its grand total.
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
import { formatNumber } from '../../../shared/lib/format';
import { ReceiptFigures, ReceiptsPage } from './ReceiptsPage';
import { CustodyPage } from './CustodyPage';
import { CustodyFigures } from '../components/CustodyFigures';
import { CUSTODY_KIND } from '../components/CustodyKinds';
import { ALARMS_CODE_TYPE, ALARMS_TYPE } from './MaintenanceAlarmsPage';
import { DEFAULT_FUEL_TYPE, ReceiptDialog } from '../components/ReceiptDialog';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, 'ReceiptsPage.tsx'), 'utf8');
const CUSTODY = readFileSync(join(HERE, 'CustodyPage.tsx'), 'utf8');
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
  // The car's own card unless a test says otherwise.
  cardVehicleId: over.vehicleId ?? 'v-204',
  cardVehicleCode: over.vehicleCode ?? '204',
  cardLabel: null,
  fuelType: 'petrol92',
  pricePerLitre: 17.25,
  litres: 37.1,
  amount: 640,
  odometer: null,
  company: null,
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
  fundTotal: 0,
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
  company: null,
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
const mount = (
  qc: QueryClient,
  permissions: string[],
  path: string,
  page: JSX.Element,
  search = '',
): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`${path}${search}`]}>
          <Routes>
            <Route path={path} element={page} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

/** One row of Fleet's people list — the shape `/fleet/people` answers with. */
const person = (employeeId: string, code: string, fullNameAr: string) => ({
  employeeId,
  code,
  fullNameAr,
  status: 'active' as const,
  branchId: null,
  address: null,
  governorate: null,
  phone: null,
  hiredAt: null,
});

const renderReceipts = ({
  permissions = [
    'fleetReceipt.view',
    'fleetReceipt.create',
    'fleetReceipt.edit',
    'fleetReceipt.delete',
  ],
  rows = [receipt()],
  people,
}: {
  permissions?: string[];
  rows?: FleetReceiptDto[];
  people?: ReturnType<typeof person>[];
} = {}): string => {
  const qc = client();
  if (people !== undefined) qc.setQueryData(['fleet', 'people'], people);
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

const renderCustody = (
  rows: FleetCustodyMovementDto[] = [movement()],
  {
    permissions = ['fleetCustody.view'],
    people,
    search = '',
  }: { permissions?: string[]; people?: ReturnType<typeof person>[]; search?: string } = {},
): string => {
  const qc = client();
  if (people !== undefined) qc.setQueryData(['fleet', 'people'], people);
  qc.setQueryData(
    listKey('fleet', 'custody', { summary: true, ...CUSTODY_FILTERS }),
    custodySummary,
  );
  qc.setQueryData(
    listKey('fleet', 'custody', {
      ...CUSTODY_FILTERS,
      page: 1,
      pageSize: 25,
      sortBy: 'date',
      sortDir: 'desc',
      sort: 'date:desc',
    }),
    {
      items: rows,
      meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
    },
  );
  return mount(qc, permissions, '/fleet/custody', <CustodyPage />, search);
};

/** A class string as the markup writes it — `&` and `>` escaped. */
const escapedClass = (cls: string): string => cls.replace(/&/g, '&amp;').replace(/>/g, '&gt;');

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

  it('puts the totals BETWEEN the filters and the table, behind «الإحصائيات» — the fund, the cards, fuel with its litres', () => {
    const html = renderReceipts();
    // The figures open from the toolbar's toggle, as on the vehicles and drivers boards.
    expect(html).toContain('data-receipt-stats-toggle="true"');
    expect(html, 'closed on the way in').not.toContain('data-receipt-figures');
    expect(html).toContain('data-date-caption="from"');
    const filters = PAGE.indexOf('DARK_FILTER_BAR, ');
    const strip = PAGE.indexOf('<ReceiptFigures totals={summary.data} />');
    const table = PAGE.indexOf('<DataTable');
    expect(filters).toBeGreaterThan(-1);
    expect(strip, 'after the filters').toBeGreaterThan(filters);
    expect(table, 'before the table').toBeGreaterThan(strip);
    expect(PAGE).toContain('useReceiptSummary(filters)');
    // Opened, they are the server's sums: the fund, the cards, fuel with its litres, tyres + wash.
    const figures = mount(
      client(),
      ['fleetReceipt.view'],
      '/fleet/receipts',
      <ReceiptFigures totals={receiptTotals} />,
    );
    expect(figures).toContain('data-receipt-figures="true"');
    expect(figures).toContain(ar('fleet.receipts.totals.custody'));
    expect(figures).toContain('2,020.00');
    expect(figures).toContain(ar('fleet.receipts.totals.card'));
    expect(figures).toContain('1,440.00');
    expect(figures).toContain(ar('fleet.receipts.totals.fuel'));
    expect(figures).toContain('1,940.00');
    expect(figures).toContain('115.74');
    expect(figures).toContain(ar('fleet.receipts.totals.tyresWash'));
    expect(figures).toContain('1,520.00');
  });

  it('writes the row as the drivers board does — a year-first Latin date, the code bold, figures grouped, every value centred', () => {
    const html = renderReceipts({
      rows: [receipt({ litres: 1037.1, amount: 17890 })],
    });
    const row = rowWith(html, '17,890.00');
    // «2026/10/01» — year first, slashes, Latin digits — never the Arabic-Indic «١ أكتوبر ٢٠٢٦».
    expect(row).toContain('2026/10/01');
    expect(row, 'no Arabic-Indic digit on the row').not.toMatch(/[٠-٩]/u);
    // Litres grouped with a comma, two decimals; the money keeps its formatter («ج.م.»).
    expect(row).toContain('1,037.10');
    expect(row).toContain('ج.م');
    // The car's code bold, left to right.
    expect(row).toMatch(/<span dir="ltr" class="[^"]*font-bold[^"]*">204<\/span>/u);
    // Every value and header centred, as on the drivers board; the actions at the row's end.
    const cells = row.match(/<td[^>]*>/gu) ?? [];
    expect(cells.length).toBe(10);
    for (const cell of cells.slice(0, 9)) expect(cell).toContain('text-center');
    expect(cells[9]).toContain('text-end');
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect((head.match(/<th[^>]*text-center/gu) ?? []).length).toBe(9);
    // An empty car is the boards' grey dash.
    const none = rowWith(renderReceipts({ rows: [receipt({ vehicleCode: null })] }), '640.00');
    expect(none).toContain('<span class="text-slate-400">—</span>');
  });

  it('draws the driver as the drivers board does — badge, name, code under it; a name the roster does not know, grey', () => {
    const known = renderReceipts({
      permissions: ['fleetReceipt.view', 'fleetDriver.view'],
      rows: [receipt({ driverEmployeeId: 'e-7', driverName: 'ابراهيم السيد رزق' })],
      people: [person('e-7', '0100765', 'ابراهيم السيد رزق')],
    });
    const row = rowWith(known, '640.00');
    expect(row).toContain('ابراهيم السيد رزق');
    // The code UNDER the name, never glued to its last letter.
    expect(row).toContain('0100765</span>');
    expect(row).not.toContain('رزق0100765');
    expect(row, 'the badge with the first letters').toContain('>اس</span>');
    expect(row).not.toContain('data-legacy-name');
    // A receipt whose driver was typed by hand: the name as written, grey, saying so.
    const typed = rowWith(renderReceipts(), '640.00');
    expect(typed).toContain('data-legacy-name="true"');
    expect(typed).toContain('أيمن حسن مصطفى');
    // Nobody at all: a dash.
    const nobody = rowWith(
      renderReceipts({ rows: [receipt({ driverEmployeeId: null, driverName: null })] }),
      '640.00',
    );
    expect(nobody).toContain('<span class="text-slate-400">—</span>');
    expect(PAGE).toContain(
      '<DriverCell employeeId={row.driverEmployeeId} name={row.driverName} />',
    );
    expect(PAGE).not.toContain('<DriverName ');
  });

  it('offers Excel and PDF in the toolbar above the filters, and «إيصال جديد» to whoever may create — no page title', () => {
    const html = renderReceipts();
    expect(html).toContain('data-print="receipts"');
    expect(html).toContain('data-export="receipts"');
    expect(html).toContain('data-receipt-new="true"');
    expect(PAGE).not.toContain('<PageHeader');
    expect(PAGE).not.toContain('<DocumentActions');
    expect(html.indexOf('data-export="receipts"'), 'above the filters').toBeLessThan(
      html.indexOf('data-date-caption="from"'),
    );
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

describe('«كارت اخر» and «كم» on the table and the sheets', () => {
  it('a card that is not on the receipt’s car says where it sits — «(كارت 160)», or its name on no car', () => {
    const html = renderReceipts({
      rows: [
        receipt({ id: 'own', amount: 101 }),
        receipt({
          id: 'other',
          amount: 102,
          cardId: 'c-160',
          cardNumber: '7045 1120 0098 7700',
          cardVehicleId: 'v-160',
          cardVehicleCode: '160',
        }),
        receipt({
          id: 'stock',
          amount: 103,
          cardId: 'c-s',
          cardNumber: '7045 1120 0098 5511',
          cardVehicleId: null,
          cardVehicleCode: null,
          cardLabel: 'سفر 1',
        }),
      ],
    });
    const own = rowWith(html, '101.00');
    expect(own).toContain('•••• 2231');
    expect(own, 'the car’s own card names no owner').not.toContain('data-receipt-card-owner');
    const other = rowWith(html, '102.00');
    expect(other).toContain('•••• 7700');
    expect(other).toContain(`(${ar('fleet.receipts.cardOf', { code: '160' })})`);
    expect(ar('fleet.receipts.cardOf', { code: '160' })).toBe('كارت 160');
    const stock = rowWith(html, '103.00');
    expect(stock).toContain('•••• 5511');
    expect(stock).toContain('(سفر 1)');
  });

  it('writes «كم» in a column of its own — grouped Latin digits, a dash when none was written', () => {
    const html = renderReceipts({
      rows: [
        receipt({ id: 'km', amount: 111, odometer: 154320 }),
        receipt({ id: 'no', amount: 112 }),
      ],
    });
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(head).toContain(ar('fleet.receipts.columns.odometer'));
    expect(ar('fleet.receipts.columns.odometer')).toBe('كم');
    // After the litres, before the image.
    expect(head.indexOf(ar('fleet.receipts.columns.litres'))).toBeLessThan(
      head.indexOf(ar('fleet.receipts.columns.odometer')),
    );
    expect(head.indexOf(ar('fleet.receipts.columns.odometer'))).toBeLessThan(
      head.indexOf(ar('fleet.receipts.columns.image')),
    );
    const written = rowWith(html, '111.00');
    expect(written).toContain('154,320');
    const cells = (rowWith(html, '112.00').match(/<td[^>]*>[\s\S]*?<\/td>/gu) ?? []).map((cell) =>
      cell.replace(/<[^>]+>/gu, ''),
    );
    expect(cells[7], 'no «كم»: the boards’ dash').toBe('—');
  });

  it('puts «كم» and the card’s owner in the Excel and the PDF too', () => {
    // The header both sheets share ends on «كم», and each row carries the receipt's own.
    const header = PAGE.slice(
      PAGE.indexOf('const header = ['),
      PAGE.indexOf('];', PAGE.indexOf('const header = [')),
    );
    expect(header).toContain("t('fleet.receipts.columns.odometer')");
    expect(PAGE).toContain("row.odometer ?? '',");
    expect(PAGE).toContain("row.odometer === null ? '—' : String(row.odometer),");
    // «الخصم من» on both sheets is `sourceLabel`, which names the card's owner as the table does.
    const label = PAGE.slice(PAGE.indexOf('const sourceLabel ='), PAGE.indexOf('/** «2026/10/01»'));
    expect(label).toContain(
      "receiptCardOwner(row, (code) => t('fleet.receipts.cardOf', { code }))",
    );
    expect(label).toContain('`${card} (${owner})`');
    expect(PAGE.match(/sourceLabel\(row\)/gu)?.length, 'the Excel and the PDF').toBe(2);
  });
});

describe('the receipt modal', () => {
  it('asks the kind first — «وقود / كاوتش / غسيل» — and takes a card only for fuel', () => {
    expect(FORM).toContain('<KindSwitch value={kind} onChange={changeKind} />');
    // A car with no card of its own pays from the fund — unless «كارت آخر» pays.
    expect(FORM).toContain('const byCard = isFuel && useCard && (other || !noCards);');
    expect(FORM).toContain('cardId: byCard ? cardId : null,');
    expect(FORM).toContain('fuelType: isFuel ? fuelType : null,');
    expect(FORM).toContain('disabled={!isFuel || (noCards && !other)}');
  });

  it('reads the driver off the daily roster for the date and the car, and lets the clerk type over it', () => {
    expect(FORM).toContain("useRosterDay(open && row === null && vehicleId !== '' ? date : '')");
    expect(FORM).toContain('line?.driver1EmployeeId');
    expect(FORM).toContain('if (!driverTouched && rosterDriver !== null) setDriver(rosterDriver);');
  });

  it('offers Fleet’s roster under the driver box as it is typed into — still a NAME, the id resolved from it', () => {
    // The browser's bare datalist is gone: the box is the roster combobox, drawn through the
    // form's own ruled `Input`.
    expect(FORM).not.toContain('<datalist');
    expect(FORM).not.toContain('list="receipt-drivers"');
    const at = FORM.indexOf('<DriverNameCombobox');
    expect(at, 'the driver box is the roster combobox').toBeGreaterThan(-1);
    const box = FORM.slice(at);
    const start = box.indexOf('input={(props) => (');
    expect(start, 'drawn through the combobox’s input render prop').toBeGreaterThan(-1);
    const input = box.slice(start, box.indexOf('/>', start));
    for (const prop of [
      '{...props}',
      'value={driver}',
      'setDriverTouched(true);',
      'setDriver(e.target.value);',
      "placeholder={t('fleet.receipts.fields.driverPlaceholder')}",
      'data-receipt-driver="true"',
      'rule="arabic"',
      'tone={box}',
    ]) {
      expect(input, `the driver box keeps ${prop}`).toContain(prop);
    }
    // A pick writes the NAME in and counts as the clerk's — the roster never overwrites it.
    expect(box).toMatch(
      /onChange=\{\(name\) => \{\s*setDriverTouched\(true\);\s*setDriver\(name\);/u,
    );
    // The value saved is the name; the employee id is the roster person of exactly that name.
    expect(FORM).toContain(
      '[...people.values()].find((p) => p.fullNameAr === typed)?.employeeId ?? null',
    );
    expect(FORM).toContain("driverName: driver.trim() === '' ? null : driver.trim(),");

    // Rendered: the receipt's name in the box, a combobox over the roster, Arabic-only.
    const qc = client();
    const html = mount(
      qc,
      ['fleetReceipt.view', 'fleetReceipt.edit'],
      '/fleet/receipts',
      <ReceiptDialog open onClose={() => undefined} row={receipt()} />,
    );
    const boxAt = html.lastIndexOf('<input', html.indexOf('data-receipt-driver="true"'));
    expect(boxAt, 'the form has its driver box').toBeGreaterThan(-1);
    const driverBox = html.slice(boxAt, html.indexOf('>', boxAt) + 1);
    expect(driverBox).toContain('role="combobox"');
    expect(driverBox).toContain('aria-autocomplete="list"');
    expect(driverBox).toContain('value="أيمن حسن مصطفى"');
    expect(driverBox).toContain('data-input-rule="arabic"');
    expect(driverBox).toContain(`placeholder="${ar('fleet.receipts.fields.driverPlaceholder')}"`);
    expect(html).not.toContain('<datalist');
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
    expect(FORM).toMatch(/<VehicleCodeCombobox(?:(?!\/>)[\s\S])*?\banyStatus\b/u);
    expect(FORM).toContain('const { photo } = await saveThenAttachPhoto(');
    expect(FORM).toContain('(id, picked) => upload.mutateAsync({ id, file: picked }),');
  });

  it('closes on a refused photo once the receipt is saved — a second Save would record it twice', () => {
    // The receipt has already taken its money off the card when the photo goes up: the form says
    // it is saved without its photo and closes, rather than stay open on the upload's error.
    const submit = FORM.slice(FORM.indexOf('const submit = async'));
    const body = submit.slice(0, submit.indexOf('\n  };'));
    expect(body).toContain('saveThenAttachPhoto(');
    expect(body).not.toContain('await upload.mutateAsync');
    expect(body).toContain(
      "if (photo === 'failed') toast.warning(t('fleet.receipts.image.notUploaded'));",
    );
    expect(body.indexOf('onClose();')).toBeGreaterThan(body.indexOf("photo === 'failed'"));
    expect(ar('fleet.receipts.image.notUploaded')).toContain('تم حفظ الإيصال');
  });

  it('keeps Save pressable and names what is missing — the card only when it pays', () => {
    expect(FORM).toContain('onClick={required.guard(submit)}');
    const rules = FORM.slice(FORM.indexOf('useRequiredFields('));
    const list = rules.slice(0, rules.indexOf(');'));
    for (const rule of [
      "ok: date !== ''",
      "ok: vehicleId !== ''",
      'ok: !byCard || card !== null',
      // More than the card holds is refused, and the line under the form still says so.
      'ok: amountOk && enough',
    ]) {
      expect(list, `the save requires ${rule}`).toContain(rule);
    }
    // The card is starred exactly when it pays, and turns red when it is missing.
    expect(FORM).toContain('required={byCard}');
    expect(FORM).toContain("missing={required.isMissing('card')}");
  });

  const dialog = (row: FleetReceiptDto | null): string =>
    mount(
      client(),
      ['fleetReceipt.view', 'fleetReceipt.create', 'fleetReceipt.edit'],
      '/fleet/receipts',
      <ReceiptDialog open onClose={() => undefined} row={row} />,
    );
  /** The `<option>` the fuel-type select shows picked. */
  const pickedFuel = (html: string): string | undefined => {
    const at = html.indexOf('data-receipt-fuel-type="true"');
    const select = html.slice(at, html.indexOf('</select>', at));
    return /<option value="(\w+)" selected=""/u.exec(select)?.[1];
  };

  it('«نوع الوقود (سولار افتراضى)»: a new receipt opens on diesel, an edit keeps the type it has', () => {
    expect(DEFAULT_FUEL_TYPE).toBe('diesel');
    expect(ar('fleet.receipts.fuelType.diesel')).toBe('سولار');
    expect(pickedFuel(dialog(null))).toBe('diesel');
    expect(pickedFuel(dialog(receipt({ fuelType: 'petrol92' })))).toBe('petrol92');
    expect(pickedFuel(dialog(receipt({ fuelType: 'petrol80' })))).toBe('petrol80');
  });

  it('«كم» sits beside the amount on fuel only — optional, whole Latin digits, the paste rules of every number box', () => {
    const fuel = dialog(receipt({ odometer: 154320 }));
    const at = fuel.lastIndexOf('<input', fuel.indexOf('data-receipt-odometer="true"'));
    expect(at, 'the fuel form has its «كم» box').toBeGreaterThan(-1);
    const box = fuel.slice(at, fuel.indexOf('>', at) + 1);
    expect(box).toContain('value="154320"');
    expect(box).toContain('data-input-rule="integer"');
    expect(box).toContain('dir="ltr"');
    // A ruled text box — a bare number input would empty itself on a letter, not refuse it.
    expect(box).not.toMatch(/\btype="(?:number)"/u);
    // Labelled «كم», never starred, right after the amount.
    expect(fuel).toContain(ar('fleet.receipts.fields.odometerHint'));
    expect(fuel.indexOf('data-receipt-amount="true"')).toBeLessThan(
      fuel.indexOf('data-receipt-odometer="true"'),
    );
    const field = FORM.slice(
      FORM.lastIndexOf('<DesignField', FORM.indexOf('data-receipt-odometer')),
    );
    expect(field.slice(0, field.indexOf('>'))).not.toContain('required');
    // A new receipt opens with it empty; tyres and washing have none at all.
    const fresh = dialog(null);
    const freshBox = fresh.slice(
      fresh.lastIndexOf('<input', fresh.indexOf('data-receipt-odometer="true"')),
    );
    expect(freshBox.slice(0, freshBox.indexOf('>'))).toContain('value=""');
    for (const kind of ['tyres', 'wash'] as const) {
      const html = dialog(
        receipt({ kind, source: 'custody', cardId: null, fuelType: null, litres: null }),
      );
      expect(html, kind).not.toContain('data-receipt-odometer');
    }
    // Leaving fuel clears it, and the save sends none off fuel or when empty.
    expect(FORM).toContain("if (next !== 'fuel') setOdometer('');");
    expect(FORM).toContain("odometer: isFuel && odometer !== '' ? Number(odometer) : null,");
  });
});

describe('«الشركة» on a fuel receipt the fund pays — «ومش عاوز اى داتا اجبارى»', () => {
  const fund = (over: Partial<FleetReceiptDto> = {}): FleetReceiptDto =>
    receipt({
      source: 'custody',
      cardId: null,
      cardCompany: null,
      cardNumber: null,
      cardVehicleId: null,
      cardVehicleCode: null,
      ...over,
    });
  const dialog = (row: FleetReceiptDto | null): string =>
    mount(
      client(),
      ['fleetReceipt.view', 'fleetReceipt.create', 'fleetReceipt.edit'],
      '/fleet/receipts',
      <ReceiptDialog open onClose={() => undefined} row={row} />,
    );
  /** The company choice the form shows picked, or `undefined` when it shows none. */
  const pickedCompany = (html: string): string | undefined =>
    /aria-checked="true" data-receipt-company="(\w+)"/u.exec(html)?.[1];

  it('reads «العهدة (شل أوت)» in «الخصم من» when the fund’s fuel names its company — plain «العهدة» when not', () => {
    expect(ar('fleet.receipts.source.custodyCompany', { company: 'شل أوت' })).toBe(
      'العهدة (شل أوت)',
    );
    const html = renderReceipts({
      rows: [
        fund({ id: 'chill', amount: 201, company: 'chillout' }),
        fund({ id: 'wat', amount: 202, company: 'wataniya' }),
        fund({ id: 'none', amount: 203, company: null }),
      ],
    });
    const named = (company: 'chillout' | 'wataniya'): string =>
      ar('fleet.receipts.source.custodyCompany', {
        company: ar(`fleet.fuelCards.company.${company}`),
      });
    expect(rowWith(html, '201.00')).toContain(named('chillout'));
    expect(rowWith(html, '202.00')).toContain(named('wataniya'));
    const plain = rowWith(html, '203.00');
    expect(plain).toContain(ar('fleet.receipts.source.custody'));
    expect(plain).not.toContain(`${ar('fleet.receipts.source.custody')} (`);
    // Both sheets write «الخصم من» through the same words as the table.
    const label = PAGE.slice(PAGE.indexOf('const sourceLabel ='), PAGE.indexOf('/** «2026/10/01»'));
    expect(label).toContain("if (row.source !== 'card') return custodySourceLabel(row, t);");
    expect(PAGE).toContain('<Badge tone="neutral">{custodySourceLabel(row, t)}</Badge>');
  });

  it('offers it on fuel the fund pays only — the two companies and «بدون شركة», never starred', () => {
    // A fund-paid fuel receipt opens on the company it names, or on «بدون شركة».
    const named = dialog(fund({ company: 'chillout' }));
    for (const choice of ['none', 'wataniya', 'chillout']) {
      expect(named, choice).toContain(`data-receipt-company="${choice}"`);
    }
    expect(pickedCompany(named)).toBe('chillout');
    expect(named).toContain(ar('fleet.receipts.fields.company'));
    expect(named).toContain(ar('fleet.receipts.fields.companyNone'));
    expect(pickedCompany(dialog(fund()))).toBe('none');
    // Off a card (the card names its company), on a new receipt that a card pays by default, and
    // on tyres and washing: no choice at all.
    expect(dialog(receipt())).not.toContain('data-receipt-company');
    expect(dialog(null)).not.toContain('data-receipt-company');
    for (const kind of ['tyres', 'wash'] as const) {
      expect(dialog(fund({ kind, fuelType: null, litres: null })), kind).not.toContain(
        'data-receipt-company',
      );
    }
    // Never required: not in the save's rules, not starred.
    const rules = FORM.slice(FORM.indexOf('useRequiredFields('));
    expect(rules.slice(0, rules.indexOf(');'))).not.toContain('company');
    const field = FORM.slice(FORM.lastIndexOf('<DesignField', FORM.indexOf('<CompanyPick')));
    expect(field.slice(0, field.indexOf('>'))).not.toContain('required');
    // Shown and sent only while the fund pays for fuel.
    expect(FORM).toContain('const fundFuel = isFuel && !byCard;');
    expect(FORM).toContain('{fundFuel && (');
    expect(FORM).toContain('company: fundFuel ? company : null,');
  });
});

describe('the custody ledger', () => {
  it('keeps the figures behind «الإحصائيات», between the filters and the tables — figure and «ج.م.» apart', () => {
    const html = renderCustody();
    expect(html).toContain('data-custody-stats-toggle="true"');
    expect(html, 'closed on the way in').not.toContain('data-custody-figures');
    expect(html).toContain('data-date-caption="from"');
    const filters = CUSTODY.indexOf('DARK_FILTER_BAR, ');
    const figures = CUSTODY.indexOf('<CustodyFigures totals={summary.data} />');
    const table = CUSTODY.indexOf('<DataTable');
    expect(filters).toBeGreaterThan(-1);
    expect(figures, 'after the filters').toBeGreaterThan(filters);
    expect(table, 'before the tables').toBeGreaterThan(figures);
    expect(CUSTODY).toContain('useCustodySummary(filters)');
    // Opened, they are the server's sums over the whole filtered set.
    const opened = mount(
      client(),
      ['fleetCustody.view'],
      '/fleet/custody',
      <CustodyFigures totals={custodySummary} />,
    );
    expect(opened).toContain('data-custody-figures="true"');
    expect(opened).toContain(ar('fleet.custody.totals.total'));
    expect(opened).toContain('4,220.00');
    expect(opened).toContain(ar('fleet.custody.totals.dealership'));
    expect(opened).toContain('850.00');
    expect(opened).toContain(ar('fleet.custody.totals.fuel'));
    expect(opened).toContain('1,850.00');
    // «الكوتش لوحده والغسيل لوحده»: tyres and washing on figures of their own, never summed.
    expect(opened).toContain(ar('fleet.custody.totals.tyres'));
    expect(opened).toContain('1,400.00');
    expect(opened).toContain(ar('fleet.custody.totals.wash'));
    expect(opened).toContain('120.00');
    expect(opened, 'no «كاوتش + غسيل» figure any more').not.toContain('1,520.00');
    // The figure and «ج.م.» in spans of their own — never glued.
    expect(opened).toMatch(/>4,220\.00<\/span><span[^>]*>ج\.م\.<\/span>/u);
  });

  it('shows six figures — the fund, the total, then each kind on its own tile in its own colour', () => {
    const opened = mount(
      client(),
      ['fleetCustody.view'],
      '/fleet/custody',
      <CustodyFigures totals={custodySummary} />,
    );
    const order = [...opened.matchAll(/data-custody-figure="(\w+)"/gu)].map((m) => m[1]);
    expect(order).toEqual(['fund', 'total', 'dealership', 'fuel', 'tyres', 'wash']);
    for (const kind of ['dealership', 'fuel', 'tyres', 'wash'] as const) {
      const at = opened.indexOf(`data-custody-figure="${kind}"`);
      const tile = opened.slice(at, opened.indexOf('</div></div>', at));
      // The owner's dashboard design, on the whole custody screen: the kind's tile and edge.
      expect(tile, `${kind} wears its kind's tile`).toContain(CUSTODY_KIND[kind].tile);
      expect(tile, `${kind} wears its kind's edge`).toContain(CUSTODY_KIND[kind].accent);
    }
    // One to a row on a phone, two from `sm`, three from `xl`, the six in one row only from
    // 1,680px — never `2xl`, where «ج.م.» would not fit — and «ج.م.» goes under a figure too long
    // for its tile rather than off it.
    expect(opened).toContain(
      'grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1680px]:grid-cols-6',
    );
    expect(opened).not.toMatch(/(?:^|[\s"])(?:lg|2xl):grid-cols-[56]/u);
    expect(opened).toContain('[&amp;_.items-baseline]:flex-wrap');
    // «فى شاشه العهد … فى اللايت سيم والدارك سيم»: on this screen fuel is the design's amber,
    // the total its emerald — the house rule keeping amber for states holds on the other boards.
    expect(CUSTODY_KIND.fuel.tile).toContain('text-amber-600');
    expect(opened).toContain('border-l-emerald-500');
  });

  it('draws the kind in «كل الحركات» in its own colour — the dealership, fuel, tyres and washing apart', () => {
    const html = renderCustody([
      movement({ id: 'f', source: 'fuel', amount: 101 }),
      movement({ id: 't', source: 'tyres', fuelType: null, amount: 102 }),
      movement({ id: 'w', source: 'wash', fuelType: null, amount: 103 }),
      movement({
        id: 'd',
        ref: 'dealershipInvoice',
        source: 'dealership',
        driverName: null,
        fuelType: null,
        detail: 'إصلاح',
        amount: 104,
      }),
    ]);
    const movements = html.indexOf('data-custody-movements="true"');
    const fills = new Set<string>();
    for (const [kind, amount] of [
      ['fuel', '101.00'],
      ['tyres', '102.00'],
      ['wash', '103.00'],
      ['dealership', '104.00'],
    ] as const) {
      const row = rowWith(html, amount, movements);
      const at = row.indexOf(`data-custody-kind="${kind}"`);
      expect(at, `${kind} has its badge`).toBeGreaterThan(-1);
      // The badge holds its dot, then the kind's name: up to its own closing tag.
      const badge = row.slice(
        row.lastIndexOf('<span', at),
        row.indexOf('</span>', row.indexOf('</span>', at) + 1),
      );
      expect(badge).toContain(CUSTODY_KIND[kind].badge);
      expect(badge).toContain(CUSTODY_KIND[kind].dot);
      expect(badge).toContain(ar(`fleet.custody.source.${kind}`));
      fills.add(CUSTODY_KIND[kind].badge);
    }
    expect(fills.size, 'four kinds, four colours').toBe(4);
    expect(CUSTODY).toContain('<CustodyKindBadge kind={row.source} />');
    expect(CUSTODY).not.toContain("tone={row.source === 'dealership' ? 'info' : 'neutral'}");
  });

  it('prints tyres and washing on totals of their own', () => {
    expect(CUSTODY).toContain(
      "{ label: t('fleet.custody.totals.tyres'), value: reportMoney(summary.data.tyres) }",
    );
    expect(CUSTODY).toContain(
      "{ label: t('fleet.custody.totals.wash'), value: reportMoney(summary.data.wash) }",
    );
    expect(CUSTODY).not.toContain('tyresWash');
  });

  it('opens on its toolbar — the count, «الإحصائيات», Excel / PDF — with no page title', () => {
    const html = renderCustody();
    for (const gone of ['<PageHeader', '<DocumentActions', '<StatStrip', '<FilteredCount']) {
      expect(CUSTODY, gone).not.toContain(gone);
    }
    expect(html).toContain('data-custody-toolbar="true"');
    const count = html.indexOf('data-filtered-count');
    expect(count).toBeGreaterThan(-1);
    expect(html.slice(count, html.indexOf('</span>', count))).toContain(
      ar('common.list.count', { count: formatNumber(1, 'ar') }),
    );
    expect(html.indexOf('data-export="custody"'), 'above the filters').toBeLessThan(
      html.indexOf('data-date-caption="from"'),
    );
    expect(html.indexOf('data-print="custody"'), 'above the filters').toBeLessThan(
      html.indexOf('data-date-caption="from"'),
    );
    expect(html).toContain(ar('fleet.fuelCards.board.excel'));
    expect(html).toContain(ar('fleet.fuelCards.board.pdf'));
  });

  it('writes both tables in the alarms board’s type — centred, a year-first Latin date, the code bold, money apart', () => {
    const html = renderCustody([movement({ amount: 17890 })]);
    const perVehicle = html.indexOf('data-custody-per-vehicle="true"');
    const movements = html.indexOf('data-custody-movements="true"');
    expect(html.slice(perVehicle, movements), 'the per-car table').toContain(
      escapedClass(ALARMS_TYPE),
    );
    expect(html.slice(movements), 'the movements').toContain(escapedClass(ALARMS_TYPE));
    const row = rowWith(html, '17,890.00', movements);
    expect(row).toContain('2026/10/01');
    expect(row, 'no Arabic-Indic digit on the row').not.toMatch(/[٠-٩]/u);
    expect(row).toMatch(/>17,890\.00<\/span><span[^>]*>ج\.م\.<\/span>/u);
    // The car's code a size over the row, bold, left to right.
    const code = row.slice(row.lastIndexOf('<span', row.indexOf('>204<')), row.indexOf('>204<'));
    expect(code).toContain('font-bold');
    expect(code).toContain(ALARMS_CODE_TYPE);
    expect(code).toContain('dir="ltr"');
    // Every value and header centred, in both tables.
    const cells = row.match(/<td[^>]*>/gu) ?? [];
    expect(cells.length).toBe(6);
    for (const cell of cells) expect(cell).toContain('text-center');
    const heads = html.match(/<th\b[^>]*>/gu) ?? [];
    expect(heads.length).toBe(12);
    for (const head of heads) expect(head).toContain('text-center');
    // An empty car is the boards' grey dash; a car with nothing of a source the dashboard's muted
    // one, in both themes («وخلى الالوان زى ما انت عامل فى الداش بورد»).
    const none = rowWith(renderCustody([movement({ vehicleCode: null })]), '1,350.00', movements);
    expect(none).toContain('<span class="text-slate-400">—</span>');
    const car = rowWith(html, '>63<', perVehicle);
    expect(car).toContain('<span class="text-slate-400 dark:text-slate-500">—</span>');
  });

  it('writes the driver’s WHOLE name, no code beside it — and a name from the old books grey', () => {
    expect(CUSTODY).toContain(
      '<DriverCell employeeId={row.driverEmployeeId} name={row.driverName} look="name" />',
    );
    expect(CUSTODY).not.toContain('<DriverName ');
    const known = renderCustody(
      [movement({ driverEmployeeId: 'e-7', driverName: 'ابراهيم السيد رزق جابر' })],
      {
        permissions: ['fleetCustody.view', 'fleetDriver.view'],
        people: [person('e-7', '0100765', 'ابراهيم السيد رزق جابر')],
      },
    );
    const row = rowWith(known, '1,350.00', known.indexOf('data-custody-movements="true"'));
    expect(row).toContain('ابراهيم السيد رزق جابر');
    expect(row, 'never the code glued to the name').not.toContain('جابر0100765');
    expect(row, 'and not under it either').not.toContain('0100765</span>');
    expect(row).not.toContain('data-legacy-name');
    const typed = renderCustody();
    const legacy = rowWith(typed, '1,350.00', typed.indexOf('data-custody-movements="true"'));
    expect(legacy).toContain('data-legacy-name="true"');
    expect(legacy).toContain('أيمن حسن مصطفى');
  });

  it('puts an arrow on every header of both tables', () => {
    const html = renderCustody();
    const perVehicle = html.indexOf('data-custody-per-vehicle="true"');
    const movements = html.indexOf('data-custody-movements="true"');
    const arrows = (part: string): number =>
      (part.match(/<th\b[^>]*><button type="button"/gu) ?? []).length;
    expect(arrows(html.slice(perVehicle, movements)), '«ملخص لكل سيارة»').toBe(6);
    expect(arrows(html.slice(movements)), '«كل الحركات»').toBe(6);
  });

  it('orders «ملخص لكل سيارة» by its arrows, the grand total always last', () => {
    const html = renderCustody([movement()], { search: '?carSort=total:asc' });
    const table = html.slice(
      html.indexOf('data-custody-per-vehicle="true"'),
      html.indexOf('data-custody-movements="true"'),
    );
    const cheap = table.indexOf('>63<');
    const dear = table.indexOf('>204<');
    const total = table.indexOf('data-custody-grand-total="true"');
    expect(cheap).toBeGreaterThan(-1);
    expect(dear, 'the smaller total first').toBeGreaterThan(cheap);
    expect(total, 'the grand total after every car').toBeGreaterThan(dear);
    // Untouched, it opens by the car's code, as the server sends it — still the total last.
    const plain = renderCustody();
    const byCode = plain.slice(
      plain.indexOf('data-custody-per-vehicle="true"'),
      plain.indexOf('data-custody-movements="true"'),
    );
    expect(byCode.indexOf('>204<')).toBeLessThan(byCode.indexOf('>63<'));
    expect(byCode.indexOf('data-custody-grand-total="true"')).toBeGreaterThan(
      byCode.indexOf('>63<'),
    );
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

  /**
   * The modal open on a fuel receipt of car 160, the car's cards already read — and, when given,
   * every card in the system (what «كارت آخر» lists).
   */
  const openOn = (
    cards: FleetFuelCardDto[],
    over: Partial<FleetReceiptDto> = {},
    everyCard?: FleetFuelCardDto[],
  ): string => {
    const qc = client();
    if (everyCard !== undefined) {
      qc.setQueryData(listKey('fleet', 'fuelCards', { whole: true }), {
        items: everyCard,
        meta: { page: 1, pageSize: 100, totalItems: everyCard.length, totalPages: 1 },
      });
    }
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
    // Save is still pressable — the press names the card — and nothing is red before it.
    const at = html.lastIndexOf('<button', html.indexOf('data-receipt-save="true"'));
    expect(at, 'the form has its Save').toBeGreaterThan(-1);
    expect(html.slice(at, html.indexOf('</button>', at)), 'it is Save').toContain(
      ar('common.save'),
    );
    const save = html.slice(at, html.indexOf('>', at) + 1).replace(/class="[^"]*"/, '');
    expect(save, 'Save is pressable').not.toContain('disabled');
    expect(html).not.toContain('data-missing-fields');
    expect(html).not.toContain('data-field-missing');
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

  // ── «لما اختار عربيه اعملى ان هل تريد تسجيل كارت اخر حتى لو العربيه عليها كروت» ────────────
  const otherCar = fuelCard({
    id: 'c-204',
    vehicleId: 'v-204',
    vehicleCode: '204',
    company: 'chillout',
    name: 'كارت شيل اوت 204',
    number: '5522 8810 3340 7700',
    balance: 900,
  });
  const travel = fuelCard({
    id: 'c-travel',
    vehicleId: null,
    vehicleCode: null,
    label: 'سفر 1',
    name: 'كارت سفر',
    number: '7045 1120 0098 5511',
    balance: 300,
  });

  it('offers «تسجيل كارت آخر؟» under the car’s own cards — with cards on the car', () => {
    const html = openOn([fuelCard({})], { cardId: 'c-1' });
    expect(html).toContain('data-receipt-card="c-1"');
    expect(html).toContain('data-receipt-other-open="true"');
    expect(html).toContain(ar('fleet.receipts.otherCard.open'));
    expect(ar('fleet.receipts.otherCard.open')).toBe('تسجيل كارت آخر؟');
    // Under the tiles, above the tick.
    expect(html.indexOf('data-receipt-card="c-1"')).toBeLessThan(
      html.indexOf('data-receipt-other-open="true"'),
    );
    expect(html.indexOf('data-receipt-other-open="true"')).toBeLessThan(
      html.indexOf('data-receipt-use-card'),
    );
    // Not open yet: no list of every card read.
    expect(html).not.toContain('data-receipt-other="true"');
  });

  it('…and on a car with no card — the fund still pays until another card is picked', () => {
    const html = openOn([]);
    expect(html).toContain('data-receipt-cards="none"');
    expect(html).toContain('data-receipt-other-open="true"');
    expect(html).toContain('data-receipt-source="custody"');
  });

  it('is not offered before a car is picked, while its cards load, or on tyres and washing', () => {
    const fresh = mount(
      client(),
      ['fleetReceipt.view', 'fleetReceipt.create'],
      '/fleet/receipts',
      <ReceiptDialog open onClose={() => undefined} row={null} />,
    );
    expect(fresh).not.toContain('data-receipt-other-open');
    const loading = mount(
      client(),
      ['fleetReceipt.view', 'fleetReceipt.edit'],
      '/fleet/receipts',
      <ReceiptDialog
        open
        onClose={() => undefined}
        row={receipt({ vehicleId: 'v-160', vehicleCode: '160', cardId: 'c-1' })}
      />,
    );
    expect(loading).not.toContain('data-receipt-other-open');
    const tyres = openOn([fuelCard({})], {
      kind: 'tyres',
      source: 'custody',
      cardId: null,
      fuelType: null,
    });
    expect(tyres).not.toContain('data-receipt-other-open');
  });

  it('an edit paid by another car’s card opens on «كارت آخر», that card picked and the line naming its car', () => {
    const html = openOn(
      [fuelCard({})],
      {
        cardId: 'c-204',
        cardCompany: 'chillout',
        cardNumber: '5522 8810 3340 7700',
        cardVehicleId: 'v-204',
        cardVehicleCode: '204',
        amount: 100,
      },
      [fuelCard({}), otherCar, travel],
    );
    expect(html).toContain('data-receipt-other="true"');
    expect(html).toContain('data-receipt-other-cards="ready"');
    expect(html).not.toContain('data-receipt-other-open');
    expect(html).toContain('data-receipt-other-back="true"');
    expect(html).toContain(ar('fleet.receipts.otherCard.back'));
    // Every OTHER card is listed — never the car's own — the picked one pressed.
    expect(html).not.toContain('data-receipt-other-card="c-1"');
    const picked = html.slice(
      html.lastIndexOf('<button', html.indexOf('data-receipt-other-card="c-204"')),
      html.indexOf('</button>', html.indexOf('data-receipt-other-card="c-204"')),
    );
    expect(picked).toContain('aria-selected="true"');
    expect(picked).toContain('border-brand-500');
    expect(picked, 'its company').toContain(ar('fleet.fuelCards.company.chillout'));
    expect(picked, 'its number, masked as the table writes it').toContain('•••• 7700');
    expect(picked, 'its car').toContain(ar('fleet.receipts.cardOf', { code: '204' }));
    expect(picked, 'its balance').toContain('900.00');
    const stock = html.slice(
      html.lastIndexOf('<button', html.indexOf('data-receipt-other-card="c-travel"')),
      html.indexOf('</button>', html.indexOf('data-receipt-other-card="c-travel"')),
    );
    expect(stock).toContain('aria-selected="false"');
    expect(stock, 'a card on no car is named by its label').toContain('سفر 1');
    expect(stock).toContain('•••• 5511');
    // The search box, and the line under the form: the picked card pays — and gets this
    // receipt's 100 back before it is taken again (900 + 100 → 900).
    expect(html).toContain('data-receipt-other-search="true"');
    expect(html).toContain('data-receipt-source="card"');
    const at = html.indexOf('data-receipt-summary="card"');
    expect(at, 'the line names the card that pays').toBeGreaterThan(-1);
    const line = html.slice(at, html.indexOf('</p>', at));
    expect(line).toContain(ar('fleet.fuelCards.company.chillout'));
    expect(line).toContain('204');
    expect(line).toContain('1,000.00');
    expect(line).toContain('900.00');
  });

  it('a card on no car opens on «كارت آخر» too, and says so while every card is still loading', () => {
    const html = openOn([fuelCard({})], {
      cardId: 'c-travel',
      cardVehicleId: null,
      cardVehicleCode: null,
      cardLabel: 'سفر 1',
    });
    expect(html).toContain('data-receipt-other="true"');
    expect(html).toContain('data-receipt-other-cards="loading"');
    expect(html).toContain('data-receipt-summary="loadingOther"');
  });
});
