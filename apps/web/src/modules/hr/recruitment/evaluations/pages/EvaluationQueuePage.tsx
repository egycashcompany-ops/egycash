// Evaluations queue: the post-interview, file-based approval checks. A status filter, a sortable
// DataTable keyed by Application Number (no names), pagination, and an "Open evaluation" entry
// point — all permission-gated. Filter/sort/pagination sync with the URL query string.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EVALUATION_STATUSES, type EvaluationDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { Select } from '../../../../../shared/ui/form';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDate, localized } from '../../../../../shared/lib/format';
import { EvaluationStatusBadge } from '../components/EvaluationStatusBadge';
import { OpenEvaluationDialog } from '../components/OpenEvaluationDialog';
import { useEvaluations } from '../api/evaluation-queries';
import { type EvaluationListParams } from '../api/evaluation-api';

const DEFAULT_PAGE_SIZE = 25;

export const EvaluationQueuePage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [openDialog, setOpenDialog] = useState(false);

  const status = sp.get('status') ?? '';
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
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };

  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };

  const params = useMemo<EvaluationListParams>(
    () => ({ page, pageSize, sortBy: sort.by, sortDir: sort.dir, status: status || undefined }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useEvaluations(params);
  const rows = data?.items ?? [];

  const columns: Column<EvaluationDto>[] = [
    {
      key: 'applicantCode',
      header: t('evaluations.columns.applicant'),
      render: (e) => <span className="font-mono text-xs" dir="ltr">{e.applicantCode}</span>,
    },
    { key: 'phase', header: t('evaluations.columns.phase'), render: (e) => `${e.phaseOrder}. ${localized(e.phaseName, locale)}` },
    { key: 'status', header: t('evaluations.columns.status'), render: (e) => <EvaluationStatusBadge status={e.status} /> },
    {
      key: 'decidedAt',
      header: t('evaluations.columns.decidedAt'),
      render: (e) => (e.decidedAt === null ? '—' : formatDate(e.decidedAt, locale)),
    },
    { key: 'createdAt', header: t('evaluations.columns.created'), sortable: true, render: (e) => formatDate(e.createdAt, locale) },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitment.nav.evaluations')}
        description={t('evaluations.list.subtitle')}
        breadcrumbs={[{ label: t('recruitment.title'), to: '/' }, { label: t('recruitment.nav.evaluations') }]}
        actions={
          <div className="flex items-center gap-2">
            <Can permission="evaluationPhase.manage">
              <Button size="sm" variant="ghost" onClick={() => navigate('phases')}>
                {t('evaluations.phases.title')}
              </Button>
            </Can>
            <Can permission="evaluation.manage">
              <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setOpenDialog(true)}>
                {t('evaluations.actions.open')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-full sm:w-56"
            value={status}
            onChange={(e) => patch({ status: e.target.value || null })}
            aria-label={t('evaluations.columns.status')}
          >
            <option value="">{t('evaluations.filters.allStatuses')}</option>
            {EVALUATION_STATUSES.map((s) => (
              <option key={s} value={s}>{t(`evaluations.status.${s}`)}</option>
            ))}
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(e) => e.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          onRowClick={(e) => navigate(e.id)}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <OpenEvaluationDialog open={openDialog} onClose={() => setOpenDialog(false)} />
    </PageContainer>
  );
};
