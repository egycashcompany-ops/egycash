// The makes (الماركة) — every vehicle type with its maintenance rule. One table, two doors: the
// Fleet settings page, where the rule was first kept, and the Fleet lists («عاوز اضيف الماركه فى
// قوائم الحركه … سيبها في المكانين»), beside the other vocabularies the registry points at.
import { useState } from 'react';
import { type FleetVehicleTypeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { StatusBadge } from '../../../shared/ui/Badge';
import { EditIcon } from '../../../shared/ui/icons';
import { formatNumber } from '../../../shared/lib/format';
import { useVehicleTypes } from '../api/fleet-queries';
import { VehicleTypeDialog } from './CatalogDialogs';

const actionButton =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

/** Who may add or change a make — the maintenance rule rides on it. */
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
  const types = useVehicleTypes({ pageSize: 100, sortBy: 'name.ar', sortDir: 'asc' });
  const [editing, setEditing] = useState<FleetVehicleTypeDto | null>(null);

  const columns: Column<FleetVehicleTypeDto>[] = [
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
    ...(can(MAKES_PERMISSION)
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'end',
            render: (r: FleetVehicleTypeDto) => (
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
            ),
          } satisfies Column<FleetVehicleTypeDto>,
        ]
      : []),
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={types.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={types.isLoading}
        error={types.isError ? types.error : undefined}
        onRetry={() => void types.refetch()}
      />
      <VehicleTypeDialog open={creating} onClose={onCloseCreate} type={null} />
      <VehicleTypeDialog open={editing !== null} onClose={() => setEditing(null)} type={editing} />
    </>
  );
};
