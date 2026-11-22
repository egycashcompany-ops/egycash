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
  figuresOf,
  type AttendanceDayDto,
  type AttendanceEmployeeDayDto,
  type AttendanceDecisionDto,
  type AttendanceEmployeeSummaryDto,
  type AttendanceRegularizationDto,
  type AttendanceSheetRowDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice, setLocale } from '../../../store/localeSlice';
import { store as appStore } from '../../../store';
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

// The COMPANY's today (Africa/Cairo, R10), which is what the screens ask for. Read off UTC it is
// the wrong day for the two hours every night between Cairo midnight and UTC midnight: the page
// asks for one date, the seeded rows sit on another, and every assertion looks at an empty screen.
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
  shortfallMinutes: 20,
  requiredMinutes: 480,
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
  // `views/view-format.ts` reads the locale off the app's SINGLE store rather than through React
  // context, because its helpers are called from plain functions as well as from components. The
  // app has exactly one store, so that is correct there; a test that builds its own has to keep
  // the two in step, or every clock in the markup speaks the other language.
  appStore.dispatch(setLocale(locale));
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
  employeeDepartment: { ar: 'الخزينة', en: 'Treasury' },
  branchId: 'b-1',
  date: TODAY,
  status: 'late',
  expectedStartAt: `${TODAY}T07:00:00.000Z`,
  expectedEndAt: `${TODAY}T15:00:00.000Z`,
  day: day(),
  provisionalDay: null,
  employeeBranch: { ar: 'المهندسين', en: 'Mohandessin' },
  employeeJobTitle: { ar: 'أمين خزينة', en: 'Treasurer' },
  punchCount: 2,
  checkInCount: 1,
  checkOutCount: 1,
  // DERIVED FROM THE ROW'S OWN DAY, never written out beside it. Spelled separately they drifted
  // immediately: the day said twenty minutes late and the hand-written figures said none, so the
  // screen drew a dash and the test that asked for «0:20» was right to fail.
  figures: figuresOf(day()),
  ...over,
});

/**
 * The period's figures as the SERVER computes them. The screens do no arithmetic over a month, so
 * a test that invented its own totals here would be testing nothing the product does.
 */
const summary = (
  over: Partial<AttendanceEmployeeSummaryDto> = {},
): AttendanceEmployeeSummaryDto => ({
  from: PERIOD.from,
  to: PERIOD.to,
  employeeName: 'سارة أحمد',
  employeeCode: 'EMP-0007',
  daysPresent: 1,
  daysExpected: 1,
  usualArrival: 9 * 60 + 20,
  usualDeparture: 17 * 60,
  avgWorkedMinutes: 460,
  totalWorkedMinutes: 460,
  lateDays: 1,
  lateMinutesTotal: 20,
  shortfallMinutesTotal: 20,
  absentDays: 0,
  incompleteDays: 0,
  dayStart: 9 * 60,
  graceMinutes: 15,
  lastPunchAt: `${TODAY}T15:00:00.000Z`,
  noRecordDays: 0,
  noScheduleDays: 0,
  firstPunchAt: null,
  ...over,
});

/**
 * What the page asks for on first load — `sortBy` / `sortDir` included, because the order is part
 * of the request now and therefore part of the cache key. The default is check-in ascending, which
 * is how the sheet opens.
 */
const dailyFilters = { date: TODAY, page: 1, pageSize: 50, sortBy: 'checkIn', sortDir: 'asc' };

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
    // 07:00–15:00 UTC is 9 AM – 5 PM in Cairo — the business clock (R10), never the browser's
    // zone — and the sheet is the only screen that shows what was expected of somebody.
    const text = sheet({ permissions: ['attendance.view'] }).replace(/<[^>]+>/g, '');
    expect(text).toContain('9:00 AM – 5:00 PM');
  });

  it('writes the arrival before the departure, in the direction being read', () => {
    // The card puts the ARRIVAL first in reading order in both languages (start side in RTL and
    // LTR alike), so the eye reaches the check-in before the check-out either way.
    const en = sheet({ permissions: ['attendance.view'] }).replace(/<[^>]+>/g, '');
    expect(en.indexOf('9:20 AM')).toBeGreaterThan(-1);
    expect(en.indexOf('9:20 AM')).toBeLessThan(en.lastIndexOf('5:00 PM'));
    const ar = sheet({ locale: 'ar', permissions: ['attendance.view'] }).replace(/<[^>]+>/g, '');
    expect(ar.indexOf('9:20 ص')).toBeGreaterThan(-1);
    expect(ar.indexOf('9:20 ص')).toBeLessThan(ar.lastIndexOf('5:00 م'));
  });
});

