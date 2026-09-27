// One person's whole IT history — «اللى ادوس عليه يجيب الهيستورى بتاعه كله».
//
// What IT knows about a person is what they held and what they asked for:
//   • custody — what they hold NOW, and every asset they held before, with when and in what
//     condition it came back (the custody register, narrowed to them);
//   • tickets — the ones they opened, and the ones they worked as a technician.
// A leaver's history is exactly as complete as anybody's: the reason this page exists is that the
// person who left with a laptop is still somebody the company has to be able to look up.
//
// Every section is a read the page's own route already allows (`itAsset.view`), except tickets,
// which ride `itTicket.view` and its scope — a reader who may not see tickets sees no tickets
// section rather than a 403. Tickets are joined through the person's LOGIN; someone without one
// has custody but cannot have tickets, and the page says so rather than showing an empty table.
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { type ItAssetAssignmentDto, type ItTicketDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Pagination } from '../../../shared/ui/Pagination';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { formatDate, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import {
  useItAssignments,
  useItBranchOptions,
  useItDepartmentOptions,
  useItJobTitleOptions,
  useItPerson,
  useItTickets,
} from '../api/it-queries';
import { PersonStatusBadge } from '../components/PersonStatusBadge';
import { TicketStatusBadge } from '../components/TicketStatusBadge';

const PAGE_SIZE = 10;

/** One label/value row. `value` is already formatted — this only lays it out. */
const Fact = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}): JSX.Element => (
  <div className="py-2">
    <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
    <dd
      className={cn('mt-0.5 text-sm text-slate-800 dark:text-slate-100', mono && 'font-mono')}
      {...(mono ? { dir: 'ltr' as const } : {})}
    >
      {value === null || value === '' ? '—' : value}
    </dd>
  </div>
);

