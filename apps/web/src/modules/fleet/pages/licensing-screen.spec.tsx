// What the licensing board SHOWS — asserted as markup facts, from real renders.
//
// There is no DOM here, so nothing can be clicked. What this can prove is the part that carries
// the owner's rules: the table has the shape of the form they drew, each paper's PAIR of squares
// is coloured together, and the colour is read from the ticks rather than from anything the
// screen remembers.
//
// WHICH CARS ARE ON THE BOARD is not provable here and is not this screen's decision: the server
// derives it from the licence class, and its rule is proven in
// `apps/api/src/modules/fleet/licensing/licensing-class.spec.ts`.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetLicensingRowDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { LicensingPage, paperStage } from './LicensingPage';

/** The two tints the board paints, as the cell writes them — never the bare shade. */
const AMBER = 'bg-amber-50 dark:bg-amber-950/40';
const GREEN = 'bg-emerald-50 dark:bg-emerald-950/40';

const row = (over: Partial<FleetLicensingRowDto> = {}): FleetLicensingRowDto => ({
  vehicleId: 'v-1',
  code: '150',
  plateNumber: 'س ص ١٥٠',
  chassisNumber: 'JTEBH9FJ7EK123456',
  licenseClass: 'برقاش ت',
  insuranceHandover: false,
  insuranceReceipt: false,
  taxHandover: false,
  taxReceipt: false,
  ...over,
});

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
  }) as MeDto;

