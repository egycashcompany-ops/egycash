// /atm/data-edit — the legacy /data_edit_atm page (data_edit_atm.ejs, contad_app.js:2356-2544),
// rebuilt in the fleet-catalogs shape (fleet/pages/CatalogsPage.tsx) at the owner's request: the
// three things this page administers are URL-synced tabs, each a live paginated table with a
// status filter, and entry is a dialog per item rather than a wall of textareas.
//
// Nothing the legacy could do was dropped in the move:
//   · bulk add (code+name line pairs, one bank and one area for the batch) and delete-by-codes
//     (soft + `-D` rename) live in the bulk dialog, reached from the machines tab;
//   · "نقل ماكينة لمنطقة" (:2529-2541) is now just editing the machine's area — same effect,
//     one fewer form, and it works on a machine you can see rather than one you must name;
//   · the bank and area lists (:2471-2527) are two of the tabs.
//
// What the legacy could NOT do and this can: fix one machine's name or bank, and ARCHIVE a
// machine or a label instead of deleting it (`isActive`) — the row leaves the forms and the mail
// matcher, which read active only, while its code stays taken and its history stays readable.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MAX_PAGE_SIZE, type AtmMachineDto, type AtmRefLabelDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Input, Select } from '../../../shared/ui/form';
import { EditIcon, PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAtmMachines, useAtmRefLabels, useBulkDeleteAtmMachines } from '../api/atm-queries';
import { BulkMachinesDialog, MachineDialog, RefLabelDialog } from '../components/DataEditDialogs';
import { ConfirmActionDialog } from '../components/ReplenishmentDialogs';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'active',
  'q',
  'sort',
  'size',
] as const;

/** The three things this page administers, in the order the legacy page presented them. */
export const ATM_DATA_TABS = ['machines', 'bank', 'area'] as const;
export type AtmDataTab = (typeof ATM_DATA_TABS)[number];

const DEFAULT_PAGE_SIZE = 25;

const isTab = (value: string | null): value is AtmDataTab =>
  (ATM_DATA_TABS as readonly string[]).includes(value ?? '');

const actionButton =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

