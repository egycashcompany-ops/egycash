// Fleet catalogs (FW-10, §2.10): the six catalog kinds as URL-synced tabs, each the live list
// straight from the API — the same rows every fleet form's select reads, managed here behind
// `fleetCatalog.manage`. Items ARCHIVE instead of delete (history references them), so the row
// action is edit only and the status column tells the truth. `countsForAlarm` renders only on
// the workType tab, exactly where the schema allows it.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FLEET_CATALOG_KINDS,
  type FleetCatalogItemDto,
  type FleetCatalogKind,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Button } from '../../../shared/ui/Button';
import { Badge, StatusBadge } from '../../../shared/ui/Badge';
import { Select } from '../../../shared/ui/form';
import { ChevronIcon, EditIcon, GripIcon, PlusIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useFleetCatalog, useOrderCatalog } from '../api/fleet-queries';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { CatalogItemDialog } from '../components/CatalogDialogs';
import { MAKES_PERMISSION, VehicleTypesTable } from '../components/VehicleTypesTable';
import { errorMessage } from '../../../shared/lib/errors';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
// NOT `sort`: this list has no column order to remember — it IS its own order. A sort kept from an
// earlier visit is what switched the drag off without the reader knowing why.
const REMEMBERED_FILTERS = ['active'] as const;

const isKind = (value: string | null): value is FleetCatalogKind =>
  (FLEET_CATALOG_KINDS as readonly string[]).includes(value ?? '');

/** The makes' tab — not a catalog kind, so it has a key of its own in `?kind=`. */
const MAKES_TAB = 'make';
/** The tabs in their order: the makes beside the registry's other vocabularies. */
const TABS: readonly (FleetCatalogKind | typeof MAKES_TAB)[] = FLEET_CATALOG_KINDS.flatMap((k) =>
  k === 'licenseClass' ? [MAKES_TAB, k] : [k],
);

