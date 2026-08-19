// AT-6 — what the four screens actually SHOW, asserted as markup facts.
//
// This suite has no DOM, so nothing can be typed and no dialog can be opened (`Dialog` portals to
// `document.body`). What it can prove is precisely what the route specs cannot: that a control
// appears only for a caller holding its key, that the queue offers a decision only on a pending
// request, that every number rendered is a QUANTITY, and that both locales render their own text.
//
// What the SERVER enforces — the two-step chain, the own scope, the overtime ceiling, the frozen
// guard — is proven in `apps/api/tests/integration/hr-attendance.spec.ts`. Nothing on a screen can
// enforce any of it; these screens only avoid offering what the server would refuse.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type AttendanceDayDto,
  type AttendanceRegularizationDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { DailySheetPage } from './pages/DailySheetPage';
import { MyAttendancePage } from './pages/MyAttendancePage';
import { RegularizationQueuePage } from './pages/RegularizationQueuePage';
import { EmployeeMonthPage } from './pages/EmployeeMonthPage';
import { monthBounds } from './components/month';

const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);

const day = (over: Partial<AttendanceDayDto> = {}): AttendanceDayDto => ({
  id: 'd-1',
  employeeId: 'e-1',
  workDate: TODAY,
  status: 'late',
  shiftId: 's-1',
  firstInAt: `${TODAY}T07:20:00.000Z`,
  lastOutAt: `${TODAY}T15:00:00.000Z`,
  workedMinutes: 460,
  lateMinutes: 20,
  earlyLeaveMinutes: 0,
  overtimeMinutes: 90,
  approvedOvertimeMinutes: 30,
  leaveId: null,
  flags: ['manualPunch'],
  branchId: 'b-1',
  computedAt: `${TODAY}T18:00:00.000Z`,
  frozenAt: null,
  version: 3,
  employeeCode: 'EMP-0007',
  employeeName: 'سارة أحمد',
  ...over,
});

const regularization = (
  over: Partial<AttendanceRegularizationDto> = {},
): AttendanceRegularizationDto => ({
  id: 'r-1',
  employeeId: 'e-1',
  workDate: TODAY,
  proposedInAt: `${TODAY}T07:00:00.000Z`,
  proposedOutAt: `${TODAY}T15:00:00.000Z`,
  reason: 'device failure at the branch gate',
  status: 'pendingManager',
  postFreeze: false,
  direct: false,
  managerDecidedBy: null,
  managerDecidedAt: null,
  managerComment: null,
  hrDecidedBy: null,
  hrDecidedAt: null,
  hrComment: null,
  branchId: 'b-1',
  version: 0,
  createdAt: `${TODAY}T06:00:00.000Z`,
  updatedAt: `${TODAY}T06:00:00.000Z`,
  employeeCode: 'EMP-0007',
  employeeName: 'سارة أحمد',
  ...over,
});

const me = (permissions: string[], employeeId: string | null): MeDto => ({
  id: 'u-1',
  email: 'user@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  theme: 'system',
  navLayout: 'rail',
  branchId: null,
  employeeId,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
  external: null,
});

const paged = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 },
});

const render = (
  node: JSX.Element,
  {
    locale = 'en',
    permissions = [],
    employeeId = 'e-1',
    path = '/attendance/daily',
    seed = () => undefined,
  }: {
    locale?: Locale;
    permissions?: string[];
    employeeId?: string | null;
    path?: string;
    seed?: (qc: QueryClient) => void;
  } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions, employeeId), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/attendance/daily" element={node} />
            <Route path="/attendance/me" element={node} />
            <Route path="/attendance/regularizations" element={node} />
            <Route path="/attendance/employees/:id" element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const dailyFilters = { from: TODAY, to: TODAY, page: 1, pageSize: 50 };

const sheet = (options: Parameters<typeof render>[1] = {}): string =>
  render(<DailySheetPage />, {
    seed: (qc) => qc.setQueryData(listKey('hr', 'attendanceDays', dailyFilters), paged([day()])),
    ...options,
  });

