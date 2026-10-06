// The makes (الماركة) — every vehicle type with its maintenance rule. One table, two doors: the
// Fleet settings page, where the rule was first kept, and the Fleet lists («عاوز اضيف الماركه فى
// قوائم الحركه … سيبها في المكانين»), beside the other vocabularies the registry points at.
//
// «قوائم الحركه اكيد هيرتب برضو الماركات»: arranged the way the lists are — drag a row onto
// another, or step it up or down — and that order is what every make picker and filter reads.
import { useEffect, useMemo, useState } from 'react';
import { type FleetVehicleTypeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { StatusBadge } from '../../../shared/ui/Badge';
import { ChevronIcon, EditIcon, GripIcon } from '../../../shared/ui/icons';
import { formatNumber } from '../../../shared/lib/format';
import { errorMessage } from '../../../shared/lib/errors';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useOrderVehicleTypes, useVehicleTypes } from '../api/fleet-queries';
import { VehicleTypeDialog } from './CatalogDialogs';

const actionButton =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

/** Who may add, change or arrange a make — the maintenance rule rides on it. */
export const MAKES_PERMISSION = 'fleetMaintenanceRule.manage';

export const VehicleTypesTable = ({
  creating,
  onCloseCreate,
}: {
  /** The add dialog — opened by the page's own button, wherever that button sits. */
  creating: boolean;
  onCloseCreate: () => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // No order asked for: the server answers in the arranged order, then by name.
  const types = useVehicleTypes();
  const saveOrder = useOrderVehicleTypes();
  const [editing, setEditing] = useState<FleetVehicleTypeDto | null>(null);
  const mayOrder = can(MAKES_PERMISSION);

  /** The order just dropped, shown at once while the save and the refetch land. */
  const [pending, setPending] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // The refetched list carries the saved order — the order held on screen lets go of it then.
  useEffect(() => setPending(null), [types.data]);
  const rows = useMemo(() => {
    const items = types.data?.items ?? [];
    if (pending === null) return items;
    const byId = new Map(items.map((item) => [item.id, item]));
    return pending.flatMap((id) => {
      const item = byId.get(id);
      return item === undefined ? [] : [item];
    });
  }, [types.data, pending]);

  const move = (fromId: string, toId: string): void => {
    if (fromId === toId) return;
    const ids = rows.map((item) => item.id);
    const from = ids.indexOf(fromId);
    const target = ids.indexOf(toId);
    if (from === -1 || target === -1) return;
    ids.splice(from, 1);
    // Dropped ON a row, it takes that row's place: above it when moving up, below it when down.
    ids.splice(from < target ? ids.indexOf(toId) + 1 : ids.indexOf(toId), 0, fromId);
    setPending(ids);
    saveOrder.mutate(
      { ids },
      {
        onSuccess: () => toast.success(t('fleet.catalogs.orderSaved')),
        onError: (failure) => {
          setPending(null);
          toast.error(errorMessage(failure, locale));
        },
      },
    );
  };
  const step = (id: string, by: -1 | 1): void => {
    const at = rows.findIndex((item) => item.id === id);
    const neighbour = rows[at + by];
    if (at !== -1 && neighbour !== undefined) move(id, neighbour.id);
  };

  const columns: Column<FleetVehicleTypeDto>[] = [
    ...(mayOrder
      ? [
          {
            key: 'drag',
            header: '',
            render: (r: FleetVehicleTypeDto) => (
              <span
                data-drag-handle={r.id}
                title={t('fleet.catalogs.dragToOrder')}
                className="inline-flex cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <GripIcon className="h-4 w-4" />
              </span>
            ),
          } satisfies Column<FleetVehicleTypeDto>,
        ]
      : []),
    { key: 'nameAr', header: t('fleet.catalogs.fields.nameAr'), render: (r) => r.name.ar },
    {
      key: 'nameEn',
      header: t('fleet.catalogs.fields.nameEn'),
      render: (r) => <span dir="ltr">{r.name.en}</span>,
    },
    {
      key: 'interval',
      header: t('fleet.settings.fields.intervalKm'),
      align: 'end',
      render: (r) =>
        r.maintenanceIntervalKm === 0 ? (
          <span className="text-slate-400">{t('fleet.settings.noRule')}</span>
        ) : (
          formatNumber(r.maintenanceIntervalKm, locale)
        ),
    },
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
            render: (r: FleetVehicleTypeDto) => {
              const at = rows.indexOf(r);
              return (
                <div className="inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    data-vehicle-type-up={r.id}
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
                    data-vehicle-type-down={r.id}
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
                    data-vehicle-type-edit={r.id}
                    className={actionButton}
                    aria-label={t('fleet.settings.editType')}
                    title={t('fleet.settings.editType')}
                    onClick={() => setEditing(r)}
                  >
                    <EditIcon className="h-4 w-4" />
                  </button>
                </div>
              );
            },
          } satisfies Column<FleetVehicleTypeDto>,
        ]
      : []),
  ];

  return (
    <>
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
        loading={types.isLoading}
        error={types.isError ? types.error : undefined}
        onRetry={() => void types.refetch()}
      />
      <VehicleTypeDialog open={creating} onClose={onCloseCreate} type={null} />
      <VehicleTypeDialog open={editing !== null} onClose={() => setEditing(null)} type={editing} />
    </>
  );
};
