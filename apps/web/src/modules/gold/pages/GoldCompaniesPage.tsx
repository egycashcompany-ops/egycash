// الشركات والصناديق — the owners of the metal in the vault.
//
// The gold screen, restyled: a searchable table filtered by owner type, and one dialog that both
// creates and edits. Two things carried over deliberately — the logo (now stored in the platform
// Files service instead of Cloudinary) and the fact that DELETE is a soft delete, because every
// bar, receipt and transfer names its owner.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type GoldCompanyDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { EditIcon, PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { readList, writeList } from '../../../shared/lib/list-param';
import { useDeleteGoldCompany, useGoldCompanies } from '../api/gold-queries';
import { CompanyDialog } from '../components/CompanyDialog';
import { CompanyLogo } from '../components/CompanyLogo';
import { companyTypeLabel, companyTypeOptions } from '../components/gold-labels';
import { fmtDate } from '../lib/gold-format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'q',
  'type',
] as const;

const PAGE_SIZE = 12;

export const GoldCompaniesPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const search = sp.get('q') ?? '';
  const types = readList(sp, 'type');
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
    () => ({
      page,
      pageSize: PAGE_SIZE,
      search: search === '' ? undefined : search,
      type: types.length === 0 ? undefined : types,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useGoldCompanies(params);
  const remove = useDeleteGoldCompany();

  const [dialog, setDialog] = useState<{ open: boolean; company: GoldCompanyDto | null }>({
    open: false,
    company: null,
  });

  const onDelete = async (company: GoldCompanyDto): Promise<void> => {
    if (!window.confirm(t('gold.companies.deletePrompt', { name: company.name }))) return;
    try {
      await remove.mutateAsync(company.id);
      toast.success(t('gold.common.deleted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const columns: Column<GoldCompanyDto>[] = [
    {
      key: 'logo',
      header: '',
      render: (c) => <CompanyLogo fileId={c.logoFileId} name={c.name} size={36} />,
    },
    {
      key: 'name',
      header: t('gold.companies.name'),
      sortable: true,
      render: (c) => (
        <span className="font-medium text-slate-900 dark:text-slate-100">{c.name}</span>
      ),
    },
    { key: 'type', header: t('gold.companies.type'), render: (c) => companyTypeLabel(t, c.type) },
    {
      key: 'phone',
      header: t('gold.companies.phone'),
      render: (c) => (c.phone === null ? '—' : <span dir="ltr">{c.phone}</span>),
    },
    {
      key: 'email',
      header: t('gold.companies.emailShort'),
      render: (c) => (c.email === null ? '—' : <span dir="ltr">{c.email}</span>),
    },
    {
      key: 'status',
      header: t('gold.common.status'),
      render: (c) => (
        <StatusBadge
          tone={c.status === 'active' ? 'success' : 'neutral'}
          label={t(`gold.activeStatus.${c.status}`)}
        />
      ),
    },
    {
      key: 'createdAt',
      header: t('gold.companies.createdAt'),
      render: (c) => fmtDate(c.createdAt),
    },
    {
      key: 'actions',
      header: t('gold.common.actions'),
      align: 'end',
      render: (c) => (
        <div className="flex justify-end gap-1">
          <Can permission="goldCompany.edit">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${t('gold.common.edit')} — ${c.name}`}
              onClick={() => {
                setDialog({ open: true, company: c });
              }}
            >
              <EditIcon className="h-4 w-4" />
            </Button>
          </Can>
          <Can permission="goldCompany.delete">
            <Button
              variant="ghost-danger"
              size="sm"
              aria-label={`${t('gold.common.delete')} — ${c.name}`}
              onClick={() => {
                void onDelete(c);
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
        title={t('gold.nav.companies')}
        description={t('gold.companies.subtitle')}
        breadcrumbs={[
          { label: t('gold.module.title'), to: '/gold' },
          { label: t('gold.nav.companies') },
        ]}
        actions={
          <Can permission="goldCompany.create">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setDialog({ open: true, company: null });
              }}
            >
              {t('gold.companies.new')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={search !== '' || types.length > 0}
          onClear={() => {
            patch({ q: null, type: null });
          }}
        >
          <SearchInput
            value={search}
            onChange={(value) => {
              patch({ q: value === '' ? null : value });
            }}
            placeholder={t('gold.companies.searchPlaceholder')}
            className="w-64"
          />
          <MultiSelect
            label={t('gold.common.allTypes')}
            options={companyTypeOptions(t)}
            value={types}
            onChange={(values) => {
              patch({ type: writeList(values) });
            }}
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(c) => c.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          empty={t('gold.companies.empty')}
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
        <CompanyDialog
          company={dialog.company}
          onClose={() => {
            setDialog({ open: false, company: null });
          }}
        />
      )}
    </PageContainer>
  );
};
