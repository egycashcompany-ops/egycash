// My Attendance — the self-service home (AT-6), the My Leave shape. It reads `/days/me`,
// `/days/me/summary` and `/regularizations/me`, all of which are own-scope BY CONSTRUCTION on the
// server: they resolve the caller's own employee link and accept no employee filter at all, so
// this screen cannot be pointed at anybody else's days however its query string is edited.
//
// IT IS THE SAME VIEW HR SEES, READ-ONLY. The figures, the calendar, the charts and the record are
// the ones on the employee's page; what is missing is the acting — no decide button, and no export
// unless the login happens to hold `attendance.export`. One view rather than a quieter copy, so
// the two can never tell the same person two different things about their own month.
import { useMemo, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, EmptyState } from '../../../../shared/ui';
import { PlusIcon } from '../../../../shared/ui/icons';
import { EmployeePeriodView, type PeriodState } from '../components/EmployeePeriodView';
import { RegularizationsTable } from '../components/RegularizationsTable';
import { RegularizationDialog } from '../components/RegularizationDialog';
import { periodRange } from '../components/period';
import {
  useMyAttendanceDays,
  useMyAttendanceSummary,
  useMyRegularizations,
} from '../api/attendance-queries';
import { useMyEmployeeSummary } from '../../../../platform/home/home-api';
import { useEmployeePhotoUrl } from '../../employee-management/employees/api/employee-photo';

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
  const summary = useMyAttendanceSummary({ from: period.from, to: period.to });
  const regularizations = useMyRegularizations({ page: 1, pageSize: 25 });
  // The caller's own card — the photo, the code and where they sit. The welcome page's endpoint,
  // own-scope like everything else here, and it answers null rather than failing for a login with
  // no employee file.
  const card = useMyEmployeeSummary();
  const profile = card.data ?? null;
  const photo = useEmployeePhotoUrl(employeeId ?? '', profile?.photoFileId ?? null);

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

  const fromLogin = `${me?.name.firstName[locale] ?? ''} ${me?.name.lastName[locale] ?? ''}`.trim();
  const fromCard =
    profile === null ? '' : locale === 'en' ? (profile.fullNameEn ?? profile.fullNameAr) : profile.fullNameAr;
  // The employee file first, the login's own name next, and the screen's title last. A name is
  // never allowed to come out empty here: this is the one screen that is ABOUT the person
  // reading it.
  const name = fromCard !== '' ? fromCard : fromLogin !== '' ? fromLogin : t('attendance.my.title');

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

      <EmployeePeriodView
        employeeId={employeeId}
        header={{
          name,
          code: profile?.code ?? '',
          photoUrl: photo.url,
          department: profile?.department?.[locale] ?? null,
          branch: profile?.branch?.[locale] ?? null,
          jobTitle: profile?.jobTitle?.[locale] ?? null,
        }}
        rows={days.data?.items ?? []}
        summary={summary.data}
        loading={days.isLoading || summary.isLoading}
        error={summary.isError ? summary.error : days.isError ? days.error : undefined}
        period={period}
        onPeriodChange={setPeriod}
        // Nobody decides their own attendance — the server refuses it (C7), and the screen does
        // not offer what the server would refuse.
        canDecide={false}
      />

      <section className="mt-6 space-y-2">
        <h3 className="text-sm font-semibold">{t('attendance.my.requests')}</h3>
        <RegularizationsTable
          rows={regularizations.data?.items ?? []}
          loading={regularizations.isLoading}
          error={regularizations.isError ? regularizations.error : undefined}
          onRetry={() => void regularizations.refetch()}
          empty={<EmptyState title={t('attendance.my.noRequests')} />}
        />
      </section>

      {filing !== null && (
        <RegularizationDialog workDate={filing} onClose={() => setFiling(null)} />
      )}
    </PageContainer>
  );
};