export const DataEditPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [sp, setSp] = useSearchParams();

  const tabParam = sp.get('tab');
  const tab: AtmDataTab = isTab(tabParam) ? tabParam : 'machines';
  // Each tab filters a different catalogue, so each keeps its own memory; the tab is not a filter.
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS, '', tab);
  const active = sp.get('active') ?? '';
  const search = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (
    sp.get('sort') ?? (tab === 'machines' ? 'machineCode:asc' : 'name:asc')
  ).split(':');
  const sort = {
    by: sortByRaw ?? (tab === 'machines' ? 'machineCode' : 'name'),
    dir: sortDirRaw === 'desc' ? 'desc' : 'asc',
  } as { by: string; dir: 'asc' | 'desc' };
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

  const listParams = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      isActive: active === '' ? undefined : active === 'true',
      ...(tab === 'machines' && search !== '' ? { search } : {}),
    }),
    [paramsKey, tab],
  );

  const machines = useAtmMachines(listParams, tab === 'machines');
  const labels = useAtmRefLabels(tab === 'area' ? 'area' : 'bank', listParams, tab !== 'machines');

  // Both dialogs pick from the full ACTIVE lists, not the current page of a filtered table.
  const bankOptions = useAtmRefLabels('bank', {
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'name',
    sortDir: 'asc',
    isActive: true,
  });
  const areaOptions = useAtmRefLabels('area', {
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'name',
    sortDir: 'asc',
    isActive: true,
  });
  const banks = bankOptions.data?.items ?? [];
  const areas = areaOptions.data?.items ?? [];

  const [creating, setCreating] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingMachine, setEditingMachine] = useState<AtmMachineDto | null>(null);
  const [editingLabel, setEditingLabel] = useState<AtmRefLabelDto | null>(null);
  const [deleting, setDeleting] = useState<AtmMachineDto | null>(null);
  const bulkDelete = useBulkDeleteAtmMachines();

  const statusColumn = <T extends { isActive: boolean }>(): Column<T> => ({
    key: 'status',
    header: t('atm.dataEdit.status'),
    render: (r) => (
      <StatusBadge
        tone={r.isActive ? 'success' : 'neutral'}
        label={r.isActive ? t('atm.dataEdit.active') : t('atm.dataEdit.archived')}
      />
    ),
  });

  const machineColumns: Column<AtmMachineDto>[] = [
    {
      key: 'machineCode',
      header: t('atm.common.machineId'),
      sortable: true,
      render: (r) => <span dir="ltr">{r.machineCode}</span>,
    },
    { key: 'name', header: t('atm.dataEdit.machineName'), sortable: true, render: (r) => r.name },
    { key: 'bankName', header: t('atm.common.bank'), sortable: true, render: (r) => r.bankName },
    { key: 'area', header: t('atm.common.area'), sortable: true, render: (r) => r.area },
    statusColumn<AtmMachineDto>(),
    ...(can('atmMachine.manage')
      ? [
          {
            key: 'actions',
            header: t('atm.dataEdit.actions'),
            align: 'end',
            render: (r: AtmMachineDto) => (
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  className={actionButton}
                  aria-label={t('atm.dataEdit.editMachine')}
                  title={t('atm.dataEdit.editMachine')}
                  onClick={() => setEditingMachine(r)}
                >
                  <EditIcon className="h-4 w-4" />
                </button>
                {/* Archive (the edit dialog's `isActive`) keeps the code taken; DELETE is the
                    legacy action that frees it, via the `-D` rename (contad_app.js:2494-2508). */}
                <button
                  type="button"
                  className={actionButton}
                  aria-label={t('atm.dataEdit.deleteMachine')}
                  title={t('atm.dataEdit.deleteMachine')}
                  onClick={() => setDeleting(r)}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies Column<AtmMachineDto>,
        ]
      : []),
  ];

  const labelColumns: Column<AtmRefLabelDto>[] = [
    { key: 'name', header: t('atm.dataEdit.labelName'), sortable: true, render: (r) => r.name },
    statusColumn<AtmRefLabelDto>(),
    ...(can('atmMachine.manage')
      ? [
          {
            key: 'actions',
            header: t('atm.dataEdit.actions'),
            align: 'end',
            render: (r: AtmRefLabelDto) => (
              <button
                type="button"
                className={actionButton}
                aria-label={t('atm.common.edit')}
                title={t('atm.common.edit')}
                onClick={() => setEditingLabel(r)}
              >
                <EditIcon className="h-4 w-4" />
              </button>
            ),
          } satisfies Column<AtmRefLabelDto>,
        ]
      : []),
  ];

  const query = tab === 'machines' ? machines : labels;
  const addLabel =
    tab === 'machines'
      ? t('atm.dataEdit.addMachine')
      : t(tab === 'bank' ? 'atm.dataEdit.addBank' : 'atm.dataEdit.addArea');

  return (
    <PageContainer>
      <PageHeader
        title={t('atm.dataEdit.title')}
        description={t('atm.dataEdit.subtitle')}
        breadcrumbs={[
          { label: t('atm.overview.title'), to: '/atm' },
          { label: t('atm.dataEdit.title') },
        ]}
        actions={
          <Can permission="atmMachine.manage">
            <div className="flex gap-2">
              {tab === 'machines' && (
                <Button size="sm" variant="secondary" onClick={() => setBulkOpen(true)}>
                  {t('atm.dataEdit.bulkTitle')}
                </Button>
              )}
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setCreating(true)}
              >
                {addLabel}
              </Button>
            </div>
          </Can>
        }
      />

      <div
        className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
        role="tablist"
      >
        {ATM_DATA_TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            type="button"
            onClick={() => patch({ tab: key === 'machines' ? null : key, sort: null, q: null })}
            className={`rounded-t-lg px-4 py-2 text-sm ${
              tab === key
                ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(`atm.dataEdit.tab.${key}`)}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={active !== '' || search !== ''}
          onClear={() => patch({ active: null, q: null })}
        >
          {tab === 'machines' && (
            <Input
              aria-label={t('atm.dataEdit.searchMachines')}
              placeholder={t('atm.dataEdit.searchMachines')}
              defaultValue={search}
              onBlur={(e) => patch({ q: e.target.value || null })}
              className="w-auto"
            />
          )}
          <Select
            aria-label={t('atm.dataEdit.status')}
            value={active}
            onChange={(e) => patch({ active: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('atm.dataEdit.allStatuses')}</option>
            <option value="true">{t('atm.dataEdit.active')}</option>
            <option value="false">{t('atm.dataEdit.archived')}</option>
          </Select>
        </FilterBar>

        {tab === 'machines' ? (
          <DataTable
            columns={machineColumns}
            rows={machines.data?.items ?? []}
            rowKey={(r) => r.id}
            loading={machines.isLoading}
            error={machines.isError ? machines.error : undefined}
            onRetry={() => void machines.refetch()}
            sort={sort}
            onSortChange={changeSort}
          />
        ) : (
          <DataTable
            columns={labelColumns}
            rows={labels.data?.items ?? []}
            rowKey={(r) => r.id}
            loading={labels.isLoading}
            error={labels.isError ? labels.error : undefined}
            onRetry={() => void labels.refetch()}
            sort={sort}
            onSortChange={changeSort}
          />
        )}

        {query.data !== undefined && query.data.meta.totalItems > 0 && (
          <Pagination
            meta={query.data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <MachineDialog
        open={creating && tab === 'machines'}
        onClose={() => setCreating(false)}
        machine={null}
        banks={banks}
        areas={areas}
      />
      <MachineDialog
        open={editingMachine !== null}
        onClose={() => setEditingMachine(null)}
        machine={editingMachine}
        banks={banks}
        areas={areas}
      />
      <RefLabelDialog
        open={creating && tab !== 'machines'}
        onClose={() => setCreating(false)}
        kind={tab === 'area' ? 'area' : 'bank'}
        label={null}
      />
      <RefLabelDialog
        open={editingLabel !== null}
        onClose={() => setEditingLabel(null)}
        kind={tab === 'area' ? 'area' : 'bank'}
        label={editingLabel}
      />
      <BulkMachinesDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        banks={banks}
        areas={areas}
      />
      <ConfirmActionDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('atm.dataEdit.deleteMachine')}
        body={t('atm.dataEdit.deleteMachineBody', { code: deleting?.machineCode ?? '' })}
        confirmLabel={t('atm.common.delete')}
        danger
        busy={bulkDelete.isPending}
        onConfirm={() => {
          const code = deleting?.machineCode;
          if (code === undefined) return;
          void bulkDelete
            .mutateAsync({ machineCodes: [code] })
            .then(() => {
              toast.success(t('atm.dataEdit.machinesDeleted', { count: 1 }));
              setDeleting(null);
            })
            .catch(() => toast.error(t('atm.common.actionFailed')));
        }}
      />
    </PageContainer>
  );
};
