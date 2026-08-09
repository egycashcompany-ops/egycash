// The software register (design §2.8, §7, §12) — two tabs over one screen, because the catalogue
// and what runs where are the same operational question asked from two ends.
//
// Every column is a SERVER fact. An installation's "active" is `removedAt === null`, never a stored
// status, and the row survives removal so the register can answer what WAS on a machine.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type ItSoftwareInstallationDto,
  type ItSoftwareProductDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Select } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { EditIcon, LayersIcon, PlusIcon } from '../../../shared/ui/icons';
import { formatDate } from '../../../shared/lib/format';
import { useItSoftwareInstallations, useItSoftwareProducts } from '../api/it-queries';
import { ItAssetLink } from '../components/ItAssetLink';
import { ItSoftwareProductName } from '../components/ItSoftwareProductName';
import {
  RecordInstallationDialog,
  RemoveInstallationDialog,
  SoftwareProductDialog,
} from '../components/SoftwareDialogs';

const DEFAULT_PAGE_SIZE = 25;
const TABS = ['products', 'installations'] as const;
type Tab = (typeof TABS)[number];

export const SoftwarePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [creatingProduct, setCreatingProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ItSoftwareProductDto | null>(null);
  const [installing, setInstalling] = useState(false);
  const [removing, setRemoving] = useState<ItSoftwareInstallationDto | null>(null);

  const productParams = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: 'name',
      sortDir: 'asc' as const,
      search: search || undefined,
      active: active === '' ? undefined : active === 'true',
    }),
    [page, pageSize, search, active],
  );
  const installParams = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: 'installedAt',
      sortDir: 'desc' as const,
      active: active === '' ? undefined : active === 'true',
    }),
    [page, pageSize, active],
  );

  const products = useItSoftwareProducts(productParams, tab === 'products');
  const installs = useItSoftwareInstallations(installParams, tab === 'installations');
  const current = tab === 'products' ? products : installs;

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const productColumns: Column<ItSoftwareProductDto>[] = [
    { key: 'name', header: t('it.software.columns.name'), sortable: true, render: (p) => p.name },
    {
      key: 'publisher',
      header: t('it.software.columns.publisher'),
      render: (p) => p.publisher ?? '—',
    },
    {
      key: 'active',
      header: t('it.software.columns.state'),
      render: (p) => (
        <StatusBadge
          tone={p.active ? 'success' : 'neutral'}
          label={p.active ? t('it.software.stateActive') : t('it.software.stateArchived')}
        />
      ),
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (p) =>
        can('itSoftware.manage') ? (
          <button
            type="button"
            className={actionButton}
            aria-label={`${t('common.edit')} — ${p.name}`}
            title={t('common.edit')}
            onClick={() => setEditingProduct(p)}
          >
            <EditIcon className="h-4 w-4" />
          </button>
        ) : null,
    },
  ];

  const installColumns: Column<ItSoftwareInstallationDto>[] = [
    {
      key: 'productId',
      header: t('it.software.columns.product'),
      render: (i) => <ItSoftwareProductName id={i.productId} />,
    },
    {
      key: 'assetId',
      header: t('it.software.columns.asset'),
      render: (i) => <ItAssetLink id={i.assetId} />,
    },
    {
      key: 'softwareVersion',
      header: t('it.software.columns.softwareVersion'),
      render: (i) => i.softwareVersion ?? '—',
    },
    {
      key: 'installedAt',
      header: t('it.software.columns.installedAt'),
      sortable: true,
      render: (i) => formatDate(i.installedAt, locale),
    },
    {
      key: 'removedAt',
      header: t('it.software.columns.state'),
      render: (i) => (
        <StatusBadge
          tone={i.removedAt === null ? 'success' : 'neutral'}
          label={
            i.removedAt === null
              ? t('it.software.installActive')
              : `${t('it.software.installRemoved')} — ${formatDate(i.removedAt, locale)}`
          }
        />
      ),
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (i) =>
        can('itSoftware.manage') && i.removedAt === null ? (
          <Button size="sm" variant="ghost" onClick={() => setRemoving(i)}>
            {t('it.software.remove')}
          </Button>
        ) : null,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.software')}
        description={t('it.software.subtitle')}
        breadcrumbs={[{ label: t('it.module.title'), to: '/it' }, { label: t('it.nav.software') }]}
        actions={
          <div className="flex items-center gap-2">
            {can('itLicense.view') && (
              <Button size="sm" variant="secondary" onClick={() => navigate('/it/licenses')}>
                {t('it.nav.licenses')}
              </Button>
            )}
            <Can permission="itSoftware.manage">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => (tab === 'products' ? setCreatingProduct(true) : setInstalling(true))}
              >
                {tab === 'products' ? t('it.software.add') : t('it.software.install')}
              </Button>
            </Can>
          </div>
        }
      />

      <div
        className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
        role="tablist"
        aria-label={t('it.nav.software')}
      >
        {TABS.map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            type="button"
            onClick={() => {
              setTab(value);
              setPage(1);
            }}
            className={`rounded-t-lg px-4 py-2 text-sm ${
              tab === value
                ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(`it.software.tab.${value}`)}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={search !== '' || active !== 'true'}
          onClear={() => {
            setSearch('');
            setActive('true');
            setPage(1);
          }}
        >
          {tab === 'products' && (
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder={t('it.software.searchPlaceholder')}
              aria-label={t('it.software.searchPlaceholder')}
              className="w-64"
            />
          )}
          <Select
            aria-label={t('it.software.columns.state')}
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              setPage(1);
            }}
            className="w-auto"
          >
            <option value="">{t('it.software.anyState')}</option>
            <option value="true">
              {tab === 'products' ? t('it.software.stateActive') : t('it.software.installActive')}
            </option>
            <option value="false">
              {tab === 'products' ? t('it.software.stateArchived') : t('it.software.installRemoved')}
            </option>
          </Select>
        </FilterBar>

        {tab === 'products' ? (
          <DataTable
            columns={productColumns}
            rows={products.data?.items ?? []}
            rowKey={(p) => p.id}
            loading={products.isLoading}
            error={products.isError ? products.error : undefined}
            onRetry={() => void products.refetch()}
            empty={
              <EmptyState
                icon={<LayersIcon className="h-10 w-10" />}
                title={t('it.software.emptyProductsTitle')}
                description={t('it.software.emptyProductsBody')}
              />
            }
          />
        ) : (
          <DataTable
            columns={installColumns}
            rows={installs.data?.items ?? []}
            rowKey={(i) => i.id}
            loading={installs.isLoading}
            error={installs.isError ? installs.error : undefined}
            onRetry={() => void installs.refetch()}
            empty={
              <EmptyState
                icon={<LayersIcon className="h-10 w-10" />}
                title={t('it.software.emptyInstallsTitle')}
                description={t('it.software.emptyInstallsBody')}
              />
            }
          />
        )}
        {current.data !== undefined && current.data.meta.totalItems > 0 && (
          <Pagination
            meta={current.data.meta}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </div>

      <SoftwareProductDialog
        open={creatingProduct}
        onClose={() => setCreatingProduct(false)}
        product={null}
      />
      <SoftwareProductDialog
        open={editingProduct !== null}
        onClose={() => setEditingProduct(null)}
        product={editingProduct}
      />
      <RecordInstallationDialog open={installing} onClose={() => setInstalling(false)} />
      {removing !== null && (
        <RemoveInstallationDialog open onClose={() => setRemoving(null)} installation={removing} />
      )}
    </PageContainer>
  );
};