export const CatalogsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const kindParam = sp.get('kind');
  const kind: FleetCatalogKind = isKind(kindParam) ? kindParam : 'workshop';
  // «عاوز اضيف الماركه فى قوائم الحركه»: the makes sit among the lists as a tab of their own. They
  // are vehicle types (each carries its maintenance rule), not catalog items, so the tab shows the
  // same table the Fleet settings page has — «سيبها في المكانين».
  const onMakes = kindParam === MAKES_TAB;
  const [creatingMake, setCreatingMake] = useState(false);
  // Leaving the tab closes its add dialog for good — the page outlives the tab, and a flag left
  // set would open the dialog again by itself on the next visit.
  useEffect(() => {
    if (!onMakes) setCreatingMake(false);
  }, [onMakes]);
  const active = sp.get('active') ?? '';
  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };
  // The WHOLE list of the kind, one page: a list cannot be dragged into order across pages, and
  // these lists are tens of entries. The same cached list every Fleet dropdown reads.
  const { data, isLoading, isError, error, refetch } = useFleetCatalog(kind);
  const saveOrder = useOrderCatalog();
  /** The order just dropped, shown at once while the save and the refetch land. */
  const [pending, setPending] = useState<{ kind: string; ids: string[] } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const all = useMemo(() => {
    const items = data?.items ?? [];
    if (pending === null || pending.kind !== kind) return items;
    const byId = new Map(items.map((item) => [item.id, item]));
    return pending.ids.flatMap((id) => {
      const item = byId.get(id);
      return item === undefined ? [] : [item];
    });
  }, [data, pending, kind]);
  const rows = useMemo(() => {
    // Always the ARRANGED order — the order the server answered in. There is no column sort on
    // this screen: «اقدر ارتبهم عن طريق الشد والترك» is the only order it has.
    return all.filter((item) => active === '' || String(item.isActive) === active);
  }, [all, active]);
  const mayOrder = can('fleetCatalog.manage');
  const move = (fromId: string, toId: string): void => {
    if (fromId === toId) return;
    const ids = all.map((item) => item.id);
    const from = ids.indexOf(fromId);
    const target = ids.indexOf(toId);
    if (from === -1 || target === -1) return;
    ids.splice(from, 1);
    // Dropped ON a row, it takes that row's place: above it when moving up, below it when down.
    ids.splice(from < target ? ids.indexOf(toId) + 1 : ids.indexOf(toId), 0, fromId);
    setPending({ kind, ids });
    saveOrder.mutate(
      { kind, ids },
      {
        onSuccess: () => toast.success(t('fleet.catalogs.orderSaved')),
        // A refused save puts the rows back and SAYS so — a row that silently snaps back reads
        // as a screen that will not let you move it.
        onError: (failure) => {
          setPending(null);
          toast.error(errorMessage(failure, locale));
        },
      },
    );
  };

  /** One step up or down among the rows ON SCREEN — the row it passes takes its old place. */
  const step = (id: string, by: -1 | 1): void => {
    const at = rows.findIndex((item) => item.id === id);
    const neighbour = rows[at + by];
    if (at !== -1 && neighbour !== undefined) move(id, neighbour.id);
  };

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FleetCatalogItemDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<FleetCatalogItemDto>[] = [
    ...(mayOrder
      ? [
          {
            key: 'drag',
            header: '',
            render: (r: FleetCatalogItemDto) => (
              <span
                data-drag-handle={r.id}
                title={t('fleet.catalogs.dragToOrder')}
                className="inline-flex cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <GripIcon className="h-4 w-4" />
              </span>
            ),
          } satisfies Column<FleetCatalogItemDto>,
        ]
      : []),
    {
      key: 'name.ar',
      header: t('fleet.catalogs.fields.nameAr'),
      render: (r) => r.name.ar,
    },
    {
      key: 'nameEn',
      header: t('fleet.catalogs.fields.nameEn'),
      render: (r) => <span dir="ltr">{r.name.en}</span>,
    },
    ...(kind === 'workType'
      ? [
          {
            key: 'countsForAlarm',
            header: t('fleet.catalogs.fields.countsForAlarm'),
            render: (r: FleetCatalogItemDto) =>
              r.countsForAlarm ? <Badge tone="info">{t('fleet.catalogs.countsBadge')}</Badge> : '—',
          } satisfies Column<FleetCatalogItemDto>,
        ]
      : []),
    {
      key: 'status',
      header: t('fleet.vehicles.columns.status'),
      render: (r) => (
        <StatusBadge
          tone={r.isActive ? 'success' : 'neutral'}
          label={r.isActive ? t('fleet.catalogs.active') : t('fleet.catalogs.archived')}
        />
      ),
    },
    ...(mayOrder
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'end',
            render: (r: FleetCatalogItemDto) => {
              const at = rows.indexOf(r);
              return (
                <div className="inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    className={`${actionButton} disabled:pointer-events-none disabled:opacity-30`}
                    aria-label={t('fleet.catalogs.moveUp')}
                    title={t('fleet.catalogs.moveUp')}
                    disabled={at <= 0}
                    onClick={() => step(r.id, -1)}
                  >
                    <ChevronIcon className="h-4 w-4 rotate-180" />
                  </button>
                  <button
                    type="button"
                    className={`${actionButton} disabled:pointer-events-none disabled:opacity-30`}
                    aria-label={t('fleet.catalogs.moveDown')}
                    title={t('fleet.catalogs.moveDown')}
                    disabled={at === rows.length - 1}
                    onClick={() => step(r.id, 1)}
                  >
                    <ChevronIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={actionButton}
                    aria-label={t('fleet.catalogs.editItem')}
                    title={t('fleet.catalogs.editItem')}
                    onClick={() => setEditing(r)}
                  >
                    <EditIcon className="h-4 w-4" />
                  </button>
                </div>
              );
            },
          } satisfies Column<FleetCatalogItemDto>,
        ]
      : []),
  ];

  return (
    <PageContainer fullHeight>
      <PageHeader
        title={t('fleet.nav.catalogs')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.catalogs') },
        ]}
        actions={
          onMakes ? (
            <Can permission={MAKES_PERMISSION}>
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setCreatingMake(true)}
              >
                {t('fleet.settings.addType')}
              </Button>
            </Can>
          ) : (
            <Can permission="fleetCatalog.manage">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setCreating(true)}
              >
                {t('fleet.catalogs.addItem', { kind: t(`fleet.catalogs.kind.${kind}`) })}
              </Button>
            </Can>
          )
        }
      />

      <div
        className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
        role="tablist"
      >
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            data-catalog-tab={k}
            aria-selected={k === MAKES_TAB ? onMakes : !onMakes && kind === k}
            type="button"
            onClick={() => patch({ kind: k === 'workshop' ? null : k })}
            className={`rounded-t-lg px-4 py-2 text-sm ${
              (k === MAKES_TAB ? onMakes : !onMakes && kind === k)
                ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {k === MAKES_TAB ? t('fleet.catalogs.makes') : t(`fleet.catalogs.kind.${k}`)}
          </button>
        ))}
      </div>

      {onMakes && (
        <div data-catalog-makes="true" className={BOARD_TABLE_FILL}>
          <VehicleTypesTable creating={creatingMake} onCloseCreate={() => setCreatingMake(false)} />
        </div>
      )}

      <div className={onMakes ? 'hidden' : BOARD_FRAME}>
        <FilterBar hasActiveFilters={active !== ''} onClear={() => patch({ active: null })}>
          <Select
            aria-label={t('fleet.vehicles.columns.status')}
            value={active}
            onChange={(e) => patch({ active: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('fleet.catalogs.allStatuses')}</option>
            <option value="true">{t('fleet.catalogs.active')}</option>
            <option value="false">{t('fleet.catalogs.archived')}</option>
          </Select>
        </FilterBar>

        <div className={BOARD_TABLE_FILL}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            rowClassName={(r) =>
              dragging === r.id
                ? 'opacity-40'
                : over === r.id && dragging !== null
                  ? 'bg-brand-50 outline outline-2 -outline-offset-2 outline-brand-400 dark:bg-brand-950/40'
                  : undefined
            }
            rowProps={(r) =>
              mayOrder
                ? {
                    draggable: true,
                    onDragStart: (e) => {
                      e.dataTransfer.setData('text/plain', r.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragging(r.id);
                    },
                    onDragEnd: () => {
                      setDragging(null);
                      setOver(null);
                    },
                    onDragOver: (e) => {
                      e.preventDefault();
                      setOver(r.id);
                    },
                    onDrop: (e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData('text/plain');
                      setDragging(null);
                      setOver(null);
                      if (id !== '') move(id, r.id);
                    },
                  }
                : undefined
            }
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            stickyHead
          />
        </div>
      </div>

      <CatalogItemDialog
        open={creating}
        onClose={() => setCreating(false)}
        kind={kind}
        item={null}
      />
      <CatalogItemDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        kind={kind}
        item={editing}
      />
    </PageContainer>
  );
};
