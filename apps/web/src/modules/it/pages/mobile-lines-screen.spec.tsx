// «عايزك تستخدم الـ 3 لوجوهات فى الفلتر وفى الجدول جنب كل خط تابع لشركته» — the mobile-line
// register, proven against what it renders: the three networks' cards ARE the network filter
// (toggles, each pressed or not, with the network's logo and figures), and every line in the table
// carries its own network's logo beside its name. The actions a row offers follow its status and
// the reader's grants, and nothing on a row is re-derived or re-digited.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ItMobileLineDto,
  type ItMobileLinesSummaryDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { MobileLinesPage } from './MobileLinesPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string): string => translate('ar', key);

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

const ALL = ['itAsset.view', 'itAsset.create', 'itAsset.edit', 'itAsset.assign'];

const line = (over: Partial<ItMobileLineDto> = {}): ItMobileLineDto => ({
  id: 'l-1',
  network: 'etisalat',
  phoneNumber: '01112345678',
  accountNumber: '6.293541',
  ratePlan: 'Business 500',
  simKind: 'physical',
  simSerial: '8920011234567890123',
  status: 'inStock',
  branchId: 'b-hq',
  notes: null,
  currentAssignmentId: null,
  holder: null,
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
  ...over,
});

const HELD = line({
  id: 'l-2',
  network: 'vodafone',
  phoneNumber: '01012345678',
  status: 'assigned',
  currentAssignmentId: 'a-2',
  holder: {
    assignmentId: 'a-2',
    kind: 'employee',
    employeeId: 'e-1',
    employeeCode: '0100052',
    employeeName: 'محمد أحمد علي',
    vehicleCode: null,
    vehiclePlate: null,
    assignedAt: '2026-10-08T09:00:00.000Z',
    receiptId: 'r-1',
    receiptSigned: false,
  },
});

const IN_CAR = line({
  id: 'l-3',
  network: 'vodafone',
  phoneNumber: '01098765432',
  simKind: 'esim',
  simSerial: null,
  status: 'assigned',
  currentAssignmentId: 'a-3',
  holder: {
    assignmentId: 'a-3',
    kind: 'vehicle',
    employeeId: null,
    employeeCode: null,
    employeeName: null,
    vehicleCode: '204',
    vehiclePlate: 'س ص 63',
    assignedAt: '2026-10-09T09:00:00.000Z',
    receiptId: null,
    receiptSigned: null,
  },
});

const STOPPED = line({
  id: 'l-4',
  network: 'etisalat',
  phoneNumber: '01155555555',
  status: 'suspended',
});

const summary: ItMobileLinesSummaryDto = {
  networks: [
    {
      network: 'vodafone',
      total: 312,
      inStock: 40,
      assigned: 268,
      suspended: 4,
      accounts: [
        { value: '6.293541', count: 300 },
        { value: null, count: 12 },
      ],
      ratePlans: [],
    },
    {
      network: 'etisalat',
      total: 51,
      inStock: 7,
      assigned: 44,
      suspended: 0,
      accounts: [],
      ratePlans: [],
    },
    {
      network: 'orange',
      total: 29,
      inStock: 2,
      assigned: 27,
      suspended: 0,
      accounts: [],
      ratePlans: [],
    },
  ],
};

