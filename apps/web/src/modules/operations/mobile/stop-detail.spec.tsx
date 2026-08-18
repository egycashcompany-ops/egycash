// Phase C3 — the stop a captain is about to act on.
//
// The rules under test are the ones a screenshot cannot show:
//   · a LOCKED stop is readable but offers no way to execute, and says why;
//   · the navigation link is built from COORDINATES, never from a stored URL;
//   · a branch with no point says so instead of rendering a blank.
//
// The acts themselves — and what happens when one is refused — arrive with C4.
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
import { StopDetailPage } from './StopDetailPage';

const CAIRO = { lat: 30.0444, lng: 31.2357 };

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
    delivery: place({ branchId: 'b-2', branchName: 'فرع المهندسين' }),
    ...over,
  }) as OperationsMobileStopDto;

const day = (stops: OperationsMobileStopDto[], currentAssignmentId: string | null = 'a-1') =>
  ({
    date: '2026-08-18T00:00:00.000Z',
    operationsDayId: 'd-1',
    dayStatus: 'open',
    captain: { employeeId: 'e-1', code: 'EMP-0007', fullNameAr: 'محمود سيد' },
    isCaptainOnDay: true,
    assignments: [],
    stops,
    currentAssignmentId,
  }) as OperationsMobileDayDto;

const me = (): MeDto =>
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
    permissions: { 'operationsExecution.own': 'own' as const },
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
  }) as MeDto;

const render = (value: OperationsMobileDayDto, assignmentId = 'a-1', locale: Locale = 'ar'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(), status: 'signedIn' as const },
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
        <MemoryRouter initialEntries={[`/operations/my-day/stops/${assignmentId}`]}>
          <Routes>
            <Route path="/operations/my-day/stops/:assignmentId" element={<StopDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('the stop is read out of the day, not fetched alone', () => {
  it('shows the stop that matches the id in the URL', () => {
    const html = render(
      day([
        stop({ assignmentId: 'a-1', referenceNumber: 'REF-ONE' }),
        stop({ assignmentId: 'a-2', sequence: 2, progress: 'locked', referenceNumber: 'REF-TWO' }),
      ]),
      'a-2',
    );
    expect(html).toContain('REF-TWO');
    expect(html).not.toContain('REF-ONE');
  });

  it('says so plainly when the id is not on today’s route', () => {
    // A stale link, a day that moved on, or somebody else's stop — all of which the server would
    // refuse anyway, and none worth guessing between.
    expect(render(day([stop()]), 'a-999')).toContain('هذه المحطة ليست ضمن مسار اليوم');
  });
});

describe('locations come from coordinates', () => {
  it('builds the navigation link from the point, not from any stored URL', () => {
    const html = render(
      day([stop({ pickup: place({ location: { addressLine: null, coordinates: CAIRO } }) })]),
    );
    expect(html).toContain('https://www.google.com/maps?q=30.0444,31.2357');
    expect(html).toContain('فتح الموقع');
  });

  it('says a branch has no location rather than leaving a blank or breaking', () => {
    const html = render(day([stop()]));
    expect(html).toContain('الموقع غير محدد لهذا الفرع');
    expect(html).not.toContain('google.com/maps');
  });

  it('shows both ends of the leg, collect before deliver', () => {
    const html = render(day([stop()]));
    expect(html).toContain('الاستلام من');
    expect(html).toContain('التسليم إلى');
    expect(html.indexOf('الاستلام من')).toBeLessThan(html.indexOf('التسليم إلى'));
  });

  it('shows the address line when the branch has one', () => {
    const html = render(
      day([
        stop({
          pickup: place({ location: { addressLine: '١٥ شارع التحرير', coordinates: CAIRO } }),
        }),
      ]),
    );
    expect(html).toContain('١٥ شارع التحرير');
  });
});

describe('a locked stop is readable but not actionable', () => {
  const html = render(
    day(
      [
        stop({ assignmentId: 'a-1', progress: 'current' }),
        stop({ assignmentId: 'a-2', sequence: 2, progress: 'locked', executionStatus: 'pending' }),
      ],
      'a-1',
    ),
    'a-2',
  );

  it('says WHY it is locked', () => {
    expect(html).toContain('هذه الشحنة مقفلة حتى إتمام الشحنة السابقة.');
  });

  it('offers no execution button at all', () => {
    // Not disabled — absent. The sequential lock is the server's, and a button the API would
    // refuse must never reach the screen.
    for (const label of ['بدء المهمة', 'تأكيد الاستلام', 'تأكيد التسليم', 'إنهاء الشحنة']) {
      expect(html, label).not.toContain(label);
    }
  });
});
