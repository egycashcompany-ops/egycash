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
  type AttendanceDecisionDto,
  type AttendanceRegularizationDto,
  type AttendanceSheetRowDto,
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
import { cairoToday, periodRange } from './components/period';

/** What all three employee screens open on, and therefore the key their rows are seeded under. */
const PERIOD = periodRange('thisMonth');
/** One page of days — the screens ask for the server's maximum (`MAX_PAGE_SIZE`). */
const DAYS_PAGE = 100;

// The company's day, as the sheet itself reads it (`cairoToday`): the UTC date is a different day for
// the two hours after midnight in Cairo, and the sheet then shows a day these rows are not on.
const TODAY = cairoToday();

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
  branchIds: [],
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

/**
 * A sheet LINE, which is a person rather than a row: `day` is null for somebody the engine has
 * written nothing for, and `status` is the resolved label the server worked out when it was read.
 */
const sheetRow = (over: Partial<AttendanceSheetRowDto> = {}): AttendanceSheetRowDto => ({
  employeeId: 'e-1',
  employeeCode: 'EMP-0007',
  employeeName: 'سارة أحمد',
  employeePhotoFileId: null,
  branchId: 'b-1',
  date: TODAY,
  status: 'late',
  expectedStartAt: `${TODAY}T07:00:00.000Z`,
  expectedEndAt: `${TODAY}T15:00:00.000Z`,
  day: day(),
  ...over,
});

const dailyFilters = { date: TODAY, page: 1, pageSize: 50 };

/** Seeds the SHEET cache — the daily sheet reads `/days/sheet`, not the day list. */
const seedSheet =
  (rows: AttendanceSheetRowDto[]) =>
  (qc: QueryClient): void => {
    qc.setQueryData(listKey('hr', 'attendanceSheet', dailyFilters), paged(rows));
  };

const sheet = (options: Parameters<typeof render>[1] = {}): string =>
  render(<DailySheetPage />, { seed: seedSheet([sheetRow()]), ...options });

describe('the daily sheet reads quantities and offers only what the caller may do', () => {
  it('renders the derived numbers for the day', () => {
    const html = sheet({ permissions: ['attendance.view'] });
    expect(html).toContain('EMP-0007');
    // late 20 → 0:20, overtime approved 30 / derived 90.
    //
    // WORKED HOURS ARE NO LONGER A COLUMN HERE (stage 6, the owner's column list). The sheet
    // answers "who is in, and are they on time" — the span it already shows is where the hours
    // come from, and on a payroll where most people never scan out the figure was 0:00 on the
    // majority of rows anyway. The employee's month still carries it.
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
      seed: seedSheet([sheetRow({ day: day({ frozenAt: `${TODAY}T23:00:00.000Z` }) })]),
    });
    expect(frozen).not.toContain('Approve overtime');
    expect(frozen).toContain('Frozen');

    // No derived surplus: nothing to release.
    const noOvertime = sheet({
      permissions: ['attendance.view', 'attendance.approveOvertime'],
      seed: seedSheet([sheetRow({ day: day({ overtimeMinutes: 0, approvedOvertimeMinutes: 0 }) })]),
    });
    expect(noOvertime).not.toContain('Approve overtime');
  });

  it('renders Arabic copy in Arabic', () => {
    const html = sheet({ locale: 'ar', permissions: ['attendance.view'] });
    expect(html).toContain('الحضور اليومي');
    expect(html).toContain('متأخر');
    expect(html).not.toContain('Daily attendance');
  });

  it('shows a person with NO day row as «لم يحضر بعد», and offers nothing to approve on them', () => {
    // The stage-2 line: an employee nobody has recomputed today. There are no quantities to print
    // and no version to send, so every number is a dash and the approval is not offered — but the
    // person is on the sheet, which is the entire point of the change.
    const html = sheet({
      locale: 'ar',
      permissions: ['attendance.view', 'attendance.approveOvertime'],
      seed: seedSheet([sheetRow({ status: 'pending', day: null })]),
    });
    expect(html).toContain('EMP-0007');
    expect(html).toContain('لم يحضر بعد');
    expect(html).not.toContain('اعتماد الإضافي');
  });

  it('prints the expected hours, which no day row carries', () => {
    const html = sheet({ permissions: ['attendance.view'] });
    // 07:00–15:00 UTC is 09:00–17:00 in Cairo — the 24-hour business clock (R10), never the
    // browser's zone — and the sheet is the only screen that shows it.
    expect(html).toContain('Expected');
    expect(html.replace(/<[^>]+>/g, '')).toContain('09:00 → 17:00');
  });

  it('isolates each time, so the pair does not reorder itself in Arabic', () => {
    // Arabic-Indic digits are bidi class AN, and UAX#9 gives a neutral between two AN runs the
    // RIGHT-to-left direction — so «٠٩:٠٠ → ١٧:٠٠» written as one string renders as
    // «١٧:٠٠ → ٠٩:٠٠», departure first, with `dir="ltr"` on the parent powerless to stop it.
    // Each time carries its own `dir`, which makes it an isolate. This is that, asserted.
    expect(sheet({ permissions: ['attendance.view'] })).toContain('<span dir="ltr">09:00</span>');
  });
});

