// The dealership screen (التوكيل), proven against what it actually produces.
//
// «العربيه اللى بتخرج من الصيانه بتظهر فى الشاشه دى بس الصف بيكون باللون الاصفر»: a row waiting
// for its invoice is yellow and offers «تسجيل الفاتورة»; a recorded one turns green; the totals
// sit between the filters and the table; print and Excel are icons on the page's side. The bill's
// form opens its insurer on «لا يوجد», offers the car's own under the arrow, and takes a photo.
//
// «التوكيل لما بسجل فاتوره عاوز الحاجات دى تتحفظ زى ما هى ولا تنقص من الكروت ولا تنقص من العهدة
// وملهاش علاقة ب حاجة»: nothing on the screen or the form reads an invoice as custody money — no
// «الجهة», no custody total — and «ملاكي» stays, as data.
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
import { DealershipInvoiceDialog } from '../components/DealershipInvoiceDialog';

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
  // «الافتراضى … لا يوجد حتى لو العربيه فيها تامين»: the bill names none, the car carries one.
  insuranceCompanyId: null,
  insuranceCompanyName: null,
  vehicleInsuranceCompanyId: 'i-1',
  vehicleInsuranceCompanyName: { ar: 'مصر للتأمين', en: 'Misr Insurance' },
  vehicleInsuranceCompanyActive: true,
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
  dealershipTotal: 4100,
  ...over,
});

const FILTERS = {
  from: undefined,
  to: undefined,
  vehicleCodes: undefined,
  pending: undefined,
  workKind: undefined,
};

const EDITOR = ['fleetDealership.view', 'fleetDealership.edit', 'fleetDealership.delete'];

const makeStore = (permissions: string[], locale: Locale = 'ar') =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const render = ({
  permissions = EDITOR,
  rows = [row()],
  figures = totals(),
}: {
  permissions?: string[];
  rows?: FleetDealershipInvoiceDto[];
  figures?: FleetDealershipTotalsDto;
} = {}): string => {
  const store = makeStore(permissions);
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
  it('shows a workshop exit waiting for its invoice, with «تسجيل الفاتورة»', () => {
    const html = render();
    const pending = rowWith(html, 'صيانة');
    // «⚠ بانتظار الفاتورة» by the car; the row itself is not tinted.
    expect(pending).toContain('data-pending="true"');
    expect(pending).toContain('data-dealership-waiting="true"');
    expect(pending).toContain(ar('fleet.dealership.pending'));
    expect(pending).toContain('data-dealership-record="d-1"');
    expect(pending).toContain(ar('fleet.dealership.record'));
    // A new bill names no insurer, even on a car that carries one.
    expect(pending).toContain(ar('fleet.dealership.noInsurer'));
    expect(pending).not.toContain('مصر للتأمين');
  });

  it('turns a recorded row green — and says nothing of «الجهة»: no invoice is custody money', () => {
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
    expect(dealer).toContain('3,250.00');
    // «عاوز لما اعمل تسجيل الفاتوره تبقى اخضر»: only a recorded row is tinted, and green.
    expect(PAGE).toContain('[&_tbody_tr[data-pending=false]]:!bg-emerald-50');
    expect(PAGE).not.toContain('[&_tbody_tr[data-pending=true]]');
    // A private car's bill with no number — stored with `side: 'custody'`, as it always was —
    // shows its amount as entered, and nothing calls it the fund's.
    const privateBill = rowWith(html, 'إصلاح</span>');
    expect(privateBill).toContain('data-pending="false"');
    expect(privateBill).toContain('850.00');
    for (const one of [dealer, privateBill]) {
      expect(one).not.toContain(ar('fleet.nav.custody'));
    }
    expect(html).not.toContain(ar('fleet.nav.custody'));
    for (const gone of ["'side'", 'row.side', 'fleet.dealership.side.', 'columns.side']) {
      expect(PAGE, gone).not.toContain(gone);
    }
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
    for (const key of ['dealership', 'pending', 'count']) {
      expect(PAGE).toContain(`t('fleet.dealership.totals.${key}')`);
    }
    // No custody total: an invoice is not custody money, a private car's neither.
    expect(PAGE).not.toContain('totals.custody');
    expect(PAGE).not.toContain('custodyTotal');
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
    // The files' last column is «الحالة» — waiting or recorded — never who paid.
    const header = PAGE.slice(
      PAGE.indexOf('const header = ['),
      PAGE.indexOf('];', PAGE.indexOf('const header = [')),
    );
    expect(header).toContain("t('fleet.dealership.filters.state'),");
    expect(PAGE.match(/stateLabel\(row\),/gu), 'the sheet and the print').toHaveLength(2);
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

  it('needs an invoice number unless the car is private — and says no «الجهة»: nothing goes to the fund', () => {
    expect(FORM).toContain("const numberOk = privateCar || invoiceNumber.trim() !== '';");
    // The banner that said who would pay after the save is gone, with every word of it.
    expect(FORM).not.toContain('data-dealership-side');
    expect(FORM).not.toContain("'custody'");
    for (const key of ['sideUnknown', 'sideCustodyHint', 'sideDealershipHint']) {
      expect(FORM, key).not.toContain(key);
    }
    const html = dialog(row({ privateCar: true }));
    expect(html).not.toContain(ar('fleet.nav.custody'));
    expect(html).toContain(ar('fleet.dealership.invoiceNumberOptional'));
    expect(ar('fleet.dealership.invoiceNumberOptional')).toBe('اختياري لسيارة ملاكي.');
    // «ملاكي» is still sent as it was picked — saved exactly as entered.
    expect(FORM).toContain('        privateCar,\n');
  });

  it('keeps Save pressable and names what is missing — the number only when the car is not private', () => {
    expect(FORM).toContain('onClick={required.guard(submit)}');
    expect(FORM).not.toContain('disabled={!complete}');
    const rules = FORM.slice(FORM.indexOf('useRequiredFields('));
    const list = rules.slice(0, rules.indexOf(');'));
    for (const rule of ['ok: amountOk', 'ok: numberOk']) {
      expect(list, `the save requires ${rule}`).toContain(rule);
    }
    // «ومش عاوز اى داتا اجبارى»: the insurer and the photo are never required — the arrow holds
    // nothing that could be wrong, and a bill without a photo saves.
    expect(list).not.toContain('insurer');
    expect(list).not.toContain('photo');
    expect(FORM).toContain("missing={required.isMissing('invoiceNumber')}");
    expect(FORM).toContain('required={!privateCar}');
  });
});

/** The bill's form, open on `bill`, as the clerk sees it. */
const dialog = (bill: FleetDealershipInvoiceDto, locale: Locale = 'ar'): string =>
  renderToStaticMarkup(
    <Provider store={makeStore(EDITOR, locale)}>
      <QueryClientProvider client={new QueryClient()}>
        <DealershipInvoiceDialog open onClose={() => undefined} row={bill} />
      </QueryClientProvider>
    </Provider>,
  );

/** The `<select>` of «شركة التأمين» and its options, each `[value, label, picked]`. */
const insurerBox = (html: string): [string, string, boolean][] => {
  const at = html.indexOf('data-dealership-insurer="true"');
  expect(at, 'the form has its insurer box').toBeGreaterThan(-1);
  const box = html.slice(html.lastIndexOf('<select', at), html.indexOf('</select>', at));
  return [...box.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/gu)].map(
    (match) => [match[1] ?? '', match[3] ?? '', match[2] !== undefined],
  );
};

