// The dealership screen (التوكيل), proven against what it actually produces.
//
// «العربيه اللى بتخرج من الصيانه بتظهر فى الشاشه دى بس الصف بيكون باللون الاصفر»: a row waiting
// for its invoice is yellow and offers «تسجيل الفاتورة»; a recorded one says who paid; the totals
// sit between the filters and the table; print and Excel are icons on the page's side.
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
  type FleetDealershipInvoiceDto,
  type FleetDealershipTotalsDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { DealershipPage } from './DealershipPage';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, 'DealershipPage.tsx'), 'utf8');
const FORM = readFileSync(join(HERE, '../components/DealershipInvoiceDialog.tsx'), 'utf8');
const CELL = readFileSync(join(HERE, '../components/DealershipImageCell.tsx'), 'utf8');
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

const row = (over: Partial<FleetDealershipInvoiceDto> = {}): FleetDealershipInvoiceDto => ({
  id: 'd-1',
  visitId: 'm-1',
  vehicleId: 'v-1',
  vehicleCode: '204',
  outDate: '2026-10-01T00:00:00.000Z',
  workKind: 'maintenance',
  workTypeLabel: 'صيانة',
  privateCar: false,
  insuranceCompanyId: 'i-1',
  insuranceCompanyName: 'مصر للتأمين',
  invoiceNumber: null,
  invoiceAmount: null,
  image: null,
  side: null,
  pending: true,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const totals = (over: Partial<FleetDealershipTotalsDto> = {}): FleetDealershipTotalsDto => ({
  count: 3,
  pending: 1,
  dealershipTotal: 3250,
  custodyTotal: 850,
  ...over,
});

const FILTERS = {
  from: undefined,
  to: undefined,
  vehicleCodes: undefined,
  side: undefined,
  pending: undefined,
  workKind: undefined,
};

const render = ({
  permissions = ['fleetDealership.view', 'fleetDealership.edit', 'fleetDealership.delete'],
  rows = [row()],
  figures = totals(),
}: {
  permissions?: string[];
  rows?: FleetDealershipInvoiceDto[];
  figures?: FleetDealershipTotalsDto;
} = {}): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(
    listKey('fleet', 'dealership', {
      ...FILTERS,
      page: 1,
      pageSize: 25,
      sortBy: 'outDate',
      sortDir: 'desc',
      sort: 'outDate:desc',
    }),
    { items: rows, meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 } },
  );
  qc.setQueryData(listKey('fleet', 'dealership', { summary: true, ...FILTERS }), figures);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/fleet/dealership']}>
          <Routes>
            <Route path="/fleet/dealership" element={<DealershipPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The table row holding `text` — searched from the body, past the filter options and the totals. */
const rowWith = (html: string, text: string): string => {
  const body = html.indexOf('<tbody');
  const at = html.indexOf(text, body);
  expect(at, `a row holding «${text}»`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
};

describe('the dealership table', () => {
  it('shows a workshop exit as a YELLOW row waiting for its invoice, with «تسجيل الفاتورة»', () => {
    const html = render();
    const pending = rowWith(html, 'صيانة');
    expect(pending).toContain('bg-amber-50/80');
    expect(pending).toContain('data-dealership-record="d-1"');
    expect(pending).toContain(ar('fleet.dealership.record'));
    expect(pending, 'the insurer came off the car').toContain('مصر للتأمين');
  });

  it('says who paid a recorded row, and does not tint it', () => {
    const html = render({
      rows: [
        row({
          id: 'd-2',
          workTypeLabel: 'إصلاح (كهرباء)',
          invoiceNumber: '48213',
          invoiceAmount: 3250,
          side: 'dealership',
          pending: false,
        }),
        row({
          id: 'd-3',
          vehicleCode: '63',
          workTypeLabel: 'إصلاح',
          privateCar: true,
          invoiceAmount: 850,
          side: 'custody',
          pending: false,
        }),
      ],
    });
    const dealer = rowWith(html, '48213');
    expect(dealer).not.toContain('bg-amber-50/80');
    expect(dealer).toContain(ar('fleet.dealership.side.dealership'));
    expect(dealer).toContain('3,250.00');
    const custody = rowWith(html, 'إصلاح</td>');
    expect(custody).toContain(ar('fleet.dealership.side.custody'));
  });

  it('puts the totals BETWEEN the filters and the table — the server’s figures, over the whole set', () => {
    const html = render();
    const filters = html.indexOf('data-date-caption="from"');
    const strip = html.indexOf('3,250.00');
    const table = html.indexOf('<table');
    expect(filters).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(filters);
    expect(table).toBeGreaterThan(strip);
    expect(html).toContain(ar('fleet.dealership.totals.dealership'));
    expect(html).toContain('850.00');
    expect(PAGE).toContain('useDealershipSummary(filters)');
  });

  it('offers print and Excel as icons beside the page, like the violations screen', () => {
    const html = render();
    expect(html).toContain('data-print="dealership"');
    expect(html).toContain('data-export="dealership"');
    expect(PAGE).toContain('<PrinterIcon className="h-6 w-6" />');
  });

  it('carries the image column exactly as the vehicle licence does — upload, then view / print / delete', () => {
    const none = render();
    expect(none).toContain(ar('fleet.dealership.image.upload'));
    const has = render({
      rows: [
        row({
          image: { fileId: 'f-1', fileName: 'a.jpg', mime: 'image/jpeg', size: 1, uploadedAt: '' },
        }),
      ],
    });
    expect(has).toContain('data-dealership-print="d-1"');
    expect(has).toContain('data-dealership-image-delete="d-1"');
    expect(CELL).toContain('LICENSE_IMAGE_ACCEPT');
    expect(CELL).toContain('printLicenceRecord(');
  });

  it('shows no recording, deleting or uploading to a reader who may only view', () => {
    const html = render({ permissions: ['fleetDealership.view'] });
    expect(html).not.toContain('data-dealership-record=');
    expect(html).not.toContain('data-dealership-delete=');
    expect(html).not.toContain(ar('fleet.dealership.image.upload'));
  });
});

describe('recording the invoice', () => {
  it('shows the car’s code alone, and «ملاكي» as a tick preset from the operation', () => {
    expect(FORM).toContain("<Input value={row.vehicleCode ?? '—'} readOnly disabled />");
    expect(FORM).toContain('setPrivateCar(row.privateCar)');
    expect(FORM).toContain('data-dealership-private="true"');
  });

  it('needs an invoice number unless the car is private — then the custody fund pays', () => {
    expect(FORM).toContain("const numberOk = privateCar || invoiceNumber.trim() !== '';");
    expect(FORM).toMatch(/privateCar && invoiceNumber\.trim\(\) === ''\s*\?\s*'custody'\s*:\s*'dealership'/u);
  });

  it('lets a typed insurer be added to the catalogs and written onto the car — through those screens’ own calls', () => {
    expect(FORM).toContain('list="dealership-insurers"');
    expect(FORM).toContain("kind: 'insuranceCompany'");
    expect(FORM).toContain('updateVehicle.mutateAsync({');
    expect(FORM).toContain("can('fleetCatalog.manage')");
    expect(FORM).toContain("can('fleetVehicle.edit')");
    expect(ar('fleet.dealership.insurerAddToCatalog')).toContain('قوائم الحركة');
  });
});
