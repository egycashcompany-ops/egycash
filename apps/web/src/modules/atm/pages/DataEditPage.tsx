// /atm/data-edit — the legacy /data_edit_atm page (data_edit_atm.ejs, contad_app.js:2356-2544),
// rebuilt in the fleet-catalogs shape (fleet/pages/CatalogsPage.tsx) at the owner's request: the
// things this page administers are URL-synced tabs, each a live table with a status filter, and
// entry is a dialog per item rather than a wall of textareas.
//
// FOUR TABS (DEC-35, DEC-38), one table each in the board frame:
//   · «الماكينات» — the Operations machine master;
//   · «البنوك» — the company-wide bank CATALOG. The owner's call (final): a bank added here is a
//     full register bank (register, Data Report, settlements, map). Kept by Efficiency and the
//     administrators (`atmBank.create` / `atmBank.edit`, organization scope on the server);
//   · «أسماء البنوك في التشغيل» — this branch's SPELLINGS of catalog banks (`NBE FOREX` → NBE, a
//     legacy text …): what Operations type on a machine, each linked to the bank it means. Above
//     the table, the bank texts machines already carry that link to no bank, each one click away
//     from being linked — until it is, such a machine is added but not recorded in the register;
//   · «المناطق» — the areas, with their Arabic and English names. The owner: «الإنجليزي تمام» — a
//     new area's English name is what machines store; both are what the pickers show.
//
// WHO MAY DO WHAT (D2, docs/12-planning/atm-efficiency-register.md §8.4). Whether a machine EXISTS
// is decided by the Efficiency register: a receipt from the bank creates it, a handover archives
// it. This stays Operations' page, minus the actions that decide existence:
//   · Operations (`atmRefLabel.create`, `atmRefLabel.edit`, `atmMachine.moveArea`) add a spelling
//     or an area, rename one or toggle its archive, and move a machine to another area. Apart from
//     that move, the machines tab is read-only to them. Nobody deletes a label from this page.
//   · `atmMachine.manage` keeps everything it had: add a machine, the bulk add and delete-by-codes,
//     the full edit (name, bank, area, archive) and the row delete. An add now also records an
//     OPEN, linked receipt in the register flagged «بيانات ناقصة» (DEC-36, the owner's call).
// Each control checks its own key. The server enforces the same split (§7.1); hiding a control
// only spares a click that would be refused.
//
// Nothing the legacy could do was dropped in the move:
//   · bulk add (code+name line pairs, one bank and one area for the batch) and delete-by-codes
//     (soft + `-D` rename) live in the bulk dialog, reached from the machines tab;
//   · "نقل ماكينة لمنطقة" (:2529-2541) is Operations' area-move dialog on each row, and `manage`
//     changes the area inside the full edit as before. Both work on a machine you can see rather
//     than one you must name;
//   · the bank and area lists (:2471-2527) are tabs.
//
// What the legacy could NOT do and this can: fix one machine's name or bank, and ARCHIVE a
// machine or a label instead of deleting it (`isActive`) — the row leaves the forms and the mail
// matcher, which read active only, while its code stays taken and its history stays readable.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  type AtmBankDto,
  type AtmMachineDto,
  type AtmRefLabelDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useAppSelector } from '../../../store';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Badge, StatusBadge } from '../../../shared/ui/Badge';
import { Input, Select } from '../../../shared/ui/form';
import { EditIcon, PinIcon, PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useAtmBanks,
  useAtmMachines,
  useAtmRefLabelOptions,
  useAtmRefLabels,
  useBulkDeleteAtmMachines,
} from '../api/atm-queries';
import {
  BulkMachinesDialog,
  MachineAreaDialog,
  MachineDialog,
  RefLabelDialog,
} from '../components/DataEditDialogs';
import { BankDialog } from '../components/catalog/BankDialog';
import { bankCatalogColumns } from '../components/catalog/BankCatalogDialog';
import { ConfirmActionDialog } from '../components/ReplenishmentDialogs';
import { makeBankLookup, sortByCatalogOrder } from '../lib/bank-catalog';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['active', 'q', 'sort', 'size'] as const;

/**
 * The four things this page administers: the machines, the bank catalog, this branch's Operations
 * spellings of its banks, and the areas.
 */
export const ATM_DATA_TABS = ['machines', 'bank', 'bankLabel', 'area'] as const;
export type AtmDataTab = (typeof ATM_DATA_TABS)[number];

const DEFAULT_PAGE_SIZE = 25;

const isTab = (value: string | null): value is AtmDataTab =>
  (ATM_DATA_TABS as readonly string[]).includes(value ?? '');

const actionButton =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

