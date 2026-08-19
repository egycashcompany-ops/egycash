// السبائك — the bar register.
//
// Read-mostly by design, and the banner says why: a bar is BORN from a confirmed receiving receipt
// and LEAVES through a delivery order. What can be edited here is descriptive (metal, purity,
// sealed, notes) — never where the bar is or who owns it, because those are movements with
// documents behind them.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type GoldBarDto, type GoldMetalType } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Dialog } from '../../../shared/ui/Dialog';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Checkbox, Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { AlertIcon, EditIcon, ResetIcon } from '../../../shared/ui/icons';
import { Timeline } from '../../../shared/ui/Timeline';
import { toast } from '../../../shared/ui/toast/toast-store';
import { readList, writeList } from '../../../shared/lib/list-param';
import {
  useGoldBarFacets,
  useGoldBarHistory,
  useGoldBars,
  useUpdateGoldBar,
} from '../api/gold-queries';
import { BranchTag } from '../components/BranchTag';
import {
  barActionLabel,
  barStatusLabel,
  barStatusTone,
  metalLabel,
  metalOptions,
} from '../components/gold-labels';
import { useGoldCompanyOptions } from '../components/useGoldCompanyOptions';
import { fmtDateTime, fmtWeightValue } from '../lib/gold-format';

const PAGE_SIZE = 12;

const HistoryDialog = ({ barId, onClose }: { barId: string; onClose: () => void }): JSX.Element => {
  const t = useT();
  const { data, isLoading } = useGoldBarHistory(barId);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('gold.bars.historyTitle', { serial: data?.serialNumber ?? '' })}
      size="lg"
    >
      {isLoading && <p className="py-6 text-center text-slate-500">{t('gold.common.loading')}</p>}
      {!isLoading && (data?.history.length ?? 0) === 0 && (
        <p className="py-6 text-center text-slate-500 dark:text-slate-400">
          {t('gold.bars.noHistory')}
        </p>
      )}
      {(data?.history.length ?? 0) > 0 && (
        <Timeline
          entries={(data?.history ?? []).map((entry, index) => ({
            id: String(index),
            title: barActionLabel(t, entry.action),
            // The receipt or transfer number this movement belongs to, when it had one.
            ...(entry.reference === null ? {} : { meta: entry.reference }),
            at: fmtDateTime(entry.at),
          }))}
        />
      )}
    </Dialog>
  );
};