describe('«شركة التأمين» on the bill — «لا يوجد» first, the car’s own under the arrow', () => {
  it('opens on «لا يوجد» even when the car is insured, and offers the car’s insurer', () => {
    expect(insurerBox(dialog(row()))).toEqual([
      ['', ar('fleet.dealership.noInsurer'), true],
      ['i-1', 'مصر للتأمين', false],
    ]);
  });

  it('names the car’s insurer in English on the English screen, beside «None»', () => {
    expect(insurerBox(dialog(row(), 'en'))).toEqual([
      ['', translate('en', 'fleet.dealership.noInsurer'), true],
      ['i-1', 'Misr Insurance', false],
    ]);
  });

  it('offers «لا يوجد» alone for a car with no insurer on the vehicles screen, and says why', () => {
    const html = dialog(
      row({
        vehicleInsuranceCompanyId: null,
        vehicleInsuranceCompanyName: null,
        vehicleInsuranceCompanyActive: false,
      }),
    );
    expect(insurerBox(html)).toEqual([['', ar('fleet.dealership.noInsurer'), true]]);
    expect(html).toContain(ar('fleet.dealership.insurerCarNone'));
  });

  it('offers «لا يوجد» alone for an insurer archived in قوائم الحركة — and says so, not «no insurer»', () => {
    const html = dialog(row({ vehicleInsuranceCompanyActive: false }));
    expect(insurerBox(html)).toEqual([['', ar('fleet.dealership.noInsurer'), true]]);
    expect(html).toContain(ar('fleet.dealership.insurerCarInactive', { name: 'مصر للتأمين' }));
    expect(html).not.toContain(ar('fleet.dealership.insurerCarNone'));
  });

  it('keeps a saved insurer picked when the bill is edited — and offered, though the car’s changed', () => {
    const saved = row({
      pending: false,
      invoiceNumber: '48213',
      invoiceAmount: 3250,
      side: 'dealership',
      insuranceCompanyId: 'i-9',
      insuranceCompanyName: 'شركة سابقة',
    });
    expect(insurerBox(dialog(saved))).toEqual([
      ['', ar('fleet.dealership.noInsurer'), false],
      ['i-1', 'مصر للتأمين', false],
      ['i-9', 'شركة سابقة', true],
    ]);
    expect(insurerBox(dialog({ ...saved, insuranceCompanyId: 'i-1' }))).toEqual([
      ['', ar('fleet.dealership.noInsurer'), false],
      ['i-1', 'مصر للتأمين', true],
    ]);
  });

  it('types no new insurer — nothing is added to قوائم الحركة or written onto the car from here', () => {
    const html = dialog(row());
    expect(html).not.toContain('<datalist');
    expect(html).not.toContain('data-dealership-new-insurer');
    for (const gone of ['useCreateCatalogItem', 'useUpdateVehicle', "kind: 'insuranceCompany'"]) {
      expect(FORM, `the form no longer reaches ${gone}`).not.toContain(gone);
    }
    // A saved bill keeps its insurer unless the clerk changed the box.
    expect(FORM).toContain('...(insurerId === storedInsurer');
  });
});

