// Applicants list: multi-filter + search, sortable/selectable DataTable, bulk withdraw,
// pagination, CSV export, and a create entry point — all permission-gated and RTL-safe.
// Filters, search, sort, and pagination are synchronized with the URL query string, so views
// are deep-linkable and back/forward navigation works. Selection is transient (not in the URL).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type ApplicantDto, type ApplicantSourceDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { BulkActions } from '../../../../../shared/ui/BulkActions';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { PlusIcon, DownloadIcon } from '../../../../../shared/ui/icons';
import { formatDate, formatNumber, localized } from '../../../../../shared/lib/format';
import { ApplicantStatusBadge } from '../components/ApplicantStatusBadge';
import { ApplicantFilters, type ApplicantFiltersState } from '../components/ApplicantFilters';
import { useApplicants, useApplicantSources, useBulkApplicants } from '../api/applicant-queries';
import { exportApplicantsCsv, type ApplicantListParams } from '../api/applicant-api';

const DEFAULT_PAGE_SIZE = 25;

export const ApplicantsListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  // ── URL-derived state ──────────────────────────────────────────────────────
  const filters: ApplicantFiltersState = {
    search: sp.get('q') ?? '',
    status: (sp.get('status') ?? '') as ApplicantFiltersState['status'],
    sourceId: sp.get('source') ?? '',
    intakeChannel: (sp.get('channel') ?? '') as ApplicantFiltersState['intakeChannel'],
    identityVerification: (sp.get('identity') ?? '') as ApplicantFiltersState['identityVerification'],
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
      status: nf.status || null,
      source: nf.sourceId || null,
      channel: nf.intakeChannel || null,
      identity: nf.identityVerification || null,
      dup: nf.duplicateOnly ? '1' : null,
      files: nf.hasAttachments ? '1' : null,
    });
  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };

  // ── Transient (non-URL) state ──────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  useEffect(() => {
    setSelected(new Set());
  }, [paramsKey]);

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
  const bulk = useBulkApplicants();
  const rows = data?.items ?? [];

  const toggleRow = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = (checked: boolean): void => {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  };

  const submitWithdraw = async (): Promise<void> => {
    try {
      const result = await bulk.mutateAsync({ action: 'withdraw', ids: [...selected], reason: withdrawReason });
      toast.success(
        t('applicants.bulk.withdrawDone', {
          ok: formatNumber(result.succeeded, locale),
          total: formatNumber(result.requested, locale),
        }),
      );
      setWithdrawOpen(false);
      setWithdrawReason('');
      setSelected(new Set());
    } catch {
      // surfaced by the global error handler
    }
  };

  const runExport = (): void => {
    void exportApplicantsCsv(params).catch(() => toast.error(t('applicants.export.failed')));
  };

  const columns: Column<ApplicantDto>[] = [
    {
      key: 'code',
      header: t('applicants.columns.code'),
      sortable: true,
      render: (a) => <span className="font-mono text-xs" dir="ltr">{a.code}</span>,
    },
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

        <Can permission="applicant.edit">
          <BulkActions count={selected.size} onClear={() => setSelected(new Set())}>
            <Button size="sm" variant="danger" onClick={() => setWithdrawOpen(true)}>
              {t('applicants.actions.withdraw')}
            </Button>
          </BulkActions>
        </Can>

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
          selectable
          selectedIds={selected}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
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
        description={t('applicants.withdraw.bulkBody', { count: formatNumber(selected.size, locale) })}
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
    </PageContainer>
  );
};
