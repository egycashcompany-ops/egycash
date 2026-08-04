// Applicants list: multi-filter + search, sortable/selectable DataTable, bulk withdraw,
// pagination, CSV export, and a create entry point — all permission-gated and RTL-safe.
// Filters, search, sort, and pagination are synchronized with the URL query string, so views
// are deep-linkable and back/forward navigation works. Selection is transient (not in the URL).
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type ApplicantDto, type ApplicantSourceDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { BulkActionBar } from '../../../../../shared/ui/BulkActionBar';
import { useTableSelection } from '../../../../../shared/ui/useTableSelection';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { PlusIcon, DownloadIcon } from '../../../../../shared/ui/icons';
import { readList, writeList } from '../../../../../shared/lib/list-param';
import { formatDate, formatNumber, localized } from '../../../../../shared/lib/format';
import { ApplicantStatusBadge } from '../components/ApplicantStatusBadge';
import { type PlacementDto } from '@ecms/contracts';
import { BulkReassignDialog } from '../components/BulkReassignDialog';
import { ApplicantFilters, type ApplicantFiltersState } from '../components/ApplicantFilters';
import { useApplicants, useApplicantSources, useBulkApplicants } from '../api/applicant-queries';
import { exportApplicantsCsv, type ApplicantListParams } from '../api/applicant-api';
import { useRememberedQueue } from '../../shared/useRememberedQueue';

const DEFAULT_PAGE_SIZE = 25;

