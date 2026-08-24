// Phase C2 — what the captain's route actually SHOWS.
//
// Rendered rather than asserted on source, because the things that matter here are visible facts:
// that the stops appear in the server's order and are not re-sorted, that a locked stop says WHY
// it is locked, and that a branch with no coordinates says so instead of rendering a blank where a
// captain expects an address.
//
// `renderToStaticMarkup` in a node environment, which is the harness this repo already uses for
// exactly this kind of contract assertion (see `vitest.config.ts`). No DOM, no clicking — C2 has
// nothing to click yet.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type Locale,
  type MeDto,
  type OperationsMobileDayDto,
  type OperationsMobileStopDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { CaptainDayPage } from './CaptainDayPage';

const place = (over = {}) => ({
  branchId: 'b-1',
  branchName: 'فرع التحرير',
  branchCode: '001',
  bankName: 'البنك الأهلي',
  areaName: 'وسط البلد',
  location: null,
  ...over,
});

const stop = (over: Partial<OperationsMobileStopDto> = {}): OperationsMobileStopDto =>
  ({
    assignmentId: 'a-1',
    shipmentId: 's-1',
    operationsDayId: 'd-1',
    sequence: 1,
    leg: 'pickup',
    vehicleId: 'v-1',
    crewAssignmentId: 'c-1',
    shipmentType: 'daily',
    status: 'draft',
    progress: 'current',
    executionStatus: 'pending',
    startedAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    completedAt: null,
    version: 0,
    referenceNumber: 'REF-001',
    packaging: null,
    pickup: place(),
    delivery: place({ branchId: 'b-2', branchName: 'فرع المهندسين', areaName: 'المهندسين' }),
    ...over,
  }) as OperationsMobileStopDto;

const day = (over: Partial<OperationsMobileDayDto> = {}): OperationsMobileDayDto =>
  ({
    date: '2026-08-18T00:00:00.000Z',
    operationsDayId: 'd-1',
    dayStatus: 'open',
    captain: { employeeId: 'e-1', code: 'EMP-0007', fullNameAr: 'محمود سيد' },
    isCaptainOnDay: true,
    assignments: [],
    stops: [],
    currentAssignmentId: null,
    ...over,
  }) as OperationsMobileDayDto;

const me = (permissions: string[]): MeDto =>
  ({
    id: 'u-1',
    email: 'captain@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'م', en: 'M' }, lastName: { ar: 'س', en: 'S' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: null,
    employeeId: 'e-1',
    permissions: Object.fromEntries(permissions.map((k) => [k, 'own' as const])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as MeDto;

const render = (
  value: OperationsMobileDayDto,
  { locale = 'ar' as Locale, permissions = ['operationsExecution.own'] } = {},
): string => {
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
  qc.setQueryData(listKey('operations', 'myDay', { date: 'today' }), value);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/operations/my-day']}>
          <Routes>
            <Route path="/operations/my-day" element={<CaptainDayPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('the three no-duty screens read differently', () => {
  it('tells a rostered captain with no stops that he IS the captain', () => {
    const html = render(day({ isCaptainOnDay: true, stops: [] }));
    expect(html).toContain('تم تعيينك كقائد اليوم');
    // The failure this guards: showing "no duty today" to somebody who is on the crew row.
    expect(html).not.toContain('لا توجد مهمة تشغيلية اليوم');
  });

  it('tells a non-captain he has no duty — and does not call it an error', () => {
    const html = render(day({ isCaptainOnDay: false, stops: [] }));
    expect(html).toContain('لا توجد مهمة تشغيلية اليوم');
    expect(html).not.toContain('تعذّر التحميل');
    expect(html).not.toContain('حدث خطأ ما');
  });

  it('says the operating day is not open when there is none', () => {
    const html = render(day({ operationsDayId: null, isCaptainOnDay: false }));
    expect(html).toContain('لم يُفتح يوم التشغيل');
  });
});

describe('the route renders in the server’s order', () => {
  const stops = [
    stop({ assignmentId: 'a-1', sequence: 1, progress: 'completed', executionStatus: 'completed', referenceNumber: 'REF-ONE' }),
    stop({ assignmentId: 'a-2', sequence: 2, progress: 'current', referenceNumber: 'REF-TWO' }),
    stop({ assignmentId: 'a-3', sequence: 3, progress: 'locked', referenceNumber: 'REF-THREE' }),
  ];
  const html = render(day({ stops, currentAssignmentId: 'a-2' }));

  it('shows every stop', () => {
    for (const reference of ['REF-ONE', 'REF-TWO', 'REF-THREE']) {
      expect(html, reference).toContain(reference);
    }
  });

  it('keeps them in the order the server sent, never re-sorted', () => {
    // The sequence is what the execution lock is enforced against; re-ordering here would put the
    // screen and the API in disagreement about which stop is next.
    expect(html.indexOf('REF-ONE')).toBeLessThan(html.indexOf('REF-TWO'));
    expect(html.indexOf('REF-TWO')).toBeLessThan(html.indexOf('REF-THREE'));
  });

  it('marks the current stop as the current step for assistive technology', () => {
    expect(html).toContain('aria-current="step"');
    // Exactly one — "current" is singular by definition of the lock.
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it('says WHY a locked stop is locked, in words and not only in colour', () => {
    expect(html).toContain('مقفلة حتى إتمام المحطة السابقة');
  });

  it('distinguishes completed and current without relying on colour', () => {
    expect(html).toContain('محطتك الحالية');
    expect(html).toContain('تمت');
  });

  it('counts the day’s progress from what the server marked completed', () => {
    expect(html).toContain('تم 1 من 3');
  });
});

describe('locations', () => {
  it('says a branch has no location rather than leaving a blank', () => {
    const html = render(day({ stops: [stop()], currentAssignmentId: 'a-1' }));
    expect(html).toContain('الموقع غير محدد لهذا الفرع');
  });

  it('says a location is available when the branch carries coordinates', () => {
    const located = stop({
      pickup: place({ location: { addressLine: null, coordinates: { lat: 30.04, lng: 31.23 } } }),
    });
    const html = render(day({ stops: [located], currentAssignmentId: 'a-1' }));
    expect(html).toContain('الموقع متاح');
  });
});

describe('both legs and both shipment types are named', () => {
  it('names the leg, so a secured shipment’s two stops are told apart', () => {
    const html = render(
      day({
        stops: [
          stop({ assignmentId: 'a-1', sequence: 1, leg: 'pickup', shipmentType: 'secured' }),
          stop({ assignmentId: 'a-2', sequence: 2, leg: 'delivery', shipmentType: 'secured', progress: 'locked' }),
        ],
        currentAssignmentId: 'a-1',
      }),
    );
    expect(html).toContain('استلام');
    expect(html).toContain('تسليم');
    expect(html).toContain('محصنة');
  });
});
