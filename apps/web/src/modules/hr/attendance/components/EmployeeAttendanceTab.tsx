// The employee profile's additive Attendance tab (AT-6) — default export, lazy-loaded by the
// profile hub exactly as the Leave and Contracts tabs are, so the employees chunk stays
// attendance-free for everyone who never opens it.
//
// It shows the subject's period (quantities and classification only — no pay, ever) through the
// SAME `AttendanceOverview` the month page and My Attendance use, so the three never drift apart,
// plus the regularization history for the same employee and, for a `decideRegularization` holder,
// the D7 direct edit.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { Button, EmptyState } from '../../../../shared/ui';
import { AttendanceOverview, type PeriodState } from './AttendanceOverview';
import { RegularizationsTable } from './RegularizationsTable';
import { RegularizationDialog } from './RegularizationDialog';
import { periodRange } from './period';
import { downloadAttendanceExport } from '../api/attendance-api';
import { useAttendanceDays, useRegularizations } from '../api/attendance-queries';

/** One page of days: 92 is the longest period the picker allows, and 100 is the server's cap. */
const PAGE_SIZE = 100;

const EmployeeAttendanceTab = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [period, setPeriod] = useState<PeriodState>(() => ({
    key: 'thisMonth',
    ...periodRange('thisMonth'),
  }));
  const [filing, setFiling] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const dayFilters = useMemo(
    () => ({
      from: period.from,
      to: period.to,
      employeeId: employee.id,
      page: 1,
      pageSize: PAGE_SIZE,
    }),
    [period.from, period.to, employee.id],
  );
  const days = useAttendanceDays(dayFilters);
  const regularizations = useRegularizations({
    page: 1,
    pageSize: 25,
    employeeId: employee.id,
  });
  const rows = days.data?.items ?? [];

  const runExport = (): void => {
    setExporting(true);
    setExportError(null);
    downloadAttendanceExport({ from: period.from, to: period.to, employeeId: employee.id })
      .catch((error: unknown) => {
        setExportError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setExporting(false));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Can permission="attendance.decideRegularization">
          <Button size="sm" variant="secondary" onClick={() => setFiling(period.to)}>
            {t('attendance.reg.directTitle')}
          </Button>
        </Can>
        <Can permission="attendance.view">
          <Link
            to={`/attendance/employees/${employee.id}?from=${period.from}&to=${period.to}`}
            className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {t('attendance.month.open')}
          </Link>
        </Can>
      </div>

      {exportError !== null && (
        <p role="alert" className="text-sm text-red-600">
          {exportError}
        </p>
      )}

      <AttendanceOverview
        subject={{
          employeeId: employee.id,
          name:
            locale === 'en'
              ? (employee.personal.fullNameEn ?? employee.personal.fullNameAr)
              : employee.personal.fullNameAr,
          code: employee.code,
          department: employee.placement.department?.name[locale] ?? null,
          photoFileId: employee.personal.photoFileId,
        }}
        rows={rows}
        loading={days.isLoading}
        error={days.isError ? days.error : undefined}
        onRetry={() => void days.refetch()}
        period={period}
        onPeriodChange={setPeriod}
        onExport={runExport}
        exporting={exporting}
        empty={<EmptyState title={t('attendance.month.empty')} />}
      >
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('attendance.profile.requests')}</h3>
          <RegularizationsTable
            rows={regularizations.data?.items ?? []}
            loading={regularizations.isLoading}
            error={regularizations.isError ? regularizations.error : undefined}
            onRetry={() => void regularizations.refetch()}
            empty={<EmptyState title={t('attendance.profile.noRequests')} />}
          />
        </section>
      </AttendanceOverview>

      {filing !== null && (
        <RegularizationDialog
          workDate={filing}
          employeeId={employee.id}
          onClose={() => setFiling(null)}
        />
      )}
    </div>
  );
};

export default EmployeeAttendanceTab;
