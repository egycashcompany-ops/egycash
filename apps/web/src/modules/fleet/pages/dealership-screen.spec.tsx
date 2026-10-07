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
  it('shows a workshop exit as a WARNING row waiting for its invoice, with «تسجيل الفاتورة»', () => {
    const html = render();
    const pending = rowWith(html, 'صيانة');
    // «حاجه قريبه من الشكل دا واللون دا»: the warm amber row, and «⚠ بانتظار الفاتورة» by the car.
    expect(pending).toContain('data-pending="true"');
    expect(pending).toContain('data-dealership-waiting="true"');
    expect(pending).toContain(ar('fleet.dealership.pending'));
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
    expect(dealer).toContain('data-pending="false"');
    expect(dealer).not.toContain('data-dealership-waiting');
    expect(dealer).toContain(ar('fleet.dealership.side.dealership'));
    expect(dealer).toContain('3,250.00');
    const custody = rowWith(html, 'إصلاح</span>');
    expect(custody).toContain(ar('fleet.dealership.side.custody'));
  });

  it('puts the totals BETWEEN the filters and the table, behind «الإحصائيات» — the server’s figures', () => {
    const html = render();
    // The figures open from the toolbar's toggle, as on the notices screen.
    expect(html).toContain('data-dealership-stats-toggle="true"');
    expect(html, 'closed on the way in').not.toContain('data-dealership-figures');
    const filters = PAGE.indexOf('DARK_FILTER_BAR, ');
    const figures = PAGE.indexOf('data-dealership-figures="true"');
    const table = PAGE.indexOf('<DataTable');
    expect(filters).toBeGreaterThan(-1);
    expect(figures, 'after the filters').toBeGreaterThan(filters);
    expect(table, 'before the table').toBeGreaterThan(figures);
    for (const key of ['dealership', 'custody', 'pending', 'count']) {
      expect(PAGE).toContain(`t('fleet.dealership.totals.${key}')`);
    }
    expect(PAGE).toContain('useDealershipSummary(filters)');
  });

  it('offers Excel and PDF in the toolbar above the filters, like the boards — no page title', () => {
    const html = render();
    expect(html).toContain('data-print="dealership"');
    expect(html).toContain('data-export="dealership"');
    expect(PAGE).not.toContain('<DocumentActions');
    expect(PAGE).not.toContain('<PageHeader');
    expect(html.indexOf('data-export="dealership"'), 'above the table').toBeLessThan(
      html.indexOf('<table'),
    );
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
    // The workshop's facts are tiles now, read rather than written; «ملاكي» is a switch on the
    // car tile's label line.
    expect(FORM).toContain("value={row.vehicleCode ?? '—'}");
    expect(FORM).toContain('role="switch"');
    expect(FORM).toContain('aria-checked={privateCar}');
    expect(FORM).toContain('setPrivateCar(row.privateCar)');
    expect(FORM).toContain('data-dealership-private="true"');
  });

  it('needs an invoice number unless the car is private — then the custody fund pays', () => {
    expect(FORM).toContain("const numberOk = privateCar || invoiceNumber.trim() !== '';");
    expect(FORM).toMatch(/privateCar && invoiceNumber\.trim\(\) === ''\s*\?\s*'custody'\s*:\s*'dealership'/u);
  });

  it('keeps Save pressable and names what is missing — the number only when the car is not private', () => {
    expect(FORM).toContain('onClick={required.guard(submit)}');
    expect(FORM).not.toContain('disabled={!complete}');
    const rules = FORM.slice(FORM.indexOf('useRequiredFields('));
    const list = rules.slice(0, rules.indexOf(');'));
    // A typed insurer that is new and not being added to the catalogs has nowhere to go either.
    for (const rule of ['ok: amountOk', 'ok: numberOk', 'ok: insurerOk']) {
      expect(list, `the save requires ${rule}`).toContain(rule);
    }
    expect(FORM).toContain("missing={required.isMissing('invoiceNumber')}");
    expect(FORM).toContain('required={!privateCar}');
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