const page = (items: ItMobileLineDto[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

const render = ({
  permissions = ALL,
  search = '',
  query = { page: 1, pageSize: 25 },
  rows = [line()],
}: {
  permissions?: string[];
  /** The URL's query — what the screen reads its filters from. */
  search?: string;
  /** The list request the screen is expected to make for that URL. */
  query?: Record<string, unknown>;
  rows?: ItMobileLineDto[];
} = {}): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('it', 'mobileLines', query), page(rows));
  qc.setQueryData(listKey('it', 'mobileLines', { summary: true }), summary);
  qc.setQueryData(listKey('it', 'branchOptions'), [
    { id: 'b-hq', code: '01', name: { ar: 'المهندسين', en: 'HQ' }, parentId: null },
  ]);
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
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/it/mobile-lines${search}`]}>
          <Routes>
            <Route path="/it/mobile-lines" element={<MobileLinesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** Each network card's opening tag, in the order drawn. */
const cards = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*data-network-pick="[^"]+"[^>]*>/gu)].map((m) => m[0]);

/** The table's body — what is drawn for the rows, after the cards and the filters. */
const tableBody = (html: string): string => {
  const at = html.indexOf('<tbody');
  expect(at, 'the table has a body').toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</tbody>', at));
};

describe('the network cards are the network filter', () => {
  it('draws one toggle per network, in the networks’ order, none pressed by default', () => {
    const tags = cards(render());
    expect(tags.map((tag) => /data-network-pick="([^"]+)"/u.exec(tag)?.[1])).toEqual([
      'vodafone',
      'etisalat',
      'orange',
    ]);
    for (const tag of tags) {
      expect(tag).toContain('type="button"');
      expect(tag).toContain('aria-pressed="false"');
    }
  });

  it('presses the networks the URL names, and asks the register for exactly those', () => {
    // The param in any order, the request in the networks' own — the row below only renders if
    // the screen asked for that very key.
    const html = render({
      search: '?network=orange,vodafone',
      query: { page: 1, pageSize: 25, networks: 'vodafone,orange' },
      rows: [HELD],
    });
    const pressed = Object.fromEntries(
      cards(html).map((tag) => [
        /data-network-pick="([^"]+)"/u.exec(tag)?.[1],
        /aria-pressed="(true|false)"/u.exec(tag)?.[1],
      ]),
    );
    expect(pressed).toEqual({ vodafone: 'true', etisalat: 'false', orange: 'true' });
    expect(tableBody(html)).toContain('01012345678');
  });

  it('shows each card’s logo, name and figures — «مع بيانات كل شبكة»', () => {
    const html = render();
    for (const network of ['vodafone', 'etisalat', 'orange']) {
      expect(html).toContain(`/it-mobile-lines/${network}.png`);
      expect(html).toContain(ar(`it.mobileLines.network.${network}`));
    }
    const vodafone = html.slice(
      html.indexOf('data-network-pick="vodafone"'),
      html.indexOf('data-network-pick="etisalat"'),
    );
    expect(vodafone).toContain('٣١٢');
    expect(vodafone).toContain('٢٦٨');
    for (const status of ['inStock', 'assigned', 'suspended']) {
      expect(vodafone).toContain(`data-network-count="${status}"`);
      expect(vodafone).toContain(ar(`it.mobileLines.status.${status}`));
    }
    // The account numbers the lines are billed on — as written, not as a quantity.
    expect(vodafone).toContain('6.293541');
    expect(vodafone).toContain(ar('it.mobileLines.card.noAccount'));
  });

  it('sits above the other filters — the status and who holds the line', () => {
    const html = render();
    expect(html).toContain(ar('it.mobileLines.allStatuses'));
    expect(html).toContain(ar('it.mobileLines.allHolderKinds'));
  });
});

describe('the register’s rows', () => {
  it('puts the line’s own network logo beside its name, in the row', () => {
    const body = tableBody(render({ rows: [line()] }));
    expect(body).toContain('data-network="etisalat"');
    expect(body).toContain('/it-mobile-lines/etisalat.png');
    expect(body).toContain(ar('it.mobileLines.network.etisalat'));
    // Only the row's network: the other two marks are the cards', above the table.
    expect(body).not.toContain('/it-mobile-lines/vodafone.png');
    expect(body).not.toContain('/it-mobile-lines/orange.png');
  });

  it('writes the number and the ICCID as the network does — never re-digited', () => {
    const body = tableBody(render({ rows: [line()] }));
    expect(body).toContain('01112345678');
    expect(body).toContain('8920011234567890123');
    expect(body).toContain('Business 500');
  });

  it('names an employee holder with a link to their history, and a car by its code and plate', () => {
    const body = tableBody(render({ rows: [HELD, IN_CAR] }));
    expect(body).toContain('href="/it/employees/e-1"');
    expect(body).toContain('محمد أحمد علي');
    expect(body).toContain('0100052');
    expect(body).toContain('data-line-holder="vehicle"');
    expect(body).toContain(ar('it.mobileLines.holderKind.vehicle'));
    expect(body).toContain('204');
    expect(body).toContain('س ص 63');
    // An eSIM has no serial to show — it says what it is.
    expect(body).toContain(ar('it.mobileLines.esim'));
  });

  it('offers each action where the status allows it and the grant does', () => {
    const body = tableBody(render({ rows: [line(), HELD, STOPPED] }));
    const row = (id: string): string => {
      const at = body.indexOf(id);
      return body.slice(body.lastIndexOf('<tr', at), body.indexOf('</tr>', at));
    };
    const actions = (html: string): string[] =>
      [...html.matchAll(/data-line-action="([^"]+)"/gu)].map((m) => m[1] ?? '');
    expect(actions(row('01112345678'))).toEqual(['handOver', 'suspend', 'edit', 'history']);
    // The held line: its acknowledgment (print again, awaiting the signed copy), then the return.
    expect(row('01012345678')).toContain('data-receipt-print="r-1"');
    expect(row('01012345678')).toContain(ar('it.custody.receipt.awaitingSignature'));
    expect(actions(row('01012345678'))).toEqual(['return', 'edit', 'history']);
    expect(actions(row('01155555555'))).toEqual(['reactivate', 'edit', 'history']);
  });

  it('a reader holding only the view grant may look at the history, and nothing else', () => {
    const html = render({ permissions: ['itAsset.view'], rows: [line(), HELD, STOPPED] });
    const body = tableBody(html);
    expect([...body.matchAll(/data-line-action="([^"]+)"/gu)].map((m) => m[1])).toEqual([
      'history',
      'history',
      'history',
    ]);
    expect(html).not.toContain(ar('it.mobileLines.create'));
  });
});
