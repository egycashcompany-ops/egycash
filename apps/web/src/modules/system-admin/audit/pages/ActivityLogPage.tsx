// The activity log (P11) — a separate screen from the audit log, on purpose.
//
// They look similar and are not the same thing. Different collections, different permissions
// (`activityLog.view` is its own grant), different filter vocabularies — this endpoint accepts
// `entityType` and `entityId` and nothing else — and different retention: activity is purged on a
// schedule while the audit stream is never purged at all. One screen with two tabs would put both
// behind whichever permission the reader happened to hold, and would offer filters to a stream that
// does not accept them.
//
// An activity row is a rendered SENTENCE, not a diff: `messageKey` + `params`, translated by the
// reader's client. There is no field-level change list, so there is no detail panel to open.
import { useSearchParams } from 'react-router-dom';
import { type ActivityLogDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, FilterBar, Pagination, type Column } from '../../../../shared/ui';
import { Input } from '../../../../shared/ui/form';
import { EmptyState } from '../../../../shared/ui/states/EmptyState';
import { formatDateTime } from '../../../../shared/lib/format';
import { useActivityLogs } from '../api/audit-api';
import { readActivityFilters, withParam } from '../lib/audit-filters';

export const ActivityLogPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const filters = readActivityFilters(sp);
  const query = useActivityLogs(filters);
  const set = (name: string, value: string): void =>
    setSp(withParam(sp, name, value), { replace: true });

  const columns: Column<ActivityLogDto>[] = [
    {
      key: 'at',
      header: t('systemAdmin.activity.fields.at'),
      render: (row) => formatDateTime(row.at, locale),
    },
    {
      key: 'actor',
      header: t('systemAdmin.activity.fields.actor'),
      render: (row) =>
        row.actor === null ? (
          <span className="text-slate-400">{t('systemAdmin.audit.actorUnknown')}</span>
        ) : (
          <span>{row.actor.displayName[locale]}</span>
        ),
    },
    {
      key: 'message',
      header: t('systemAdmin.activity.fields.message'),
      // The catalog is owned by the modules that write these rows, and it is open-ended — an
      // unknown key renders as itself rather than as a broken-looking blank.
      render: (row) => <span>{t(row.messageKey, row.params)}</span>,
    },
    {
      key: 'entity',
      header: t('systemAdmin.activity.fields.entity'),
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.entityRef.moduleId}/{row.entityRef.entityType}
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('systemAdmin.activity.title')}
        description={t('systemAdmin.activity.subtitle')}
      />

      {/* Exactly the two the endpoint accepts. Offering more would be a control that produces a
          400, which reads on screen as "the log is broken". */}
      <FilterBar>
        <Input
          aria-label={t('systemAdmin.activity.fields.entityType')}
          placeholder={t('systemAdmin.audit.filters.entityTypePlaceholder')}
          dir="ltr"
          value={filters.entityType ?? ''}
          onChange={(e) => set('entityType', e.target.value)}
        />
        <Input
          aria-label={t('systemAdmin.activity.fields.entityId')}
          placeholder={t('systemAdmin.audit.filters.entityIdPlaceholder')}
          dir="ltr"
          value={filters.entityId ?? ''}
          onChange={(e) => set('entityId', e.target.value)}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={query.isLoading}
        // `DataTable` shows its error state for anything that is not `undefined`, and TanStack's
        // `error` is `null` when nothing failed — passing it straight through put every load in a
        // permanent error state. `isError` is the question actually being asked.
        error={query.isError ? query.error : undefined}
        onRetry={() => void query.refetch()}
        empty={<EmptyState title={t('systemAdmin.activity.empty')} />}
      />

      {query.data !== undefined && (
        <Pagination meta={query.data.meta} onPageChange={(next) => set('page', String(next))} />
      )}
    </PageContainer>
  );
};

export default ActivityLogPage;
