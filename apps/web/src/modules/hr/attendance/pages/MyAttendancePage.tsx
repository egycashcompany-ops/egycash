// My Attendance — the self-service home (AT-6), the My Leave shape. It reads `/days/me` and
// `/regularizations/me`, both of which are own-scope BY CONSTRUCTION on the server: they resolve
// the caller's own employee link and accept no employee filter at all, so this screen cannot be
// pointed at anybody else's days however its query string is edited.
//
// It shows an employee EXACTLY what HR sees about them — the same `AttendanceOverview`, the same
// figures, the same record — and nothing they may not act on: the export is behind
// `attendance.export`, which a self-service login does not hold, so the view is read-only without
// a second, quieter copy of the screen that could disagree with the first.
import { useMemo, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, EmptyState } from '../../../../shared/ui';
import { PlusIcon } from '../../../../shared/ui/icons';
import { AttendanceOverview, type PeriodState } from '../components/AttendanceOverview';
import { RegularizationsTable } from '../components/RegularizationsTable';
import { RegularizationDialog } from '../components/RegularizationDialog';
import { periodRange } from '../components/period';
import { useMyAttendanceDays, useMyRegularizations } from '../api/attendance-queries';
import { useMyEmployeeSummary } from '../../../../platform/home/home-api';

/** One page of days: 92 is the longest period the picker allows, and 100 is the server's cap. */
const PAGE_SIZE = 100;

export const MyAttendancePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const me = useAppSelector((state) => state.auth.me);
  const employeeId = me?.employeeId ?? null;
  const [period, setPeriod] = useState<PeriodState>(() => ({
    key: 'thisMonth',
    ...periodRange('thisMonth'),
  }));
  const [filing, setFiling] = useState<string | null>(null);

  const dayFilters = useMemo(
    () => ({ from: period.from, to: period.to, page: 1, pageSize: PAGE_SIZE }),
    [period.from, period.to],
  );
  const days = useMyAttendanceDays(dayFilters);
  const regularizations = useMyRegularizations({ page: 1, pageSize: 25 });
  // The caller's own card — the photo, the code and where they sit. It is the welcome page's
  // endpoint, own-scope like everything else on this screen, and it answers `null` rather than
  // failing for a login with no employee file.
  const summary = useMyEmployeeSummary();
  const rows = days.data?.items ?? [];

  if (employeeId === null) {
    return (
      <PageContainer>
        <PageHeader title={t('attendance.my.title')} />
        <EmptyState
          title={t('attendance.my.noEmployee')}
          description={t('attendance.my.noEmployeeHint')}
        />
      </PageContainer>
    );
  }

  const card = summary.data ?? null;
  const name =
    card === null
      ? `${me?.name.firstName[locale] ?? ''} ${me?.name.lastName[locale] ?? ''}`.trim()
      : locale === 'en'
        ? (card.fullNameEn ?? card.fullNameAr)
        : card.fullNameAr;

  return (
    <PageContainer>
      <PageHeader
        title={t('attendance.my.title')}
        breadcrumbs={[{ label: t('attendance.module.title') }, { label: t('attendance.my.title') }]}
        actions={
          can('attendance.requestRegularization') ? (
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setFiling(period.to)}
            >
              {t('attendance.my.fileRegularization')}
            </Button>
          ) : undefined
        }
      />

      <AttendanceOverview
        subject={{
          employeeId,
          name,
          code: card?.code ?? null,
          department: card?.department?.[locale] ?? null,
          photoFileId: card?.photoFileId ?? null,
        }}
        rows={rows}
        loading={days.isLoading}
        error={days.isError ? days.error : undefined}
        onRetry={() => void days.refetch()}
        period={period}
        onPeriodChange={setPeriod}
        empty={<EmptyState title={t('attendance.my.empty')} />}
      >
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('attendance.my.requests')}</h3>
          <RegularizationsTable
            rows={regularizations.data?.items ?? []}
            loading={regularizations.isLoading}
            error={regularizations.isError ? regularizations.error : undefined}
            onRetry={() => void regularizations.refetch()}
            empty={<EmptyState title={t('attendance.my.noRequests')} />}
          />
        </section>
      </AttendanceOverview>

      {filing !== null && (
        <RegularizationDialog workDate={filing} onClose={() => setFiling(null)} />
      )}
    </PageContainer>
  );
};