describe('the order of the sheet, and the URL that holds it', () => {
  it('opens on check-in ascending and says so where a screen reader can hear it', () => {
    const html = sheet({ permissions: ['attendance.view'] });
    // The owner's default. The sort is a row of pressed/unpressed buttons now (a board of people,
    // not a table): `aria-pressed` is what a screen reader announces, the ▲ is for the eye.
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('▲');
    expect(html).toContain('Arrived');
    // Every sortable heading is a real BUTTON, so it is in the tab order and answers Enter and
    // Space with no key handling of our own — «keyboard-accessible headers», his words.
    expect(html).toContain('title="Sort descending"');
    for (const column of ['Employee', 'Code', 'Status', 'Arrived', 'Left', 'Worked', 'Late', 'Shortfall']) {
      expect(html, column).toContain(column);
    }
  });

  it('READS THE ORDER OUT OF THE URL, so a refresh, Back and a shared link all keep it', () => {
    // The request itself is keyed on the order, so seeding the cache under `worked`/`desc` and
    // getting rows back IS the proof that the page asked for that order: a page still asking for
    // the default would find nothing in the cache and render an empty table.
    const html = render(<DailySheetPage />, {
      permissions: ['attendance.view'],
      path: '/attendance/daily?sort=worked&dir=desc',
      seed: (qc) => {
        qc.setQueryData(
          listKey('hr', 'attendanceSheet', {
            date: TODAY,
            page: 1,
            pageSize: 50,
            sortBy: 'worked',
            sortDir: 'desc',
          }),
          paged([sheetRow()]),
        );
      },
    });
    expect(html).toContain('EMP-0007');
    expect(html).toContain('▼');
  });

  it('ignores a sort nobody declared rather than sending it to the server', () => {
    // A hand-edited or stale link must not travel to the server to be refused with a 400 — and
    // must not leave the screen empty either. It falls back to the default order.
    const html = render(<DailySheetPage />, {
      permissions: ['attendance.view'],
      path: '/attendance/daily?sort=salary&dir=sideways',
      seed: seedSheet([sheetRow()]),
    });
    expect(html).toContain('EMP-0007');
    expect(html).toContain('▲');
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
          listKey('hr', 'attendanceEmployeeSummary', { ...PERIOD, me: 1 }),
          summary(),
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
  const month = (
    rows: AttendanceEmployeeDayDto[],
    options: { locale?: Locale; figures?: AttendanceEmployeeSummaryDto; permissions?: string[] } = {},
  ): string =>
    render(<EmployeeMonthPage />, {
      locale: options.locale ?? 'en',
      permissions: options.permissions ?? ['attendance.view'],
      path: `/attendance/employees/e-1?from=${PERIOD.from}&to=${PERIOD.to}`,
      seed: (qc) => {
        // The resolved period, keyed as the page asks for it: no page or pageSize, because the
        // answer is one entry per calendar DATE rather than a page of stored rows.
        qc.setQueryData(
          listKey('hr', 'attendanceEmployeePeriod', {
            from: PERIOD.from,
            to: PERIOD.to,
            employeeId: 'e-1',
          }),
          rows,
        );
        qc.setQueryData(
          listKey('hr', 'attendanceEmployeeSummary', {
            employeeId: 'e-1',
            from: PERIOD.from,
            to: PERIOD.to,
          }),
          options.figures ?? summary(),
        );
      },
    });

  /**
   * A DATE AS THE SERVER RESOLVES IT. The screen is handed one of these per calendar day now, not
   * a page of stored rows — which is the fix: a date with no row used to be absent from the answer,
   * so the month skipped exactly the days that had punches and no recompute.
   */
  const resolved = (
    over: Partial<Omit<AttendanceEmployeeDayDto, 'figures'>> & {
      workedMinutes?: number;
      lateMinutes?: number;
    } = {},
  ): AttendanceEmployeeDayDto => {
    const { workedMinutes = 450, lateMinutes = 0, ...rest } = over;
    const firstInAt =
      'firstInAt' in rest ? (rest.firstInAt ?? null) : `${PERIOD.from}T06:40:00.000Z`;
    const lastOutAt =
      'lastOutAt' in rest ? (rest.lastOutAt ?? null) : `${PERIOD.from}T14:10:00.000Z`;
    return {
      date: PERIOD.from,
      status: 'present',
      expectedStartAt: null,
      expectedEndAt: null,
      provisional: false,
      frozen: false,
      flags: [],
      approvedOvertimeMinutes: 0,
      punches: [],
      repeatCount: 0,
      checkInCount: 0,
      checkOutCount: 0,
      ...rest,
      firstInAt,
      lastOutAt,
      // Through `figuresOf`, so a fixture with no check-out carries the server's blanks — which is
      // what the «حضر فقط» case below is checking the screen does with them.
      figures: figuresOf({
        firstInAt,
        lastOutAt,
        workedMinutes,
        lateMinutes,
        shortfallMinutes: 0,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        requiredMinutes: 480,
      }),
    };
  };

  it('leads with who it is about and the figures the server computed', () => {
    const html = month([resolved()]);
    expect(html).toContain('سارة أحمد');
    expect(html).toContain('EMP-0007');
    // The six figures, in the words the design uses — and the day behind them.
    expect(html).toContain('Days present');
    expect(html).toContain('Usual arrival');
    expect(html).toContain('On time');
    const text = html.replace(/<[^>]+>/g, '');
    expect(text).toContain('1/1');
    expect(text).toContain('9:20 AM');
    expect(text).toContain('7:40');
  });

  it('shows no figures at all until the server has sent them', () => {
    // A screen of zeros reads as «لم يحضر ولا يومًا», which is a claim about the person rather
    // than about a request still in flight.
    const html = render(<EmployeeMonthPage />, {
      permissions: ['attendance.view'],
      path: `/attendance/employees/e-1?from=${PERIOD.from}&to=${PERIOD.to}`,
      seed: () => undefined,
    });
    expect(html).toContain('Loading');
    expect(html).not.toContain('Days present');
  });

  it('says a day with a check-in and no check-out is exactly that', () => {
    // A FIXED PAST MONTH, so the assertion does not depend on what today happens to be: the same
    // stored `checkedIn` reads «في العمل» on today's line and «دخول فقط» on a finished day, and
    // this is the finished one.
    const past = { from: '2026-10-01', to: '2026-10-31' };
    const html = render(<EmployeeMonthPage />, {
      permissions: ['attendance.view'],
      path: `/attendance/employees/e-1?from=${past.from}&to=${past.to}`,
      seed: (qc) => {
        qc.setQueryData(
          listKey('hr', 'attendanceEmployeePeriod', { ...past, employeeId: 'e-1' }),
          [
            resolved({
              date: '2026-10-05',
              status: 'checkedIn',
              firstInAt: '2026-10-05T07:20:00.000Z',
              lastOutAt: null,
              workedMinutes: 0,
              lateMinutes: 0,
            }),
          ],
        );
        qc.setQueryData(
          listKey('hr', 'attendanceEmployeeSummary', { employeeId: 'e-1', ...past }),
          summary({ ...past, incompleteDays: 1, avgWorkedMinutes: null, totalWorkedMinutes: 0 }),
        );
      },
    });
    expect(html).toContain('Checked in only');
    // And no invented hours anywhere on it.
    expect(html).toContain('No complete days in this period.');
  });

  it('keeps a date the engine concluded nothing about, and says so', () => {
    // The calendar lays its weeks out by position, so a missing date would shift every cell after
    // it onto the wrong weekday. The date stays and reads «لا يوجد سجل» rather than «يوم راحة».
    const html = month([]);
    expect(html).toContain('No record');
  });

  it('offers the per-day decision only to a holder of attendance.decide', () => {
    expect(month([resolved()], { permissions: ['attendance.view', 'attendance.decide'] })).toContain(
      'Decide',
    );
    expect(month([resolved()])).not.toContain('Decide');
  });

  it('offers the export only to a holder of attendance.export', () => {
    expect(month([resolved()], { permissions: ['attendance.view', 'attendance.export'] })).toContain(
      'Export CSV',
    );
    expect(month([resolved()])).not.toContain('Export CSV');
  });

  it('draws no lateness line for somebody nobody has rostered', () => {
    const html = month([resolved()], { figures: summary({ dayStart: null, graceMinutes: 0 }) });
    expect(html).toContain('No working hours are set for this employee');
    expect(html).not.toContain('Late after');
  });

  it('shows no money, anywhere', () => {
    expect(month([resolved()])).not.toMatch(/ج\.م|EGP|جنيه/);
  });

  it('renders Arabic copy in Arabic', () => {
    const html = month([resolved()], { locale: 'ar' });
    expect(html).toContain('السجل اليومي');
    expect(html).toContain('أيام الحضور');
    expect(html).toContain('الشهر في لمحة');
  });
});
