// The employee profile's additive Attendance tab (AT-6) — default export, lazy-loaded by the
// profile hub exactly as the Leave and Contracts tabs are, so the employees chunk stays
// attendance-free for everyone who never opens it.
//
// It shows the subject's period (quantities and classification only — no pay, ever) through the
// SAME `EmployeePeriodView` the month page and My Attendance use, so the three never drift apart,
// plus the regularization history for the same employee and, for a `decideRegularization` holder,
// the D7 direct edit.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can, useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { Button, EmptyState } from '../../../../shared/ui';
import { EmployeePeriodView, type PeriodState } from './EmployeePeriodView';
import { RegularizationsTable } from './RegularizationsTable';
import { RegularizationDialog } from './RegularizationDialog';
import { periodRange } from './period';
import { downloadAttendanceExport } from '../api/attendance-api';
import {
  useAttendanceEmployeePeriod,
  useAttendanceEmployeeSummary,
  useRegularizations,
} from '../api/attendance-queries';
import { useEmployeePhotoUrl } from '../../employee-management/employees/api/employee-photo';

// No page size any more: `/days/employee-period` answers one entry per calendar DATE rather than a
// page of stored rows, so there is no page to size and no tail to lose.

const EmployeeAttendanceTab = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [period, setPeriod] = useState<PeriodState>(() => ({
    key: 'thisMonth',
    ...periodRange('thisMonth'),
  }));
  const [filing, setFiling] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const dayFilters = useMemo(
    // One entry per calendar DATE, not a page of stored rows (see `/days/employee-period`).
    () => ({
      from: period.from,
      to: period.to,
      employeeId: employee.id,
    }),
    [period.from, period.to, employee.id],
  );
  const days = useAttendanceEmployeePeriod(dayFilters);
  const summary = useAttendanceEmployeeSummary({
    employeeId: employee.id,
    from: period.from,
    to: period.to,
  });
  const regularizations = useRegularizations({ page: 1, pageSize: 25, employeeId: employee.id });
  const photo = useEmployeePhotoUrl(employee.id, employee.personal.photoFileId);

  const runExport = (): void => {
    if (exporting) return;
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

      <EmployeePeriodView
        employeeId={employee.id}
        header={{
          name:
            locale === 'en'
              ? (employee.personal.fullNameEn ?? employee.personal.fullNameAr)
              : employee.personal.fullNameAr,
          code: employee.code,
          photoUrl: photo.url,
          department: employee.placement.department?.name[locale] ?? null,
          branch: employee.placement.branch?.name[locale] ?? null,
          jobTitle: employee.placement.jobTitle?.name[locale] ?? null,
        }}
        rows={days.data ?? []}
        summary={summary.data}
        loading={days.isLoading || summary.isLoading}
        error={summary.isError ? summary.error : days.isError ? days.error : undefined}
        period={period}
        onPeriodChange={setPeriod}
        canDecide={can('attendance.decide')}
        {...(can('attendance.export') ? { onExport: runExport } : {})}
      />

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
