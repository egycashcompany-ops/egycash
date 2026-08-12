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
import { monthBounds, thisMonth } from '../components/month';
import { useAttendanceDays } from '../api/attendance-queries';

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
  const name = rows.find((row) => row.employeeName !== undefined)?.employeeName;

  return (
    <PageContainer>
      <PageHeader
        title={name ?? t('attendance.month.title')}
        description={t('attendance.month.subtitle')}
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
        </div>
      )}
    </PageContainer>
  );
};
