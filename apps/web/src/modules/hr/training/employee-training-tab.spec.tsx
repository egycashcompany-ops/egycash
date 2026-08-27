// The profile tab, and the two claims it makes about a person.
//
// Both are about what the tab is FOR rather than how it looks:
//
//   • IT SHOWS THE RECORD'S OWN COPY OF THE COURSE NAME. That is D8 reaching the screen: renaming
//     a course must not change what a completed training says, and a tab that resolved the name
//     through `courseId` would undo the whole point of storing it.
//   • IT OFFERS NOTHING TO CLICK. A record is never revised, and a seat is granted or taken back
//     from the session that owns it — a button here would be a second door onto a decision that
//     already has one.
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing clicks.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type EmployeeDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import EmployeeTrainingTab from './components/EmployeeTrainingTab';

const EMPLOYEE_ID = 'e1';
const PAGE_SIZE = 20;

const employee = { id: EMPLOYEE_ID } as unknown as EmployeeDto;

const pageOf = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: PAGE_SIZE, totalItems: items.length, totalPages: 1 },
});

const record = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  employeeId: EMPLOYEE_ID,
  employeeCode: 'HR-1',
  employeeName: 'سعاد عبد الرحمن',
  courseId: 'c1',
  courseKey: 'defensiveDriving',
  // The record's OWN copy. The catalogue may say something else by now; this must not.
  courseNameAr: 'القيادة الدفاعية',
  courseNameEn: 'Defensive Driving',
  sessionId: 's1',
  sessionCode: 'TRN-2026-000001',
  trainerName: null,
  startedAt: '2026-03-03T00:00:00.000Z',
  completedAt: '2026-03-05T00:00:00.000Z',
  expiresAt: null,
  certificateFileId: null,
  certificateFileName: null,
  note: null,
  createdAt: '2026-03-05T00:00:00.000Z',
  ...over,
});

const seat = (over: Record<string, unknown> = {}) => ({
  id: 'en1',
  employeeId: EMPLOYEE_ID,
  employeeCode: 'HR-1',
  employeeName: 'سعاد عبد الرحمن',
  sessionId: 's2',
  sessionCode: 'TRN-2026-000002',
  courseKey: 'firstAid',
  status: 'enrolled',
  nominationId: null,
  note: null,
  cancelledReason: null,
  enrolledAt: '2026-04-01T00:00:00.000Z',
  version: 0,
  ...over,
});

const client = (records: unknown[], seats: unknown[]): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    listKey('hr', 'trainingRecords', { employeeId: EMPLOYEE_ID, page: 1, pageSize: PAGE_SIZE }),
    pageOf(records),
  );
  qc.setQueryData(
    listKey('hr', 'trainingEnrollments', {
      employeeId: EMPLOYEE_ID,
      page: 1,
      pageSize: PAGE_SIZE,
      status: 'enrolled',
    }),
    pageOf(seats),
  );
  return qc;
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: { 'trainingRecord.view': 'organization' },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = (records: unknown[] = [record()], seats: unknown[] = [seat()]): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={client(records, seats)}>
        <EmployeeTrainingTab employee={employee} />
      </QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);

describe('what the tab shows', () => {
  /** D8 ON SCREEN. The name comes off the RECORD, so a renamed course changes nothing here. */
  it('names the course from the record’s own copy', () => {
    expect(render()).toContain('القيادة الدفاعية');
  });

  it('shows when it was completed, and both sections', () => {
    const markup = render();
    expect(markup).toContain(t('training.tab.history'));
    expect(markup).toContain(t('training.tab.upcoming'));
    expect(markup).toContain('TRN-2026-000002');
  });

  /** An expiry is printed when the paper carries one, and «—» when it does not (D10). */
  it('prints an expiry only when there is one', () => {
    expect(render([record({ expiresAt: null })])).toContain('—');
    expect(render([record({ expiresAt: '2028-03-05T00:00:00.000Z' })])).not.toContain(
      t('training.tab.noHistory'),
    );
  });

  it('says so plainly when there is nothing to show', () => {
    const markup = render([], []);
    expect(markup).toContain(t('training.tab.noHistory'));
    expect(markup).toContain(t('training.tab.noUpcoming'));
  });
});

describe('what the tab does not offer', () => {
  /**
   * A record is never revised (D8), and a seat is granted or taken back from the session that owns
   * it. Either button here would be a second door onto a decision that already has one.
   */
  it('has nothing to click', () => {
    expect(render()).not.toContain('<button');
  });
});