describe('«صورة الفاتورة» on the bill — «لو تليفون يبقى كاميرا او اختار من الملفات»', () => {
  it('offers an optional photo box on a computer — a file, the receipt form’s dashed box', () => {
    const html = dialog(row());
    const section = html.slice(html.indexOf('data-dealership-photo="true"'));
    expect(section).toContain(ar('fleet.dealership.image.title'));
    expect(section).toContain('data-dealership-photo-state="none"');
    expect(section).toContain(ar('fleet.dealership.image.pickTitle'));
    const input = section.slice(
      section.indexOf('<input'),
      section.indexOf('>', section.indexOf('<input')),
    );
    expect(input).toContain('type="file"');
    expect(input).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(input).toContain('data-dealership-image="true"');
    // A computer has no camera choice: its file box is the way in.
    expect(html).not.toContain('data-photo-sources');
    expect(html).not.toContain('data-dealership-photo-remove');
  });

  it('on a phone, offers the camera and the device’s files as two clear choices', () => {
    const scope = globalThis as Record<string, unknown>;
    const before = scope.window;
    scope.window = { matchMedia: () => ({ matches: true }) };
    try {
      const html = dialog(row());
      expect(html).toContain('data-photo-sources="true"');
      expect(html).toContain('data-photo-source="camera"');
      expect(html).toContain('data-photo-source="device"');
      expect(html).toContain('capture="environment"');
      expect(html).toContain(ar('common.photo.camera'));
      expect(html).toContain(ar('common.photo.device'));
    } finally {
      scope.window = before;
    }
    // The shared picker the receipt and fuel-card forms use — not a new one.
    expect(FORM).toContain('<PhotoSourceButtons accept={LICENSE_IMAGE_ACCEPT} onFile={take}');
  });

  it('says a photo is already saved when the bill is edited, and that a new pick replaces it', () => {
    const html = dialog(
      row({
        pending: false,
        invoiceNumber: '48213',
        invoiceAmount: 3250,
        side: 'dealership',
        image: { fileId: 'f-1', fileName: 'bill.jpg', mime: 'image/jpeg', size: 1, uploadedAt: '' },
      }),
    );
    expect(html).toContain('data-dealership-photo-state="stored"');
    expect(html).toContain(ar('fleet.dealership.image.stored', { name: 'bill.jpg' }));
    expect(html).toContain(ar('fleet.dealership.image.replaceHint'));
  });

  it('uploads the photo after the invoice saves, through the table’s own endpoint', () => {
    const saved = FORM.indexOf('await update.mutateAsync({');
    const uploaded = FORM.indexOf('await upload.mutateAsync({ id: row.id, file });');
    expect(saved).toBeGreaterThan(-1);
    expect(uploaded, 'the photo goes up once the bill exists').toBeGreaterThan(saved);
    expect(FORM).toContain('useUploadDealershipImage()');
    // A refused photo does not lose the saved invoice: the clerk is told, and the column uploads.
    expect(FORM).toContain("toast.warning(t('fleet.dealership.image.notUploaded'));");
    // Picked, it can be dropped before saving; a refused pick is said at once.
    expect(FORM).toContain('onClick={dropPhoto}');
    expect(FORM).toContain('dealershipPhotoProblem(picked)');
  });
});