/** Where an area label came from, as its badge says it — none for one typed on this page. */
const originBadgeKey = (origin: AtmRefLabelDto['origin']): string | null =>
  origin === 'manual'
    ? null
    : origin === 'backfill'
      ? 'atm.dataEdit.origin.backfill'
      : 'atm.dataEdit.origin.auto';

export const DataEditPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The D2 split. Each control below reads the flag for its own key, and `manage` still passes
  // every check it passed before.
  const canManage = can('atmMachine.manage');
  const canMoveArea = can('atmMachine.moveArea');
  const canAddLabels = canManage || can('atmRefLabel.create');
  const canEditLabels = canManage || can('atmRefLabel.edit');
  // The catalog is Efficiency's and the administrators' (DEC-39); the server also wants both keys
  // at organization scope, so a branch-scoped holder sees the buttons and gets a 403's words.
  const canAddBank = can('atmBank.create');
  const canEditBank = can('atmBank.edit');
  const [sp, setSp] = useSearchParams();

  const tabParam = sp.get('tab');
  const tab: AtmDataTab = isTab(tabParam) ? tabParam : 'machines';
  const labelTab = tab === 'bankLabel' || tab === 'area';
  const labelKind = tab === 'area' ? 'area' : 'bank';
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

  // The ONE branch the label tabs are about — the acting branch, the one their add and the
  // callout already use (design §3.6, critic gap 2). Sent as the list's `branchId`, so a user whose
  // key reaches several branches no longer sees every branch's same-named rows mixed in one table,
  // and «ربط ببنك» can never land on another branch's row (review finding). The list waits for it
  // rather than loading unscoped first. When the options cannot answer — an unplaced administrator
  // in the «all» view, a key that reaches no whole branch — the list falls back to today's unscoped
  // read, and the notice above it says why it is not one branch.
  const options = useAtmRefLabelOptions(null, labelTab);
  const actingBranch = options.data?.branchId;
  const labelParams = useMemo(
    () => (actingBranch === undefined ? listParams : { ...listParams, branchId: actingBranch }),
    [listParams, actingBranch],
  );

  const machines = useAtmMachines(listParams, tab === 'machines');
  const labels = useAtmRefLabels(
    labelKind,
    labelParams,
    labelTab && (options.data !== undefined || options.isError),
  );
  // The catalog is read whole (fewer than fifty banks): the bank tab's table, and the name the
  // spellings tab shows for each spelling's bank.
  const catalog = useAtmBanks();
  const lookup = useMemo(() => makeBankLookup(catalog.data), [catalog.data]);
  const bankRows = useMemo(
    () =>
      sortByCatalogOrder(catalog.data ?? []).filter(
        (bank) => active === '' || bank.isActive === (active === 'true'),
      ),
    [catalog.data, active],
  );
  // The acting branch's bank texts that link to no bank — the spellings tab's callout — each with
  // the row of this branch that already holds it, if any (`unmappedBankLabels`).
  const unmapped = options.data?.unmappedBankLabels ?? [];

  const [creating, setCreating] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingMachine, setEditingMachine] = useState<AtmMachineDto | null>(null);
  const [movingMachine, setMovingMachine] = useState<AtmMachineDto | null>(null);
  const [editingLabel, setEditingLabel] = useState<AtmRefLabelDto | null>(null);
  /** The edit was opened from the callout: the save also brings the row back from the archive. */
  const [activating, setActivating] = useState(false);
  const [editingBank, setEditingBank] = useState<AtmBankDto | null>(null);
  /** «ربط ببنك» on a text no spelling holds yet: a new spelling, its text filled in. */
  const [linking, setLinking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AtmMachineDto | null>(null);
  const bulkDelete = useBulkDeleteAtmMachines();

  /**
   * «ربط ببنك» for one unmapped text. The server names the row of THIS branch that already holds
   * the text — a legacy row the backfill could not link, or an ARCHIVED spelling (an archived
   * `NBE FOREX` is exactly what makes its text read unmapped) — and that row is EDITED, opened
   * active, so one save links it and brings it back; adding it again would be refused as a
   * duplicate, since the unique name index still holds an archived row. Otherwise a new spelling
   * is added with the text filled in. Never a row picked out of the table: that is one page, under
   * the status filter, and for a user reaching several branches it was once another branch's
   * same-named row (review finding).
   */
  const linkToBank = (entry: (typeof unmapped)[number]): void => {
    if (entry.label === null) {
      setLinking(entry.name);
      return;
    }
    setActivating(true);
    setEditingLabel(entry.label);
  };
  const canLink = (entry: (typeof unmapped)[number]): boolean =>
    entry.label === null ? canAddLabels : canEditLabels;

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

  const editLabelColumn: Column<AtmRefLabelDto>[] = canEditLabels
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
              data-edit-action="edit-label"
              onClick={() => {
                setActivating(false);
                setEditingLabel(r);
              }}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          ),
        } satisfies Column<AtmRefLabelDto>,
      ]
    : [];

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
    ...(canManage || canMoveArea
      ? [
          {
            key: 'actions',
            header: t('atm.dataEdit.actions'),
            align: 'end',
            render: (r: AtmMachineDto) => (
              <div className="flex justify-end gap-1">
                {canManage ? (
                  <button
                    type="button"
                    className={actionButton}
                    aria-label={t('atm.dataEdit.editMachine')}
                    title={t('atm.dataEdit.editMachine')}
                    data-edit-action="edit-machine"
                    onClick={() => setEditingMachine(r)}
                  >
                    <EditIcon className="h-4 w-4" />
                  </button>
                ) : (
                  // Operations: the area alone. `manage` changes it inside the full edit instead.
                  <button
                    type="button"
                    className={actionButton}
                    aria-label={t('atm.dataEdit.moveArea')}
                    title={t('atm.dataEdit.moveArea')}
                    data-edit-action="move-area"
                    onClick={() => setMovingMachine(r)}
                  >
                    <PinIcon className="h-4 w-4" />
                  </button>
                )}
                {/* Archive (the edit dialog's `isActive`) keeps the code taken; DELETE is the
                    legacy action that frees it, via the `-D` rename (contad_app.js:2494-2508).
                    Both decide whether the machine exists, so both stay `manage` only (D2). */}
                {canManage && (
                  <button
                    type="button"
                    className={actionButton}
                    aria-label={t('atm.dataEdit.deleteMachine')}
                    title={t('atm.dataEdit.deleteMachine')}
                    data-edit-action="delete-machine"
                    onClick={() => setDeleting(r)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            ),
          } satisfies Column<AtmMachineDto>,
        ]
      : []),
  ];

  // The register's «البنوك» dialog shows the same table (`bankCatalogColumns`).
  const bankColumns = bankCatalogColumns({ t, onEdit: canEditBank ? setEditingBank : undefined });

  const spellingColumns: Column<AtmRefLabelDto>[] = [
    {
      key: 'name',
      header: t('atm.dataEdit.labelName'),
      sortable: true,
      render: (r) => <span dir="ltr">{r.name}</span>,
    },
    {
      key: 'bankCode',
      header: t('atm.common.bank'),
      render: (r) =>
        r.bankCode === null ? (
          <Badge tone="warning" size="sm">
            {t('atm.dataEdit.notLinked')}
          </Badge>
        ) : (
          lookup.name(r.bankCode, locale)
        ),
    },
    statusColumn<AtmRefLabelDto>(),
    ...editLabelColumn,
  ];

  const areaColumns: Column<AtmRefLabelDto>[] = [
    { key: 'name', header: t('atm.dataEdit.storedName'), sortable: true, render: (r) => r.name },
    { key: 'nameAr', header: t('atm.dataEdit.nameAr'), render: (r) => r.nameAr ?? '—' },
    {
      key: 'nameEn',
      header: t('atm.dataEdit.nameEn'),
      render: (r) => (r.nameEn === null ? '—' : <span dir="ltr">{r.nameEn}</span>),
    },
    {
      key: 'origin',
      header: t('atm.dataEdit.origin.title'),
      render: (r) => {
        const key = originBadgeKey(r.origin);
        return key === null ? null : (
          <Badge tone={r.origin === 'backfill' ? 'neutral' : 'info'} size="sm">
            {t(key)}
          </Badge>
        );
      },
    },
    statusColumn<AtmRefLabelDto>(),
    ...editLabelColumn,
  ];

  const paged = tab === 'machines' ? machines : labelTab ? labels : null;

  return (
    <PageContainer fullHeight>
      {/* The board frame (`shared/ui/board-scroll.ts`, 2026-10-27 «تثبت الفورم والفلتر وتخلي الجدول
          بس هو اللى يعمل Scroll»): on a computer the title, the tabs and the filters keep their
          place, the pager keeps its place below, and only the table's rows scroll, under a head
          that stays. */}
      <div className={BOARD_FRAME}>
        <PageHeader
          title={t('atm.dataEdit.title')}
          breadcrumbs={[
            { label: t('atm.overview.title'), to: '/atm' },
            { label: t('atm.dataEdit.title') },
          ]}
          actions={
            tab === 'machines' ? (
              <Can permission="atmMachine.manage">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    data-edit-action="bulk"
                    onClick={() => setBulkOpen(true)}
                  >
                    {t('atm.dataEdit.bulkTitle')}
                  </Button>
                  <Button
                    size="sm"
                    leftIcon={<PlusIcon className="h-4 w-4" />}
                    data-edit-action="add-machine"
                    onClick={() => setCreating(true)}
                  >
                    {t('atm.dataEdit.addMachine')}
                  </Button>
                </div>
              </Can>
            ) : tab === 'bank' ? (
              <Can permission="atmBank.create">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    leftIcon={<PlusIcon className="h-4 w-4" />}
                    data-edit-action="add-bank"
                    onClick={() => setCreating(true)}
                  >
                    {t('atm.bankCatalog.add')}
                  </Button>
                </div>
              </Can>
            ) : (
              <Can anyOf={['atmRefLabel.create', 'atmMachine.manage']}>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    leftIcon={<PlusIcon className="h-4 w-4" />}
                    data-edit-action="add-label"
                    onClick={() => setCreating(true)}
                  >
                    {t(tab === 'bankLabel' ? 'atm.dataEdit.addSpelling' : 'atm.dataEdit.addArea')}
                  </Button>
                </div>
              </Can>
            )
          }
        />

        <div
          className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
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

        {/* The options could not name one branch, so the table lists every branch the key
            reaches (the server's own reason is the add's refusal too). */}
        {labelTab && options.isError && (
          <p
            data-labels-unscoped="true"
            className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300"
          >
            {t('atm.dataEdit.labelsUnscoped')}
          </p>
        )}

        {/* The texts machines here carry that link to no bank (DEC-35): until one is linked, a
            machine added with it works for Operations but is not recorded in the register. */}
        {tab === 'bankLabel' && unmapped.length > 0 && (
          <div
            data-unmapped-callout="true"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <p className="font-medium">{t('atm.dataEdit.unmappedTitle')}</p>
            <p className="mt-1 text-xs">{t('atm.dataEdit.unmappedBody')}</p>
            <ul className="mt-2 flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {unmapped.map((entry) => (
                <li
                  key={entry.name}
                  className="flex items-center gap-2 rounded-lg bg-white/70 py-1 pe-1 ps-3 dark:bg-slate-900/60"
                >
                  <span dir="ltr" className="font-medium">
                    {entry.name}
                  </span>
                  {canLink(entry) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      data-edit-action="link-bank"
                      onClick={() => linkToBank(entry)}
                    >
                      {t('atm.dataEdit.linkToBank')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={BOARD_TABLE_FILL}>
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
              stickyHead
            />
          ) : tab === 'bank' ? (
            // The whole catalog in its order, filtered here — it has no pager to wait on.
            <DataTable
              columns={bankColumns}
              rows={bankRows}
              rowKey={(r) => r.code}
              loading={catalog.isLoading}
              error={catalog.isError ? catalog.error : undefined}
              onRetry={() => void catalog.refetch()}
              stickyHead
            />
          ) : (
            <DataTable
              columns={tab === 'area' ? areaColumns : spellingColumns}
              rows={labels.data?.items ?? []}
              rowKey={(r) => r.id}
              // A list still waiting for its branch is loading, not empty.
              loading={options.isLoading || labels.isLoading}
              error={labels.isError ? labels.error : undefined}
              onRetry={() => void labels.refetch()}
              sort={sort}
              onSortChange={changeSort}
              stickyHead
            />
          )}
        </div>

        {paged !== null && paged.data !== undefined && paged.data.meta.totalItems > 0 && (
          <Pagination
            meta={paged.data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      {/* Each dialog also checks its key. `creating` survives a tab change through Back, so
          without the check an "add bank" begun on one tab could open "add machine" on another. */}
      <MachineDialog
        open={creating && tab === 'machines' && canManage}
        onClose={() => setCreating(false)}
        machine={null}
      />
      <MachineDialog
        open={editingMachine !== null && canManage}
        onClose={() => setEditingMachine(null)}
        machine={editingMachine}
      />
      <MachineAreaDialog
        open={movingMachine !== null && canMoveArea}
        onClose={() => setMovingMachine(null)}
        machine={movingMachine}
      />
      <BankDialog
        open={creating && tab === 'bank' && canAddBank}
        onClose={() => setCreating(false)}
        bank={null}
      />
      <BankDialog
        open={editingBank !== null && canEditBank}
        onClose={() => setEditingBank(null)}
        bank={editingBank}
      />
      <RefLabelDialog
        open={((creating && labelTab) || linking !== null) && canAddLabels}
        onClose={() => {
          setCreating(false);
          setLinking(null);
        }}
        kind={labelKind}
        label={null}
        presetName={linking ?? ''}
      />
      <RefLabelDialog
        open={editingLabel !== null && canEditLabels}
        onClose={() => {
          setEditingLabel(null);
          setActivating(false);
        }}
        kind={labelKind}
        label={editingLabel}
        activate={activating}
      />
      <BulkMachinesDialog open={bulkOpen && canManage} onClose={() => setBulkOpen(false)} />
      <ConfirmActionDialog
        open={deleting !== null && canManage}
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