const EditDialog = ({ bar, onClose }: { bar: GoldBarDto; onClose: () => void }): JSX.Element => {
  const t = useT();
  const update = useUpdateGoldBar();
  const [metalType, setMetalType] = useState<GoldMetalType>(bar.metalType);
  const [purity, setPurity] = useState(bar.purity ?? '');
  const [sealed, setSealed] = useState(bar.sealed);
  const [notes, setNotes] = useState(bar.notes ?? '');

  const save = async (): Promise<void> => {
    try {
      await update.mutateAsync({
        id: bar.id,
        body: {
          metalType,
          purity: purity.trim() === '' ? null : purity.trim(),
          sealed,
          notes: notes.trim() === '' ? null : notes.trim(),
          version: bar.version,
        },
      });
      toast.success(t('gold.common.saved'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('gold.bars.editTitle', { serial: bar.serialNumber })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('gold.common.cancel')}
          </Button>
          <Button loading={update.isPending} onClick={() => void save()}>
            {t('gold.common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('gold.common.metalType')}>
          <Select
            value={metalType}
            onChange={(e) => {
              setMetalType(e.target.value as GoldMetalType);
            }}
          >
            {metalOptions(t).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('gold.common.purity')}>
          <Input
            value={purity}
            onChange={(e) => {
              setPurity(e.target.value);
            }}
          />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            label={t('gold.bars.sealed')}
            checked={sealed}
            onChange={(e) => {
              setSealed(e.target.checked);
            }}
          />
        </div>
        <div className="sm:col-span-2">
          <Field label={t('gold.common.notes')}>
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
            />
          </Field>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
          {t('gold.bars.editHint')}
        </p>
      </div>
    </Dialog>
  );
};

export const GoldBarsPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const search = sp.get('q') ?? '';
  const companies = readList(sp, 'company');
  const metals = readList(sp, 'metal');
  const purities = readList(sp, 'purity');
  const statuses = readList(sp, 'status');
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
      companyId: companies.length === 0 ? undefined : companies,
      metalType: metals.length === 0 ? undefined : metals,
      purity: purities.length === 0 ? undefined : purities,
      status: statuses.length === 0 ? undefined : statuses,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useGoldBars(params);
  const facets = useGoldBarFacets();
  const owners = useGoldCompanyOptions();

  const [historyId, setHistoryId] = useState<string | null>(null);
  const [editing, setEditing] = useState<GoldBarDto | null>(null);

  const columns: Column<GoldBarDto>[] = [
    {
      key: 'serialNumber',
      header: t('gold.common.serial'),
      sortable: true,
      render: (b) => (
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {b.serialNumber}
          <BranchTag name={b.branchName} />
        </span>
      ),
    },
    { key: 'company', header: t('gold.common.owner'), render: (b) => b.companyName ?? '—' },
    {
      key: 'metalType',
      header: t('gold.common.metalType'),
      render: (b) => metalLabel(t, b.metalType),
    },
    { key: 'purity', header: t('gold.common.purity'), render: (b) => b.purity ?? '—' },
    {
      key: 'weight',
      header: t('gold.common.weight'),
      sortable: true,
      render: (b) => t('gold.common.grams', { value: fmtWeightValue(b.weight) }),
    },
    { key: 'brand', header: t('gold.common.brand'), render: (b) => b.brand ?? '—' },
    {
      key: 'location',
      header: t('gold.bars.location'),
      render: (b) =>
        b.currentVaultId === null
          ? '—'
          : `${b.currentVaultCode ?? ''} / ${t('gold.common.drawerNumber', { number: b.currentDrawerNumber ?? '—' })}`,
    },
    {
      key: 'status',
      header: t('gold.common.status'),
      render: (b) => (
        <StatusBadge tone={barStatusTone(b.status)} label={barStatusLabel(t, b.status)} />
      ),
    },
    {
      key: 'actions',
      header: t('gold.common.actions'),
      align: 'end',
      render: (b) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${t('gold.bars.history')} — ${b.serialNumber}`}
            onClick={() => {
              setHistoryId(b.id);
            }}
          >
            <ResetIcon className="h-4 w-4" />
          </Button>
          <Can permission="goldBar.edit">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${t('gold.common.edit')} — ${b.serialNumber}`}
              onClick={() => {
                setEditing(b);
              }}
            >
              <EditIcon className="h-4 w-4" />
            </Button>
          </Can>
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('gold.nav.bars')}
        description={t('gold.bars.subtitle')}
        breadcrumbs={[
          { label: t('gold.module.title'), to: '/gold' },
          { label: t('gold.nav.bars') },
        ]}
      />

      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <AlertIcon className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
          {t('gold.bars.entryHint')}
        </div>

        <FilterBar
          hasActiveFilters={
            search !== '' ||
            companies.length > 0 ||
            metals.length > 0 ||
            purities.length > 0 ||
            statuses.length > 0
          }
          onClear={() => {
            patch({ q: null, company: null, metal: null, purity: null, status: null });
          }}
        >
          <SearchInput
            value={search}
            onChange={(value) => {
              patch({ q: value === '' ? null : value });
            }}
            placeholder={t('gold.bars.searchPlaceholder')}
            className="w-64"
          />
          <MultiSelect
            label={t('gold.common.allOwners')}
            options={owners}
            value={companies}
            onChange={(values) => {
              patch({ company: writeList(values) });
            }}
          />
          <MultiSelect
            label={t('gold.common.allMetals')}
            options={metalOptions(t)}
            value={metals}
            onChange={(values) => {
              patch({ metal: writeList(values) });
            }}
          />
          <MultiSelect
            label={t('gold.common.allPurities')}
            options={(facets.data?.purities ?? []).map((p) => ({ value: p, label: p }))}
            value={purities}
            onChange={(values) => {
              patch({ purity: writeList(values) });
            }}
          />
          <MultiSelect
            label={t('gold.common.allStatuses')}
            options={[
              { value: 'in_vault', label: barStatusLabel(t, 'in_vault') },
              { value: 'delivered', label: barStatusLabel(t, 'delivered') },
              { value: 'transferred', label: barStatusLabel(t, 'transferred') },
            ]}
            value={statuses}
            onChange={(values) => {
              patch({ status: writeList(values) });
            }}
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(b) => b.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          empty={t('gold.bars.empty')}
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

      {historyId !== null && (
        <HistoryDialog
          barId={historyId}
          onClose={() => {
            setHistoryId(null);
          }}
        />
      )}
      {editing !== null && (
        <EditDialog
          bar={editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </PageContainer>
  );
};
