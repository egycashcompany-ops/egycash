// The audit log (P11).
//
// The stream, the filters, the export and the permissions have all existed since Sprint 3.2; the
// System Administration plan named this screen as a later phase and a test refused its route until
// the work arrived. This is that work. It adds no endpoint, no permission and no setting.
//
// Three things it is deliberate about:
//
//   • **`ip` and `userAgent` are not columns.** They are in the detail panel, where a row is being
//     questioned, rather than in front of everyone scrolling a table of colleagues' work.
//   • **Reading is not exporting.** `auditLog.export` is a separate grant with its own row cap, its
//     own audit row and its own security signal, so the control is separate and withheld without it.
//   • **`entityType` is a free-text field.** Nothing on the server enumerates the entity types that
//     exist, so a dropdown here would be a hand-written list that rots silently. The screen says
//     what it wants instead of pretending to know.
//
// **A known limit, stated rather than implied:** `auditLog.view` reads the WHOLE organization.
// Nothing in this screen narrows that, because nothing on the server does — the list endpoint
// applies no data scoping, and adding one is an authorization change, not a screen.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AuditLogDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Badge, Button, DataTable, Dialog, FilterBar, Pagination, type Column } from '../../../../shared/ui';
import { Input, Select } from '../../../../shared/ui/form';
import { EmptyState } from '../../../../shared/ui/states/EmptyState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../../shared/lib/errors';
import { formatDateTime } from '../../../../shared/lib/format';
import { downloadAuditExport, useAuditLogs } from '../api/audit-api';
import { AuditDetailPanel } from '../components/AuditDetailPanel';
import { auditActionLabelKey, auditActions } from '../lib/audit-labels';
import { readAuditFilters, withParam } from '../lib/audit-filters';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'action',
  'entityId',
  'entityType',
  'from',
  'to',
] as const;

export const AuditLogPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const [selected, setSelected] = useState<AuditLogDto | null>(null);
  const [exporting, setExporting] = useState(false);

  const filters = readAuditFilters(sp);
  const query = useAuditLogs(filters);
  const set = (name: string, value: string): void =>
    setSp(withParam(sp, name, value), { replace: true });

  const columns: Column<AuditLogDto>[] = [
    {
      key: 'at',
      header: t('systemAdmin.audit.fields.at'),
      render: (row) => formatDateTime(row.at, locale),
    },
    {
      key: 'actor',
      header: t('systemAdmin.audit.fields.actor'),
      // The snapshot, never a resolved-at-read-time name: history says who they were then.
      render: (row) =>
        row.actorSnapshot === null ? (
          <span className="text-slate-400">{t('systemAdmin.audit.actorUnknown')}</span>
        ) : (
          <span>{row.actorSnapshot.displayName[locale]}</span>
        ),
    },
    {
      key: 'action',
      header: t('systemAdmin.audit.fields.action'),
      render: (row) => <Badge tone="neutral">{t(auditActionLabelKey(row.action))}</Badge>,
    },
    {
      key: 'entity',
      header: t('systemAdmin.audit.fields.entity'),
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.entityRef.moduleId}/{row.entityRef.entityType}
        </span>
      ),
    },
    {
      key: 'changes',
      header: t('systemAdmin.audit.fields.changeCount'),
      render: (row) => <span dir="ltr">{row.changes.length}</span>,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('systemAdmin.audit.title')}
        description={t('systemAdmin.audit.subtitle')}
        actions={
          can('auditLog.export') ? (
            <Button
              variant="secondary"
              disabled={exporting}
              onClick={() => {
                setExporting(true);
                void downloadAuditExport(filters)
                  .catch((error: unknown) => toast.error(errorMessage(error, locale)))
                  .finally(() => setExporting(false));
              }}
            >
              {t('systemAdmin.audit.export')}
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <Select
          aria-label={t('systemAdmin.audit.fields.action')}
          value={filters.action ?? ''}
          onChange={(e) => set('action', e.target.value)}
        >
          <option value="">{t('systemAdmin.audit.filters.allActions')}</option>
          {auditActions.map((action) => (
            <option key={action} value={action}>
              {t(auditActionLabelKey(action))}
            </option>
          ))}
        </Select>
        {/* Free text: nothing on the server enumerates entity types, and a hand-written list here
            would rot without anyone noticing. */}
        <Input
          aria-label={t('systemAdmin.audit.fields.entityType')}
          placeholder={t('systemAdmin.audit.filters.entityTypePlaceholder')}
          dir="ltr"
          value={filters.entityType ?? ''}
          onChange={(e) => set('entityType', e.target.value)}
        />
        <Input
          aria-label={t('systemAdmin.audit.fields.entityId')}
          placeholder={t('systemAdmin.audit.filters.entityIdPlaceholder')}
          dir="ltr"
          value={filters.entityId ?? ''}
          onChange={(e) => set('entityId', e.target.value)}
        />
        <Input
          aria-label={t('systemAdmin.audit.fields.from')}
          type="date"
          value={filters.from ?? ''}
          onChange={(e) => set('from', e.target.value)}
        />
        <Input
          aria-label={t('systemAdmin.audit.fields.to')}
          type="date"
          value={filters.to ?? ''}
          onChange={(e) => set('to', e.target.value)}
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
        onRowClick={(row) => setSelected(row)}
        empty={<EmptyState title={t('systemAdmin.audit.empty')} />}
      />

      {query.data !== undefined && (
        <Pagination meta={query.data.meta} onPageChange={(next) => set('page', String(next))} />
      )}

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        size="lg"
        title={t('systemAdmin.audit.detailTitle')}
      >
        {selected !== null && <AuditDetailPanel row={selected} />}
      </Dialog>
    </PageContainer>
  );
};

export default AuditLogPage;
