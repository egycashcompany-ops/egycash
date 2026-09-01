// المندوبون — the customers' authorised delegates.
//
// These are the CUSTOMER's people. EGYCASH's own vault custodians are ECMS employees and are not
// administered here — that is integration 2, and the gold system's separate `supervisors` screen
// is deliberately gone.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type GoldRepresentativeDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { EditIcon, PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useDeleteGoldRepresentative, useGoldRepresentatives } from '../api/gold-queries';
import { RepresentativeDialog } from '../components/RepresentativeDialog';
import { fmtDate } from '../lib/gold-format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'q',
] as const;

const PAGE_SIZE = 12;

export const GoldRepresentativesPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const search = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
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

  const params = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, search: search === '' ? undefined : search }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useGoldRepresentatives(params);
  const remove = useDeleteGoldRepresentative();

  const [dialog, setDialog] = useState<{ open: boolean; row: GoldRepresentativeDto | null }>({
    open: false,
    row: null,
  });

  const onDelete = async (row: GoldRepresentativeDto): Promise<void> => {
    if (!window.confirm(t('gold.representatives.deletePrompt', { name: row.fullName }))) return;
    try {
      await remove.mutateAsync(row.id);
      toast.success(t('gold.common.deleted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const columns: Column<GoldRepresentativeDto>[] = [
    {
      key: 'fullName',
      header: t('gold.representatives.name'),
      render: (r) => (
        <span className="font-medium text-slate-900 dark:text-slate-100">{r.fullName}</span>
      ),
    },
    {
      key: 'company',
      header: t('gold.representatives.company'),
      render: (r) => r.companyName ?? '—',
    },
    {
      key: 'nationalId',
      header: t('gold.common.nationalId'),
      render: (r) => (r.nationalId === null ? '—' : <span dir="ltr">{r.nationalId}</span>),
    },
    {
      key: 'phone',
      header: t('gold.representatives.phone'),
      render: (r) => (r.phone === null ? '—' : <span dir="ltr">{r.phone}</span>),
    },
    { key: 'jobTitle', header: t('gold.representatives.job'), render: (r) => r.jobTitle ?? '—' },
    {
      key: 'status',
      header: t('gold.common.status'),
      render: (r) => (
        <StatusBadge
          tone={r.status === 'active' ? 'success' : 'neutral'}
          label={t(`gold.activeStatus.${r.status}`)}
        />
      ),
    },
    {
      key: 'joinDate',
      header: t('gold.representatives.joinDate'),
      render: (r) => fmtDate(r.joinDate),
    },
    {
      key: 'actions',
      header: t('gold.common.actions'),
      align: 'end',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Can permission="goldRepresentative.edit">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${t('gold.common.edit')} — ${r.fullName}`}
              onClick={() => {
                setDialog({ open: true, row: r });
              }}
            >
              <EditIcon className="h-4 w-4" />
            </Button>
          </Can>
          <Can permission="goldRepresentative.delete">
            <Button
              variant="ghost-danger"
              size="sm"
              aria-label={`${t('gold.common.delete')} — ${r.fullName}`}
              onClick={() => {
                void onDelete(r);
              }}
            >
              <TrashIcon className="h-4 w-4" />
            </Button>
          </Can>
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('gold.nav.representatives')}
        description={t('gold.representatives.subtitle')}
        breadcrumbs={[
          { label: t('gold.module.title'), to: '/gold' },
          { label: t('gold.nav.representatives') },
        ]}
        actions={
          <Can permission="goldRepresentative.create">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setDialog({ open: true, row: null });
              }}
            >
              {t('gold.representatives.new')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={search !== ''}
          onClear={() => {
            patch({ q: null });
          }}
        >
          <SearchInput
            value={search}
            onChange={(value) => {
              patch({ q: value === '' ? null : value });
            }}
            placeholder={t('gold.representatives.searchPlaceholder')}
            className="w-72"
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          empty={t('gold.representatives.empty')}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => {
              patch({ page: String(p) }, false);
            }}
          />
        )}
      </div>

      {dialog.open && (
        <RepresentativeDialog
          representative={dialog.row}
          onClose={() => {
            setDialog({ open: false, row: null });
          }}
        />
      )}
    </PageContainer>
  );
};
