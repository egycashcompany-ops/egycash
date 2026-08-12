// The employee profile's additive Attendance tab (AT-6) — default export, lazy-loaded by the
// profile hub exactly as the Leave and Contracts tabs are, so the employees chunk stays
// attendance-free for everyone who never opens it.
//
// It shows the subject's month (quantities and classification only — no pay, ever), the
// regularization history for the same employee, and, for a `decideRegularization` holder, the D7
// direct edit. The timeline of what changed the day lives in the audit stream, not here.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { type EmployeeDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { Button, EmptyState } from '../../../../shared/ui';
import { Field, Input } from '../../../../shared/ui/form';
import { MonthGrid } from './MonthGrid';
import { DaysTable } from './DaysTable';
import { RegularizationsTable } from './RegularizationsTable';
import { RegularizationDialog } from './RegularizationDialog';
import { monthBounds, thisMonth } from './month';
import { useAttendanceDays, useRegularizations } from '../api/attendance-queries';

const EmployeeAttendanceTab = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const [month, setMonth] = useState(thisMonth);
  const [filing, setFiling] = useState<string | null>(null);

  const dayFilters = useMemo(() => {
    const { from, to } = monthBounds(month);
    return { from, to, employeeId: employee.id, page: 1, pageSize: 62 };
  }, [month, employee.id]);
  const days = useAttendanceDays(dayFilters);
  const regularizations = useRegularizations({
    page: 1,
    pageSize: 25,
    employeeId: employee.id,
  });
  const rows = days.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="max-w-xs grow">
          <Field label={t('attendance.month.month')}>
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label={t('attendance.month.month')}
            />
          </Field>
        </div>
        <div className="flex gap-2">
          <Can permission="attendance.decideRegularization">
            <Button size="sm" variant="secondary" onClick={() => setFiling(`${month}-01`)}>
              {t('attendance.reg.directTitle')}
            </Button>
          </Can>
          <Can permission="attendance.view">
            <Link
              to={`/attendance/employees/${employee.id}?month=${month}`}
              className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t('attendance.month.open')}
            </Link>
          </Can>
        </div>
      </div>

      <MonthGrid month={month} rows={rows} />
      <DaysTable
        rows={rows}
        loading={days.isLoading}
        error={days.isError ? days.error : undefined}
        onRetry={() => void days.refetch()}
        empty={<EmptyState title={t('attendance.month.empty')} />}
      />

      <h3 className="text-sm font-semibold">{t('attendance.profile.requests')}</h3>
      <RegularizationsTable
        rows={regularizations.data?.items ?? []}
        loading={regularizations.isLoading}
        error={regularizations.isError ? regularizations.error : undefined}
        onRetry={() => void regularizations.refetch()}
        empty={<EmptyState title={t('attendance.profile.noRequests')} />}
      />

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
