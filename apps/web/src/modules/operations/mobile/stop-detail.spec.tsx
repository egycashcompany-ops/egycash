// Phase C3 + C4 — the stop a captain is about to act on, and the act itself.
//
// The rules under test are the ones a screenshot cannot show:
//   · a LOCKED stop is readable but offers no way to execute, and says why;
//   · the navigation link is built from COORDINATES, never from a stored URL;
//   · a branch with no point says so instead of rendering a blank;
//   · exactly ONE action is offered, and it is the single move the server's machine allows;
//   · a refused act is explained by what actually happened, never as "something went wrong".
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
import { ApiError } from '../../../shared/lib/api-client';
import { StopDetailPage } from './StopDetailPage';
import { executionErrorMessage, isStateConflict } from './execution-errors';

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
    external: null,
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

describe('the current stop offers exactly one act — the server’s next move', () => {
  const actionFor = (executionStatus: OperationsMobileStopDto['executionStatus']): string =>
    render(day([stop({ executionStatus })]));

  it('offers start, then collection, then delivery, then finish', () => {
    expect(actionFor('pending')).toContain('بدء المهمة');
    expect(actionFor('active')).toContain('تأكيد الاستلام');
    expect(actionFor('pickedUp')).toContain('تأكيد التسليم');
    expect(actionFor('delivered')).toContain('إنهاء الشحنة');
  });

  it('offers only ONE of them at a time', () => {
    const html = actionFor('active');
    const offered = ['بدء المهمة', 'تأكيد الاستلام', 'تأكيد التسليم', 'إنهاء الشحنة'].filter((l) =>
      html.includes(l),
    );
    expect(offered).toEqual(['تأكيد الاستلام']);
  });

  it('says the stop is done instead of showing nothing, once it is completed', () => {
    const html = render(day([stop({ progress: 'completed', executionStatus: 'completed' })], null));
    expect(html).toContain('تمت');
  });
});

describe('a refused act is explained, not generalized', () => {
  const conflict = new ApiError('OPERATIONS_EXECUTION_CONFLICT', 'stale', 409);
  const settled = new ApiError('OPERATIONS_EXECUTION_ALREADY_SETTLED', 'settled', 422);
  const sequence = new ApiError('OPERATIONS_EXECUTION_OUT_OF_SEQUENCE', 'order', 422);
  const transition = new ApiError('OPERATIONS_INVALID_EXECUTION_TRANSITION', 'illegal', 422);
  const forbidden = new ApiError('FORBIDDEN', 'not yours', 403);
  const missing = new ApiError('NOT_FOUND', 'gone', 404);

  it('treats a lost race as "the state moved", not as the captain’s mistake', () => {
    expect(isStateConflict(conflict)).toBe(true);
    expect(isStateConflict(settled)).toBe(true);
    expect(executionErrorMessage(conflict, 'ar')).toBe('تغيّرت حالة المهمة، جارٍ تحديث البيانات…');
  });

  it('never falls back to the generic message for a code the server distinguishes', () => {
    const GENERIC = 'حدث خطأ ما. يُرجى المحاولة مجددًا.';
    for (const error of [conflict, settled, sequence, transition, forbidden, missing]) {
      expect(executionErrorMessage(error, 'ar'), error.code).not.toBe(GENERIC);
    }
  });

  it('says a reassigned route is a reassignment, not "forbidden"', () => {
    // A captain taken off the route mid-shift has to be told that, not shown a permissions error.
    expect(executionErrorMessage(forbidden, 'ar')).toBe('لم تعد هذه المهمة ضمن مسارك اليوم.');
  });

  it('names the sequential lock when the server refuses on order', () => {
    expect(executionErrorMessage(sequence, 'ar')).toBe('يجب إتمام المحطة السابقة أولًا.');
  });

  it('leaves network and auth failures to the app-wide handler', () => {
    // Nothing here should restate what the app already says well about a dropped connection.
    expect(isStateConflict(new TypeError('Failed to fetch'))).toBe(false);
    expect(executionErrorMessage(new TypeError('Failed to fetch'), 'ar')).toContain('الشبكة');
    expect(executionErrorMessage(new ApiError('AUTH_TOKEN_EXPIRED', 'x', 401), 'ar')).toContain(
      'جلستك',
    );
  });
});
