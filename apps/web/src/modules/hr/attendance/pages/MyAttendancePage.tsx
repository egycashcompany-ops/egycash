// My Attendance — the self-service home (AT-6), the My Leave shape. It reads `/days/me` and
// `/regularizations/me`, both of which are own-scope BY CONSTRUCTION on the server: they resolve
// the caller's own employee link and accept no employee filter at all, so this screen cannot be
// pointed at anybody else's month however its query string is edited.
import { useMemo, useState } from 'react';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, EmptyState } from '../../../../shared/ui';
import { Field, Input } from '../../../../shared/ui/form';
import { PlusIcon } from '../../../../shared/ui/icons';
import { MonthGrid } from '../components/MonthGrid';
import { DaysTable } from '../components/DaysTable';
import { RegularizationsTable } from '../components/RegularizationsTable';
import { RegularizationDialog } from '../components/RegularizationDialog';
import { monthBounds, thisMonth } from '../components/month';
import { useMyAttendanceDays, useMyRegularizations } from '../api/attendance-queries';

export const MyAttendancePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const employeeId = useAppSelector((state) => state.auth.me?.employeeId ?? null);
  const [month, setMonth] = useState(thisMonth);
  const [filing, setFiling] = useState<string | null>(null);

  const dayFilters = useMemo(() => {
    const { from, to } = monthBounds(month);
    return { from, to, page: 1, pageSize: 62 };
  }, [month]);
  const days = useMyAttendanceDays(dayFilters);
  const regularizations = useMyRegularizations({ page: 1, pageSize: 25 });
  const rows = days.data?.items ?? [];

  if (employeeId === null) {
    return (
      <PageContainer>
        <PageHeader title={t('attendance.my.title')} description={t('attendance.my.subtitle')} />
        <EmptyState
          title={t('attendance.my.noEmployee')}
          description={t('attendance.my.noEmployeeHint')}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('attendance.my.title')}
        description={t('attendance.my.subtitle')}
        breadcrumbs={[{ label: t('attendance.module.title') }, { label: t('attendance.my.title') }]}
        actions={
          can('attendance.requestRegularization') ? (
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setFiling(`${month}-01`)}
            >
              {t('attendance.my.fileRegularization')}
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4 max-w-xs">
        <Field label={t('attendance.month.month')}>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label={t('attendance.month.month')}
          />
        </Field>
      </div>

      <div className="space-y-6">
        <MonthGrid
          month={month}
          rows={rows}
          {...(can('attendance.requestRegularization')
            ? { onSelect: (row) => setFiling(row.workDate.slice(0, 10)) }
            : {})}
        />
        <DaysTable
          rows={rows}
          loading={days.isLoading}
          error={days.isError ? days.error : undefined}
          onRetry={() => void days.refetch()}
          empty={<EmptyState title={t('attendance.my.empty')} />}
        />
        <h3 className="text-sm font-semibold">{t('attendance.my.requests')}</h3>
        <RegularizationsTable
          rows={regularizations.data?.items ?? []}
          loading={regularizations.isLoading}
          error={regularizations.isError ? regularizations.error : undefined}
          onRetry={() => void regularizations.refetch()}
          empty={<EmptyState title={t('attendance.my.noRequests')} />}
        />
      </div>

      {filing !== null && (
        <RegularizationDialog workDate={filing} onClose={() => setFiling(null)} />
      )}
    </PageContainer>
  );
};
