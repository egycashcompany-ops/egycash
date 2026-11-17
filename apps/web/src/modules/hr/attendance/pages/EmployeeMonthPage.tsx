// One employee's attendance over a period (AT-6, §10). Reached from the daily sheet and from the
// profile tab; the rows come from the scoped day endpoint, so a caller who may not see this
// employee sees nothing rather than a filtered half-answer. Quantities only — no pay, no rate, no
// total value.
//
// The view itself is `AttendanceOverview`, shared with the profile tab and My Attendance; this
// page's own work is resolving WHO is being looked at and WHICH days, and keeping both in the URL
// so the screen is shareable and survives a reload.
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { EmptyState } from '../../../../shared/ui';
import { useAppSelector } from '../../../../store';
import { AttendanceOverview, type PeriodState } from '../components/AttendanceOverview';
import { DecisionsTable } from '../components/DecisionsTable';
import { periodRange } from '../components/period';
import { downloadAttendanceExport } from '../api/attendance-api';
import { useAttendanceDays, useAttendanceDecisions } from '../api/attendance-queries';
import { useEmployee } from '../../employee-management/employees/api/employee-queries';
import { useCan } from '../../../../platform/rbac/Can';

/** One page of days: 92 is the longest period the picker allows, and 100 is the server's cap. */
const PAGE_SIZE = 100;

export const EmployeeMonthPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams<{ id: string }>();
  const [sp, setSp] = useSearchParams();

  // `month=YYYY-MM` is still honoured: the profile tab and older links point here with one.
  const linkedMonth = sp.get('month');
  const [period, setPeriod] = useState<PeriodState>(() => {
    const from = sp.get('from');
    const to = sp.get('to');
    if (from !== null && to !== null) return { key: 'custom', from, to };
    if (linkedMonth !== null) {
      const start = `${linkedMonth}-01`;
      const [year, month] = linkedMonth.split('-').map(Number) as [number, number];
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return { key: 'custom', from: start, to: `${linkedMonth}-${String(last).padStart(2, '0')}` };
    }
    return { key: 'thisMonth', ...periodRange('thisMonth') };
  });

  const changePeriod = (next: PeriodState): void => {
    setPeriod(next);
    setSp({ from: next.from, to: next.to }, { replace: true });
  };

  const filters = useMemo(
    () => ({ from: period.from, to: period.to, employeeId: id, page: 1, pageSize: PAGE_SIZE }),
    [period.from, period.to, id],
  );
  const days = useAttendanceDays(filters, id !== '');
  const rows = useMemo(() => days.data?.items ?? [], [days.data]);

  // The employee record carries the photo and the department, which no day row does. Asked for
  // only by a caller who may read it: a reader of attendance alone still gets the whole screen,
  // with initials in place of the photo.
  const employee = useEmployee(can('employee.view') ? id : '');
  const record = employee.data;
  const nameFromRows = rows.find((row) => row.employeeName !== undefined)?.employeeName;
  const name =
    record === undefined
      ? (nameFromRows ?? t('attendance.month.title'))
      : locale === 'en'
        ? (record.personal.fullNameEn ?? record.personal.fullNameAr)
        : record.personal.fullNameAr;

  /**
   * WHAT WAS CHANGED ABOUT THESE DAYS, and by whom (stage 4 §4). It sits beside the days it
   * changed rather than on a screen of its own, because the question is always asked while looking
   * at a particular person's month — "why does this day say that?" — and an answer two clicks away
   * is an answer nobody finds.
   */
  const changes = useAttendanceDecisions(
    { employeeId: id, from: period.from, to: period.to, page: 1, pageSize: 50 },
    id !== '' && can('attendance.decide'),
  );
  const changeRows = changes.data?.items ?? [];

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const runExport = (): void => {
    setExporting(true);
    setExportError(null);
    downloadAttendanceExport({ from: period.from, to: period.to, employeeId: id })
      .catch((error: unknown) => {
        setExportError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setExporting(false));
  };

  return (
    <PageContainer>
      <PageHeader
        title={name}
        breadcrumbs={[
          { label: t('attendance.module.title') },
          { label: t('attendance.daily.title'), to: '/attendance/daily' },
          { label: t('attendance.month.title') },
        ]}
      />

      {exportError !== null && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {exportError}
        </p>
      )}

      <AttendanceOverview
        subject={{
          employeeId: id,
          name,
          code:
            record?.code ??
            rows.find((row) => row.employeeCode !== undefined)?.employeeCode ??
            null,
          department: record?.placement.department?.name[locale] ?? null,
          photoFileId: record?.personal.photoFileId ?? null,
        }}
        rows={rows}
        loading={days.isLoading}
        error={days.isError ? days.error : undefined}
        onRetry={() => void days.refetch()}
        period={period}
        onPeriodChange={changePeriod}
        onExport={runExport}
        exporting={exporting}
        empty={<EmptyState title={t('attendance.month.empty')} />}
      >
        {/* Shown only when there is something to show: an empty history section on every
            employee's month would be noise on the overwhelming majority of them. */}
        {changeRows.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('attendance.changes.onThisMonth')}
            </h2>
            <DecisionsTable
              rows={changeRows}
              loading={changes.isLoading}
              error={changes.isError ? changes.error : undefined}
              onRetry={() => void changes.refetch()}
              canApprove={false}
              canRevoke={can('attendance.decide')}
              showDecidedBy
            />
          </section>
        )}
      </AttendanceOverview>
    </PageContainer>
  );
};