export const ApplicantsListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  useRememberedQueue('applicants', [sp, setSp]);

  // ── URL-derived state ──────────────────────────────────────────────────────
  const filters: ApplicantFiltersState = {
    search: sp.get('q') ?? '',
    status: readList(sp, 'status') as ApplicantFiltersState['status'],
    sourceId: readList(sp, 'source'),
    intakeChannel: readList(sp, 'channel') as ApplicantFiltersState['intakeChannel'],
    identityVerification: readList(sp, 'identity') as ApplicantFiltersState['identityVerification'],
    duplicateOnly: sp.get('dup') === '1',
    hasAttachments: sp.get('files') === '1',
  };
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'createdAt:desc').split(':');
  const sort = { by: sortByRaw ?? 'createdAt', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
    by: string;
    dir: 'asc' | 'desc';
  };
  const paramsKey = sp.toString();

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };

  const changeFilters = (nf: ApplicantFiltersState): void =>
    patch({
      q: nf.search || null,
      status: writeList(nf.status),
      source: writeList(nf.sourceId),
      channel: writeList(nf.intakeChannel),
      identity: writeList(nf.identityVerification),
      dup: nf.duplicateOnly ? '1' : null,
      files: nf.hasAttachments ? '1' : null,
    });
  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };

  // ── Transient (non-URL) state ──────────────────────────────────────────────
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');

  const { data: sources = [] } = useApplicantSources();
  const sourceName = (id: string): string => {
    const found = sources.find((s: ApplicantSourceDto) => s.id === id);
    return found === undefined ? id : localized(found.name, locale);
  };

  const params = useMemo<ApplicantListParams>(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: filters.search,
      status: filters.status,
      sourceId: filters.sourceId,
      intakeChannel: filters.intakeChannel,
      identityVerification: filters.identityVerification,
      ...(filters.duplicateOnly ? { duplicateOnly: true } : {}),
      ...(filters.hasAttachments ? { hasAttachments: true } : {}),
    }),
    // params are derived entirely from the URL; paramsKey captures every input
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useApplicants(params);
  // I7 — the shared bulk hook: it reports the partial-success envelope the same way every other
  // recruitment table does, and clears the selection when at least one item applied.
  const bulk = useBulkApplicants(() => selection.clear());
  const rows = data?.items ?? [];

  // The shared selection model (RW17): always the intersection with the rows on screen, so a
  // filter or page change can never leave a selection meaning something the user did not see.
  const rowIds = useMemo(() => rows.map((a) => a.id), [rows]);
  const selection = useTableSelection(rowIds);

  const submitWithdraw = async (): Promise<void> => {
    try {
      await bulk.mutateAsync({ action: 'withdraw', ids: selection.ids, reason: withdrawReason });
      setWithdrawOpen(false);
      setWithdrawReason('');
    } catch {
      // surfaced by the global error handler
    }
  };

  /** The actions that need nothing but the selection — the hook reports the envelope. */
  const runBulk = async (action: 'moveToOffer' | 'moveToScreening'): Promise<void> => {
    try {
      await bulk.mutateAsync({ action, ids: selection.ids });
    } catch {
      // surfaced by the global error handler
    }
  };

  const submitBulkReassign = async (placement: PlacementDto, reason: string): Promise<void> => {
    await bulk.mutateAsync({ action: 'reassign', ids: selection.ids, placement, reason });
    setBulkReassignOpen(false);
  };

  const runExport = (): void => {
    void exportApplicantsCsv(params).catch(() => toast.error(t('applicants.export.failed')));
  };

  const columns: Column<ApplicantDto>[] = [
    {
      key: 'name',
      header: t('applicants.columns.name'),
      render: (a) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800 dark:text-slate-100">{a.fullNameAr}</p>
          {a.fullNameEn !== null && <p className="truncate text-xs text-slate-400" dir="ltr">{a.fullNameEn}</p>}
        </div>
      ),
    },
    { key: 'status', header: t('applicants.columns.status'), render: (a) => <ApplicantStatusBadge status={a.status} /> },
    { key: 'source', header: t('applicants.columns.source'), render: (a) => sourceName(a.sourceId) },
    {
      key: 'identity',
      header: t('applicants.columns.identity'),
      render: (a) => (
        <span className={a.identityVerification === 'verified' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>
          {t(`applicants.identity.${a.identityVerification}`)}
        </span>
      ),
    },
    { key: 'attachments', header: t('applicants.columns.attachments'), align: 'center', render: (a) => formatNumber(a.attachmentCount, locale) },
    { key: 'createdAt', header: t('applicants.columns.created'), sortable: true, render: (a) => formatDate(a.createdAt, locale) },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitment.nav.applicants')}
        description={t('applicants.list.subtitle')}
        breadcrumbs={[{ label: t('recruitment.title'), to: '/' }, { label: t('recruitment.nav.applicants') }]}
        actions={
          <>
            <Can permission="applicant.export">
              <Button variant="secondary" size="sm" leftIcon={<DownloadIcon className="h-4 w-4" />} onClick={runExport}>
                {t('applicants.actions.export')}
              </Button>
            </Can>
            <Can permission="applicant.create">
              <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
                {t('applicants.actions.create')}
              </Button>
            </Can>
          </>
        }
      />

      <div className="space-y-4">
        <ApplicantFilters value={filters} onChange={changeFilters} sources={sources} />

        <BulkActionBar count={selection.count} onClear={selection.clear}>
          {/* RW17 — one placement over the whole selection; each candidate is still checked
              against the editing window on its own. */}
          <Can permission="applicant.reassign">
            <Button size="sm" variant="secondary" onClick={() => setBulkReassignOpen(true)}>
              {t('applicants.reassign.selected')}
            </Button>
          </Can>
          <Can permission="applicant.moveToOffer">
            <Button
              size="sm"
              variant="secondary"
              loading={bulk.isPending}
              onClick={() => void runBulk('moveToOffer')}
            >
              {t('applicants.bulk.moveToOffer')}
            </Button>
          </Can>
          <Can permission="applicant.edit">
            <Button
              size="sm"
              variant="secondary"
              loading={bulk.isPending}
              onClick={() => void runBulk('moveToScreening')}
            >
              {t('applicants.bulk.moveToScreening')}
            </Button>
          </Can>
          <Can permission="applicant.edit">
            <Button size="sm" variant="danger" onClick={() => setWithdrawOpen(true)}>
              {t('applicants.actions.withdraw')}
            </Button>
          </Can>
        </BulkActionBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          onRowClick={(a) => navigate(a.id)}
          selection={selection}
        />

        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <Dialog
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title={t('applicants.withdraw.title')}
        description={t('applicants.withdraw.bulkBody', { count: formatNumber(selection.count, locale) })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setWithdrawOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={bulk.isPending} disabled={withdrawReason.trim() === ''} onClick={() => void submitWithdraw()}>
              {t('applicants.actions.withdraw')}
            </Button>
          </>
        }
      >
        <Field label={t('applicants.withdraw.reason')} required>
          <Textarea value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} rows={3} />
        </Field>
      </Dialog>
      <BulkReassignDialog
        open={bulkReassignOpen}
        count={selection.count}
        pending={bulk.isPending}
        onClose={() => setBulkReassignOpen(false)}
        onSubmit={submitBulkReassign}
      />

    </PageContainer>
  );
};
