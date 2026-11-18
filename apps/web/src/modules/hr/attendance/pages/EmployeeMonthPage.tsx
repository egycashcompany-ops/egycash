// One employee's attendance over a period (AT-6, §10). Reached from the daily sheet and from the
// profile tab; the rows and the figures come from the scoped endpoints, so a caller who may not
// see this employee sees nothing rather than a filtered half-answer. Quantities only — no pay, no
// rate, no total value.
//
// The view itself is `EmployeePeriodView`, shared with the profile tab and My Attendance; this
// page's own work is resolving WHO is being looked at and WHICH days, and keeping both in the URL
// so the screen is shareable and survives a reload.
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer } from '../../../../platform/layout/PageContainer';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { EmployeePeriodView, type PeriodState } from '../components/EmployeePeriodView';
import { DecisionsTable } from '../components/DecisionsTable';
import { periodRange } from '../components/period';
import { downloadAttendanceExport } from '../api/attendance-api';
import {
  useAttendanceDecisions,
  useAttendanceEmployeePeriod,
  useAttendanceEmployeeSummary,
} from '../api/attendance-queries';
import { useEmployee } from '../../employee-management/employees/api/employee-queries';
import { useEmployeePhotoUrl } from '../../employee-management/employees/api/employee-photo';

// No page size here any more. `/days/employee-period` answers one entry per calendar DATE of the
// period rather than a page of stored rows — which is the fix: a date with no row was simply
// absent from the old answer, so a month skipped the days it had punches for, and a period longer
// than one page silently lost its tail.

export const EmployeeMonthPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams<{ id: string }>();
  const [sp, setSp] = useSearchParams();

  // `month=YYYY-MM` is still honoured: older links and bookmarks point here with one.
  const [period, setPeriod] = useState<PeriodState>(() => {
    const from = sp.get('from');
    const to = sp.get('to');
    if (from !== null && to !== null) return { key: 'custom', from, to };
    const month = sp.get('month');
    if (month !== null) {
      const [year, monthIndex] = month.split('-').map(Number) as [number, number];
      const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
      return {
        key: 'custom',
        from: `${month}-01`,
        to: `${month}-${String(last).padStart(2, '0')}`,
      };
    }
    return { key: 'thisMonth', ...periodRange('thisMonth') };
  });

  const changePeriod = (next: PeriodState): void => {
    setPeriod(next);
    setSp({ from: next.from, to: next.to }, { replace: true });
  };

  const filters = useMemo(
    () => ({ from: period.from, to: period.to, employeeId: id }),
    [period.from, period.to, id],
  );
  const days = useAttendanceEmployeePeriod(filters, id !== '');
  const summary = useAttendanceEmployeeSummary(
    { employeeId: id, from: period.from, to: period.to },
    id !== '',
  );
  const rows = days.data ?? [];

  // The employee record carries the photo and where they sit, which no day row does. Asked for
  // only by a caller who may read it: a reader of attendance alone still gets the whole screen,
  // with initials in place of the photo.
  const employee = useEmployee(can('employee.view') ? id : '');
  const record = employee.data;
  const photo = useEmployeePhotoUrl(id, record?.personal.photoFileId ?? null);
  // The resolved period carries no name — it is one employee's days, not a directory — so the
  // fallback is the SUMMARY, which the server labels. That keeps a reader holding `attendance.view`
  // and not `employee.view` looking at a named page, which is what the enriched day rows used to do.
  const nameFromRows = summary.data?.employeeName ?? undefined;
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
    if (exporting) return;
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
      {exportError !== null && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {exportError}
        </p>
      )}

      <EmployeePeriodView
        employeeId={id}
        header={{
          name,
          code: record?.code ?? summary.data?.employeeCode ?? '',
          photoUrl: photo.url,
          department: record?.placement.department?.name[locale] ?? null,
          branch: record?.placement.branch?.name[locale] ?? null,
          jobTitle: record?.placement.jobTitle?.name[locale] ?? null,
        }}
        rows={rows}
        summary={summary.data}
        loading={days.isLoading || summary.isLoading}
        error={summary.isError ? summary.error : days.isError ? days.error : undefined}
        period={period}
        onPeriodChange={changePeriod}
        canDecide={can('attendance.decide')}
        {...(can('attendance.export') ? { onExport: runExport } : {})}
      />

      {/* Shown only when there is something to show: an empty history section on every employee's
          month would be noise on the overwhelming majority of them. */}
      {changeRows.length > 0 && (
        <section className="mt-6 space-y-2">
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
    </PageContainer>
  );
};
