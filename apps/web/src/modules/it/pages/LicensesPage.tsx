// Licence compliance (design §2.8, §11, FR-10).
//
// The two numbers this screen exists for — `seatsUsed` and `state` — are DERIVED server-side and
// arrive on the DTO. Nothing here recomputes either: a client counting its own seats would
// disagree with the sweep the moment a page boundary fell between two installations, and the whole
// point of FR-10's "computed, never stored" is that there is exactly one answer.
//
// Over-seats is shown, never blocked. §13-Q5 adopted warn-only, so this is a report someone
// watches — which is precisely what makes the warn-only stance defensible.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IT_LICENSE_STATES, type ItLicenseDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Select } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { BadgeIcon, EditIcon, EyeIcon, PlusIcon } from '../../../shared/ui/icons';
import { formatDate } from '../../../shared/lib/format';
import { useItLicenses } from '../api/it-queries';
import { LicenseStateBadge } from '../components/LicenseStateBadge';
import { ItSoftwareProductName } from '../components/ItSoftwareProductName';
import { LicenseDialog } from '../components/LicenseDialog';

const DEFAULT_PAGE_SIZE = 25;

export const LicensesPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();

  const [state, setState] = useState('');
  const [overSeats, setOverSeats] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ItLicenseDto | null>(null);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: 'expiresAt',
      sortDir: 'asc' as const,
      state: state || undefined,
      overSeats: overSeats === '' ? undefined : true,
    }),
    [page, pageSize, state, overSeats],
  );
  const { data, isLoading, isError, error, refetch } = useItLicenses(params);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<ItLicenseDto>[] = [
    {
      key: 'productId',
      header: t('it.licenses.columns.product'),
      render: (l) => <ItSoftwareProductName id={l.productId} />,
    },
    {
      key: 'state',
      header: t('it.licenses.columns.state'),
      render: (l) => <LicenseStateBadge state={l.state} />,
    },
    {
      key: 'seats',
      header: t('it.licenses.columns.seats'),
      // The compliance number, shown as used-of-licensed so an overrun reads at a glance.
      render: (l) => (
        <span
          className={`font-mono text-sm ${
            l.seats !== null && l.seatsUsed > l.seats
              ? 'font-semibold text-amber-700 dark:text-amber-400'
              : ''
          }`}
          dir="ltr"
        >
          {l.seatsUsed} / {l.seats === null ? '∞' : l.seats}
        </span>
      ),
    },
    {
      key: 'expiresAt',
      header: t('it.licenses.columns.expiresAt'),
      sortable: true,
      render: (l) =>
        l.expiresAt === null ? t('it.licenses.state.perpetual') : formatDate(l.expiresAt, locale),
    },
    {
      key: 'invoiceRef',
      header: t('it.licenses.columns.invoiceRef'),
      render: (l) => l.purchase?.invoiceRef ?? '—',
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (l) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            className={actionButton}
            aria-label={t('it.licenses.open')}
            title={t('it.licenses.open')}
            onClick={() => navigate(l.id)}
          >
            <EyeIcon className="h-4 w-4" />
          </button>
          {can('itLicense.manage') && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('common.edit')}
              title={t('common.edit')}
              onClick={() => setEditing(l)}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.licenses')}
        description={t('it.licenses.subtitle')}
        breadcrumbs={[{ label: t('it.module.title'), to: '/it' }, { label: t('it.nav.licenses') }]}
        actions={
          <Can permission="itLicense.manage">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setCreating(true)}
            >
              {t('it.licenses.add')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={state !== '' || overSeats !== ''}
          onClear={() => {
            setState('');
            setOverSeats('');
            setPage(1);
          }}
        >
          <Select
            aria-label={t('it.licenses.columns.state')}
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(1);
            }}
            className="w-auto"
          >
            <option value="">{t('it.licenses.allStates')}</option>
            {IT_LICENSE_STATES.map((value) => (
              <option key={value} value={value}>
                {t(`it.licenses.state.${value}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('it.licenses.seatFilter')}
            value={overSeats}
            onChange={(e) => {
              setOverSeats(e.target.value);
              setPage(1);
            }}
            className="w-auto"
          >
            <option value="">{t('it.licenses.anySeatLevel')}</option>
            <option value="over">{t('it.licenses.onlyOverSeats')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(l) => l.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          empty={
            <EmptyState
              icon={<BadgeIcon className="h-10 w-10" />}
              title={t('it.licenses.emptyTitle')}
              description={t('it.licenses.emptyBody')}
            />
          }
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </div>

      <LicenseDialog open={creating} onClose={() => setCreating(false)} license={null} />
      <LicenseDialog open={editing !== null} onClose={() => setEditing(null)} license={editing} />
    </PageContainer>
  );
};