const render = ({
  locale = 'ar',
  permissions = ['fleetLicensing.view', 'fleetLicensing.mark'],
  rows = [row()],
}: {
  locale?: Locale;
  permissions?: string[];
  /** `null` = seed nothing, so the query is genuinely pending rather than empty. */
  rows?: FleetLicensingRowDto[] | null;
} = {}): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  if (rows !== null) qc.setQueryData(['fleet', 'licensing'], rows);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/fleet/licensing']}>
          <Routes>
            <Route path="/fleet/licensing" element={<LicensingPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The markup of one cell, by the row and paper it belongs to. */
const cell = (html: string, code: string, paper: string, step: string): string => {
  const at = html.indexOf(`data-licensing-cell="${code}:${paper}:${step}"`);
  expect(at, `${code} ${paper} ${step} is on the board`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<td', at), html.indexOf('</td>', at));
};

describe('the licensing board has the shape of the form', () => {
  it('names the five columns the owner drew, and no others', () => {
    const html = render();
    for (const label of ['كود السيارة', 'اللوحة', 'الشاسيه', 'تأمينات', 'ضرائب']) {
      expect(html, label).toContain(label);
    }
    // Each paper is split in two, so the HEAD carries «تسليم» and «استلام» twice each — once
    // under the insurance head and once under the tax one. A single occurrence would mean one of
    // the two papers had been given an undivided column.
    //
    // Counted inside `<thead>` alone: every square also names its own step in its label and its
    // tooltip, so a page-wide count answers for the buttons rather than for the columns.
    const thead = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(thead.split('تسليم').length - 1, 'تسليم under both papers').toBe(2);
    expect(thead.split('استلام').length - 1, 'استلام under both papers').toBe(2);
    expect(thead, 'each paper spans its pair').toContain('colSpan="2"');
  });

  it('carries the car itself — code, plate and chassis', () => {
    const html = render({ rows: [row({ code: '214', plateNumber: 'ط ن ٢١٤' })] });
    expect(html).toContain('214');
    expect(html).toContain('ط ن ٢١٤');
    expect(html).toContain('JTEBH9FJ7EK123456');
  });
});

describe('a paper colours as a PAIR', () => {
  it('«تسليم» alone turns the paper YELLOW — both of its squares', () => {
    // «لما اعمل صح على تسليم فى التأمينات يبقى العمودين بتوع تسليم واستلام بتوع التأمينات
    // يتعمله الصف اصفر».
    const html = render({ rows: [row({ insuranceHandover: true })] });
    expect(cell(html, '150', 'insurance', 'handover'), 'the square ticked').toContain(AMBER);
    expect(cell(html, '150', 'insurance', 'receipt'), 'and the one beside it').toContain(AMBER);
    expect(cell(html, '150', 'insurance', 'handover')).not.toContain(GREEN);
  });

  it('«تسليم واستلام» turns it GREEN', () => {
    const html = render({
      rows: [row({ insuranceHandover: true, insuranceReceipt: true })],
    });
    expect(cell(html, '150', 'insurance', 'handover')).toContain(GREEN);
    expect(cell(html, '150', 'insurance', 'receipt')).toContain(GREEN);
    expect(cell(html, '150', 'insurance', 'handover')).not.toContain(AMBER);
  });

  it('and the OTHER paper is untouched by it — «ونفس الكلام دا فى حاله عمود الضرايب»', () => {
    // The two papers are two errands. A row whose insurance is done says nothing about its tax,
    // and colouring the whole row would have made the board unreadable for exactly the case it
    // exists to show: which half is still out.
    const html = render({
      rows: [row({ insuranceHandover: true, insuranceReceipt: true })],
    });
    const tax = cell(html, '150', 'tax', 'handover');
    expect(tax).not.toContain(GREEN);
    expect(tax).not.toContain(AMBER);
  });

  it('the tax pair colours by its OWN ticks', () => {
    const html = render({ rows: [row({ taxHandover: true })] });
    expect(cell(html, '150', 'tax', 'handover')).toContain(AMBER);
    expect(cell(html, '150', 'tax', 'receipt')).toContain(AMBER);
    expect(cell(html, '150', 'insurance', 'handover')).not.toContain(AMBER);
  });

  it('nothing ticked is not a colour — most of the board is in that state', () => {
    const html = render();
    for (const paper of ['insurance', 'tax']) {
      for (const step of ['handover', 'receipt']) {
        const td = cell(html, '150', paper, step);
        expect(td, `${paper} ${step}`).not.toContain(AMBER);
        expect(td).not.toContain(GREEN);
      }
    }
  });
});

describe('paperStage — the one reading behind the colour', () => {
  const insurance = { key: 'insurance', label: 'x', handover: 'insuranceHandover', receipt: 'insuranceReceipt' } as const;

  it('answers none / open / done and nothing else', () => {
    expect(paperStage(row(), insurance)).toBe('none');
    expect(paperStage(row({ insuranceHandover: true }), insurance)).toBe('open');
    expect(paperStage(row({ insuranceHandover: true, insuranceReceipt: true }), insurance)).toBe(
      'done',
    );
  });

  it('calls a lone «استلام» half-done rather than nothing', () => {
    // It should not arise, and if it ever does, a TICKED square must never sit on an uncoloured
    // cell — that would be the board pretending it cannot see a mark somebody made.
    expect(paperStage(row({ insuranceReceipt: true }), insurance)).toBe('open');
  });
});

describe('who may tick', () => {
  it('offers the squares to a clerk who holds the grant', () => {
    expect(render()).toContain('data-licensing-mark="150:insuranceHandover"');
  });

  it('and shows a reader the board with its squares disabled', () => {
    // Read-only is not "no squares": a supervisor reads this screen to see which papers are out,
    // and hiding the ticks would hide the answer along with the control.
    const html = render({ permissions: ['fleetLicensing.view'] });
    const at = html.indexOf('data-licensing-mark="150:insuranceHandover"');
    expect(at, 'the square is drawn').toBeGreaterThan(-1);
    expect(html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at))).toContain('disabled');
  });
});

describe('an empty board explains itself', () => {
  it('says WHY there is nothing here, because the rule is invisible otherwise', () => {
    // A fleet of two hundred cars showing an empty screen reads as a fault. The rule — «اخرها ت»
    // — is decided in the licence-class catalog, which is a different screen entirely.
    const html = render({ rows: [] });
    expect(html).toContain('لا توجد سيارات');
    expect(html).toContain('برقاش ت');
  });
});