export const ItEmployeeHistoryPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { employeeId = '' } = useParams();
  const person = useItPerson(employeeId);

  const [pastPage, setPastPage] = useState(1);
  const [requestedPage, setRequestedPage] = useState(1);
  const [workedPage, setWorkedPage] = useState(1);

  // Custody — the page's own grant. Open intervals are few by nature: one page holds them.
  const current = useItAssignments(
    { employeeId, open: true, pageSize: 100, sortBy: 'assignedAt', sortDir: 'desc' },
    employeeId !== '',
  );
  const past = useItAssignments(
    {
      employeeId,
      open: false,
      page: pastPage,
      pageSize: PAGE_SIZE,
      sortBy: 'returnedAt',
      sortDir: 'desc',
    },
    employeeId !== '',
  );

  // Tickets — through the login, and only for a reader who may see tickets at all.
  const userId = person.data?.userId ?? null;
  const ticketsVisible = can('itTicket.view') && userId !== null;
  const requested = useItTickets(
    {
      requesterUserId: userId ?? undefined,
      page: requestedPage,
      pageSize: PAGE_SIZE,
      sortBy: 'createdAt',
      sortDir: 'desc',
    },
    ticketsVisible,
  );
  const worked = useItTickets(
    {
      assignedTechnicianUserId: userId ?? undefined,
      page: workedPage,
      pageSize: PAGE_SIZE,
      sortBy: 'createdAt',
      sortDir: 'desc',
    },
    ticketsVisible,
  );

  const branches = useItBranchOptions();
  const departments = useItDepartmentOptions();
  const jobTitles = useItJobTitleOptions();
  const nameIn = (
    options: readonly { id: string; name: { ar: string; en: string } }[] | undefined,
    id: string | null,
  ): string | null => {
    if (id === null) return null;
    const found = (options ?? []).find((option) => option.id === id);
    return found === undefined ? null : localized(found.name, locale);
  };

  const custodyColumns = useMemo(() => {
    const asset: Column<ItAssetAssignmentDto> = {
      key: 'asset',
      header: t('it.custody.asset'),
      render: (a) => (
        <Link to={`/it/assets/${a.assetId}`} className="hover:underline">
          <span className="flex flex-col leading-tight">
            <span>{a.assetName ?? t('it.custody.assetUnknown')}</span>
            {a.assetCode !== null && (
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                {a.assetCode}
              </span>
            )}
          </span>
        </Link>
      ),
    };
    const assignedAt: Column<ItAssetAssignmentDto> = {
      key: 'assignedAt',
      header: t('it.custody.assignedAt'),
      render: (a) => <span className="tabular-nums">{formatDate(a.assignedAt, locale)}</span>,
    };
    const open: Column<ItAssetAssignmentDto>[] = [
      asset,
      assignedAt,
      {
        key: 'expectedReturnAt',
        header: t('it.custody.expectedReturnAt'),
        render: (a) => {
          if (a.expectedReturnAt === null) return '—';
          const overdue = new Date(a.expectedReturnAt) < new Date();
          return (
            <span
              className={cn(
                'tabular-nums',
                overdue && 'font-medium text-red-600 dark:text-red-400',
              )}
            >
              {formatDate(a.expectedReturnAt, locale)}
            </span>
          );
        },
      },
      {
        key: 'conditionOnIssue',
        header: t('it.custody.conditionOnIssue'),
        render: (a) => a.conditionOnIssue ?? '—',
      },
    ];
    const closed: Column<ItAssetAssignmentDto>[] = [
      asset,
      assignedAt,
      {
        key: 'returnedAt',
        header: t('it.custody.returnedAt'),
        render: (a) =>
          a.returnedAt === null ? (
            '—'
          ) : (
            <span className="tabular-nums">{formatDate(a.returnedAt, locale)}</span>
          ),
      },
      {
        key: 'conditionOnReturn',
        header: t('it.custody.conditionOnReturn'),
        render: (a) => a.conditionOnReturn ?? '—',
      },
    ];
    return { open, closed };
  }, [t, locale]);

  const ticketColumns: Column<ItTicketDto>[] = [
    {
      key: 'ticketCode',
      header: t('it.tickets.columns.code'),
      render: (ticket) => (
        <span className="font-mono text-xs" dir="ltr">
          {ticket.ticketCode}
        </span>
      ),
    },
    { key: 'title', header: t('it.tickets.columns.title'), render: (ticket) => ticket.title },
    {
      key: 'status',
      header: t('it.tickets.columns.status'),
      render: (ticket) => <TicketStatusBadge status={ticket.status} />,
    },
    {
      key: 'createdAt',
      header: t('it.employees.columns.openedAt'),
      render: (ticket) => (
        <span className="tabular-nums">{formatDate(ticket.createdAt, locale)}</span>
      ),
    },
  ];

  if (person.isPending) {
    return (
      <PageContainer>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </PageContainer>
    );
  }
  if (person.isError || person.data === undefined) {
    return (
      <PageContainer>
        <ErrorState error={person.error} onRetry={() => void person.refetch()} />
      </PageContainer>
    );
  }

  const p = person.data;
  const workedAny = (worked.data?.meta.totalItems ?? 0) > 0;

  return (
    <PageContainer>
      <PageHeader
        title={p.fullNameAr}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.employees'), to: '/it/employees' },
          { label: p.fullNameAr },
        ]}
      />

      <div className="space-y-4">
        <Card>
          <CardHeader title={t('it.employees.sections.person')} />
          <CardBody>
            <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label={t('it.employees.columns.code')} value={p.code} mono />
              <Fact
                label={t('it.employees.columns.status')}
                value={<PersonStatusBadge status={p.status} />}
              />
              <Fact
                label={t('it.assets.columns.branch')}
                value={nameIn(branches.data, p.branchId)}
              />
              <Fact
                label={t('it.employees.columns.department')}
                value={nameIn(departments.data, p.departmentId)}
              />
              <Fact
                label={t('it.employees.columns.jobTitle')}
                value={nameIn(jobTitles.data, p.jobTitleId)}
              />
              <Fact
                label={t('it.employees.columns.hiredAt')}
                value={p.hiredAt === null ? null : formatDate(p.hiredAt, locale)}
              />
              <Fact
                label={t('it.employees.columns.exitedAt')}
                value={p.exitedAt === null ? null : formatDate(p.exitedAt, locale)}
              />
              <Fact label={t('it.employees.columns.holding')} value={String(p.openCustodyCount)} />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('it.employees.sections.currentCustody')}
            description={t('it.employees.currentCustodyHint')}
          />
          <CardBody>
            <DataTable
              embedded
              columns={custodyColumns.open}
              rows={current.data?.items ?? []}
              rowKey={(a) => a.id}
              loading={current.isLoading}
              error={current.isError ? current.error : undefined}
              onRetry={() => void current.refetch()}
              onRowClick={(a) => navigate(`/it/assets/${a.assetId}`)}
              empty={t('it.employees.noCurrentCustody')}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('it.employees.sections.pastCustody')}
            description={t('it.employees.pastCustodyHint')}
          />
          <CardBody>
            <DataTable
              embedded
              columns={custodyColumns.closed}
              rows={past.data?.items ?? []}
              rowKey={(a) => a.id}
              loading={past.isLoading}
              error={past.isError ? past.error : undefined}
              onRetry={() => void past.refetch()}
              onRowClick={(a) => navigate(`/it/assets/${a.assetId}`)}
              empty={t('it.employees.noPastCustody')}
            />
            {past.data !== undefined && past.data.meta.totalPages > 1 && (
              <Pagination meta={past.data.meta} onPageChange={setPastPage} />
            )}
          </CardBody>
        </Card>

        {can('itTicket.view') && (
          <Card>
            <CardHeader
              title={t('it.employees.sections.requestedTickets')}
              description={t('it.employees.requestedTicketsHint')}
            />
            <CardBody>
              {userId === null ? (
                <p className="py-2 text-sm text-slate-500 dark:text-slate-400">
                  {t('it.employees.noLogin')}
                </p>
              ) : (
                <>
                  <DataTable
                    embedded
                    columns={ticketColumns}
                    rows={requested.data?.items ?? []}
                    rowKey={(ticket) => ticket.id}
                    loading={requested.isLoading}
                    error={requested.isError ? requested.error : undefined}
                    onRetry={() => void requested.refetch()}
                    onRowClick={(ticket) => navigate(`/it/tickets/${ticket.id}`)}
                    empty={t('it.employees.noRequestedTickets')}
                  />
                  {requested.data !== undefined && requested.data.meta.totalPages > 1 && (
                    <Pagination meta={requested.data.meta} onPageChange={setRequestedPage} />
                  )}
                </>
              )}
            </CardBody>
          </Card>
        )}

        {/* Only somebody who has worked tickets gets this section — for everyone else it would be
            an empty table on every page, which is noise. */}
        {ticketsVisible && workedAny && (
          <Card>
            <CardHeader
              title={t('it.employees.sections.workedTickets')}
              description={t('it.employees.workedTicketsHint')}
            />
            <CardBody>
              <DataTable
                embedded
                columns={ticketColumns}
                rows={worked.data?.items ?? []}
                rowKey={(ticket) => ticket.id}
                loading={worked.isLoading}
                error={worked.isError ? worked.error : undefined}
                onRetry={() => void worked.refetch()}
                onRowClick={(ticket) => navigate(`/it/tickets/${ticket.id}`)}
              />
              {worked.data !== undefined && worked.data.meta.totalPages > 1 && (
                <Pagination meta={worked.data.meta} onPageChange={setWorkedPage} />
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </PageContainer>
  );
};