describe('the daily sheet reads quantities and offers only what the caller may do', () => {
  it('renders the derived numbers for the day', () => {
    const html = sheet({ permissions: ['attendance.view'] });
    expect(html).toContain('EMP-0007');
    // worked 460 → 7:40, late 20 → 0:20, overtime approved 30 / derived 90.
    expect(html).toContain('7:40');
    expect(html).toContain('0:20');
    expect(html).toContain('0:30');
    expect(html).toContain('1:30');
  });

  // §1: a sheet that showed a value would have crossed into Payroll. The markup is the proof.
  it('shows no money, anywhere', () => {
    const html = sheet({ permissions: ['attendance.view', 'attendance.export'] });
    expect(html).not.toMatch(/EGP|ج\.م|salary|amount/i);
  });

  it('offers the CSV only to a holder of attendance.export', () => {
    expect(sheet({ permissions: ['attendance.view', 'attendance.export'] })).toContain(
      'Export CSV',
    );
    expect(sheet({ permissions: ['attendance.view'] })).not.toContain('Export CSV');
  });

  it('offers the overtime approval only to a holder of the key, and only on an unfrozen surplus', () => {
    const withKey = sheet({ permissions: ['attendance.view', 'attendance.approveOvertime'] });
    expect(withKey).toContain('Approve overtime');
    expect(sheet({ permissions: ['attendance.view'] })).not.toContain('Approve overtime');

    // Frozen: the correction flows forward as an adjustment, so no button.
    const frozen = sheet({
      permissions: ['attendance.view', 'attendance.approveOvertime'],
      seed: (qc) =>
        qc.setQueryData(
          listKey('hr', 'attendanceDays', dailyFilters),
          paged([day({ frozenAt: `${TODAY}T23:00:00.000Z` })]),
        ),
    });
    expect(frozen).not.toContain('Approve overtime');
    expect(frozen).toContain('Frozen');

    // No derived surplus: nothing to release.
    const noOvertime = sheet({
      permissions: ['attendance.view', 'attendance.approveOvertime'],
      seed: (qc) =>
        qc.setQueryData(
          listKey('hr', 'attendanceDays', dailyFilters),
          paged([day({ overtimeMinutes: 0, approvedOvertimeMinutes: 0 })]),
        ),
    });
    expect(noOvertime).not.toContain('Approve overtime');
  });

  it('renders Arabic copy in Arabic', () => {
    const html = sheet({ locale: 'ar', permissions: ['attendance.view'] });
    expect(html).toContain('الحضور اليومي');
    expect(html).toContain('متأخر');
    expect(html).not.toContain('Daily attendance');
  });
});

describe('the regularization queue reflects the two-step chain', () => {
  const queue = (rows: AttendanceRegularizationDto[], locale: Locale = 'en'): string =>
    render(<RegularizationQueuePage />, {
      locale,
      permissions: ['attendance.decideRegularization'],
      path: '/attendance/regularizations',
      seed: (qc) =>
        qc.setQueryData(listKey('hr', 'attendancePendingRegularizations', {}), rows),
    });

  it('shows both pending steps as awaiting a decision', () => {
    const html = queue([
      regularization({ status: 'pendingManager' }),
      regularization({ id: 'r-2', status: 'pendingHr' }),
    ]);
    expect(html).toContain('Awaiting manager');
    expect(html).toContain('Awaiting HR');
    // Two rows, each with its own approve/reject pair.
    expect([...html.matchAll(/Approve</g)]).toHaveLength(2);
    expect([...html.matchAll(/Reject</g)]).toHaveLength(2);
  });

  it('offers no decision on a request that is already decided', () => {
    for (const status of ['approved', 'rejected', 'cancelled'] as const) {
      const html = queue([regularization({ status })]);
      expect(html, status).not.toContain('Reject<');
    }
  });

  it('marks a correction that landed after the freeze', () => {
    const html = queue([regularization({ status: 'approved', postFreeze: true })]);
    expect(html).toContain('After freeze');
  });

  it('renders Arabic copy in Arabic', () => {
    const html = queue([regularization()], 'ar');
    expect(html).toContain('تسويات الحضور');
    expect(html).toContain('بانتظار المدير');
  });
});

describe('My Attendance is self-service only', () => {
  const mine = (options: Parameters<typeof render>[1] = {}): string =>
    render(<MyAttendancePage />, {
      path: '/attendance/me',
      seed: (qc) => {
        const { from, to } = monthBounds(MONTH);
        qc.setQueryData(
          listKey('hr', 'attendanceMyDays', { from, to, page: 1, pageSize: 62 }),
          paged([day()]),
        );
        qc.setQueryData(
          listKey('hr', 'attendanceMyRegularizations', { page: 1, pageSize: 25 }),
          paged([regularization()]),
        );
      },
      ...options,
    });

  it('renders my month and my requests', () => {
    const html = mine({ permissions: ['attendance.view'] });
    expect(html).toContain('My attendance');
    expect(html).toContain('7:40');
    expect(html).toContain('device failure at the branch gate');
  });

  // The employee sees their own request but decides nothing — C7 in the markup.
  it('never offers a decision on my own request', () => {
    const html = mine({
      permissions: ['attendance.view', 'attendance.decideRegularization'],
    });
    expect(html).not.toContain('Reject<');
  });

  it('offers filing only to a holder of attendance.requestRegularization', () => {
    expect(
      mine({ permissions: ['attendance.view', 'attendance.requestRegularization'] }),
    ).toContain('Request a correction');
    expect(mine({ permissions: ['attendance.view'] })).not.toContain('Request a correction');
  });

  it('explains itself when the login has no employee record', () => {
    const html = mine({ permissions: ['attendance.view'], employeeId: null });
    expect(html).toContain('not linked to an employee record');
  });
});

describe('the employee month', () => {
  it('renders one cell per calendar day of the chosen month', () => {
    const { from, to } = monthBounds(MONTH);
    const html = render(<EmployeeMonthPage />, {
      permissions: ['attendance.view'],
      path: `/attendance/employees/e-1?month=${MONTH}`,
      seed: (qc) =>
        qc.setQueryData(
          listKey('hr', 'attendanceDays', {
            from,
            to,
            employeeId: 'e-1',
            page: 1,
            pageSize: 62,
          }),
          paged([day()]),
        ),
    });
    const dayCount = Number(to.slice(-2));
    expect([...html.matchAll(/role="listitem"/g)]).toHaveLength(dayCount);
    expect(html).toContain('سارة أحمد');
  });
});