describe('deciding a day (stage 3)', () => {
  const decision = (over: Partial<AttendanceDecisionDto> = {}): AttendanceDecisionDto => ({
    id: 'dec-1',
    employeeId: 'e-1',
    workDate: TODAY,
    type: 'markPresent',
    inAt: `${TODAY}T07:00:00.000Z`,
    outAt: null,
    reason: 'الجهاز كان متوقفًا وتم التحقق من الحضور',
    status: 'pendingHr',
    overrodePunch: false,
    decidedBy: 'u-9',
    decidedAt: `${TODAY}T08:00:00.000Z`,
    hrDecidedBy: null,
    hrDecidedAt: null,
    hrComment: null,
    revokesId: null,
    branchId: 'b-1',
    version: 0,
    createdAt: `${TODAY}T08:00:00.000Z`,
    updatedAt: `${TODAY}T08:00:00.000Z`,
    employeeCode: 'EMP-0007',
    employeeName: 'سارة أحمد',
    ...over,
  });

  const decisionsTab = (rows: AttendanceDecisionDto[], permissions: string[]): string =>
    render(<RegularizationQueuePage />, {
      permissions,
      path: '/attendance/regularizations?tab=decisions',
      seed: (qc) =>
        qc.setQueryData(
          listKey('hr', 'attendanceDecisions', { page: 1, pageSize: 25, status: ['pendingHr'] }),
          paged(rows),
        ),
    });

  it('offers Decide on the sheet only to a holder of attendance.decide', () => {
    expect(sheet({ permissions: ['attendance.view', 'attendance.decide'] })).toContain('Decide');
    expect(sheet({ permissions: ['attendance.view'] })).not.toContain('Decide');
  });

  it('offers Decide on a line with NO day row — the commonest case for it', () => {
    const html = sheet({
      permissions: ['attendance.view', 'attendance.decide'],
      seed: seedSheet([sheetRow({ status: 'absent', day: null })]),
    });
    expect(html).toContain('Decide');
  });

  it('does not offer Decide on a frozen day, which the server would refuse', () => {
    const html = sheet({
      permissions: ['attendance.view', 'attendance.decide'],
      seed: seedSheet([sheetRow({ day: day({ frozenAt: `${TODAY}T23:00:00.000Z` }) })]),
    });
    expect(html).not.toContain('Decide');
  });

  it('shows the queue with the REASON in full — it is what HR is approving', () => {
    const html = decisionsTab([decision()], ['attendance.decideApprove']);
    expect(html).toContain('EMP-0007');
    expect(html).toContain('الجهاز كان متوقفًا وتم التحقق من الحضور');
    expect(html).toContain('Awaiting HR');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
  });

  it('marks a decision taken against device evidence', () => {
    const html = decisionsTab([decision({ overrodePunch: true })], ['attendance.decideApprove']);
    expect(html).toContain('Decided against device evidence');
  });

  it('offers no verdict to somebody holding only the deciding key', () => {
    // `decide` makes decisions; `decideApprove` clears them. One person holding both can still not
    // approve their own — the server enforces that, and it is proven in the API suite.
    const html = decisionsTab([decision()], ['attendance.decide']);
    expect(html).not.toContain('Approve');
    expect(html).toContain('Revoke');
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
        qc.setQueryData(
          listKey('hr', 'attendanceMyDays', { ...PERIOD, page: 1, pageSize: DAYS_PAGE }),
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

describe('the employee period', () => {
  const month = (rows: AttendanceDayDto[], locale: Locale = 'en'): string =>
    render(<EmployeeMonthPage />, {
      locale,
      permissions: ['attendance.view'],
      path: `/attendance/employees/e-1?from=${PERIOD.from}&to=${PERIOD.to}`,
      seed: (qc) =>
        qc.setQueryData(
          listKey('hr', 'attendanceDays', {
            from: PERIOD.from,
            to: PERIOD.to,
            employeeId: 'e-1',
            page: 1,
            pageSize: DAYS_PAGE,
          }),
          paged(rows),
        ),
    });

  it('leads with who it is about and what the period came to', () => {
    const html = month([day()]);
    expect(html).toContain('سارة أحمد');
    expect(html).toContain('EMP-0007');
    // The four figures, and the day behind them: in 09:20 Cairo, out 17:00, 7:40 worked.
    expect(html).toContain('Days present');
    expect(html).toContain('Usual arrival');
    expect(html).toContain('09:20');
    expect(html).toContain('17:00');
    expect(html).toContain('7:40');
  });

  it('says a day with no check-out is a check-in and not an absence', () => {
    const html = month([
      day({ status: 'checkedIn', lastOutAt: null, workedMinutes: 0, lateMinutes: 0, flags: [] }),
    ]);
    expect(html).toContain('Checked in only');
    // And no invented hours anywhere on it.
    expect(html).toContain('No day in this period has both a check-in and a check-out');
  });

  it('counts the checked-in day as a day present, exactly as payroll does', () => {
    const html = month([
      day({ status: 'checkedIn', lastOutAt: null, workedMinutes: 0 }),
      day({ id: 'd-2', status: 'weekend', firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
    ]);
    // One present out of ONE working day — the weekend is not in the denominator.
    expect(html).toContain('out of 1 working days');
  });

  it('shows no money, anywhere', () => {
    expect(month([day()])).not.toMatch(/ج\.م|EGP|جنيه/);
  });

  it('renders Arabic copy in Arabic', () => {
    const html = month([day()], 'ar');
    expect(html).toContain('السجل اليومي');
    expect(html).toContain('أيام الحضور');
  });
});
