// One employee's month (AT-6, §10). Reached from the daily sheet and from the profile tab; the
// rows come from the scoped day endpoint, so a caller who may not see this employee sees nothing
// rather than a filtered half-answer. Quantities only — no pay, no rate, no total value.
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { EmptyState } from '../../../../shared/ui';
import { Field, Input } from '../../../../shared/ui/form';
import { MonthGrid } from '../components/MonthGrid';
import { DaysTable } from '../components/DaysTable';
import { DecisionsTable } from '../components/DecisionsTable';
import { monthBounds, thisMonth } from '../components/month';
import { useAttendanceDays, useAttendanceDecisions } from '../api/attendance-queries';
import { useCan } from '../../../../platform/rbac/Can';

export const EmployeeMonthPage = (): JSX.Element => {
  const t = useT();
  const { id = '' } = useParams<{ id: string }>();
  const [sp, setSp] = useSearchParams();
  const [month, setMonth] = useState(sp.get('month') ?? thisMonth());

  const filters = useMemo(() => {
    const { from, to } = monthBounds(month);
    return { from, to, employeeId: id, page: 1, pageSize: 62 };
  }, [month, id]);
  const days = useAttendanceDays(filters, id !== '');
  const rows = days.data?.items ?? [];

  /**
   * WHAT WAS CHANGED ABOUT THIS MONTH, and by whom (stage 4 §4). It sits beside the days it
   * changed rather than on a screen of its own, because the question is always asked while looking
   * at a particular person's month — "why does this day say that?" — and an answer two clicks away
   * is an answer nobody finds.
   */
  const can = useCan();
  const changes = useAttendanceDecisions(
    { employeeId: id, from: filters.from, to: filters.to, page: 1, pageSize: 50 },
    id !== '' && can('attendance.decide'),
  );
  const changeRows = changes.data?.items ?? [];
  const name = rows.find((row) => row.employeeName !== undefined)?.employeeName;

  return (
    <PageContainer>
      <PageHeader
        title={name ?? t('attendance.month.title')}
        breadcrumbs={[
          { label: t('attendance.module.title') },
          { label: t('attendance.daily.title'), to: '/attendance/daily' },
          { label: t('attendance.month.title') },
        ]}
      />
      <div className="mb-4 max-w-xs">
        <Field label={t('attendance.month.month')}>
          <Input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setSp({ month: e.target.value });
            }}
            aria-label={t('attendance.month.month')}
          />
        </Field>
      </div>

      {rows.length === 0 && !days.isLoading ? (
        <EmptyState title={t('attendance.month.empty')} />
      ) : (
        <div className="space-y-6">
          <MonthGrid month={month} rows={rows} />
          <DaysTable
            rows={rows}
            loading={days.isLoading}
            error={days.isError ? days.error : undefined}
            onRetry={() => void days.refetch()}
          />

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
        </div>
      )}
    </PageContainer>
  );
};
