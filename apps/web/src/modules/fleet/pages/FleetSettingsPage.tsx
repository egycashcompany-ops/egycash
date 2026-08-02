// Fleet settings (FW-10): the two rule surfaces §2.2/§13 left to administrators, with NOTHING
// hardcoded — every current value arrives from the server's setting resolution and every
// default lives in the backend registry. Section 1 is the vehicle-type table, because the
// §2.2 maintenance interval ON the type IS the maintenance rule (the route rides
// `fleetMaintenanceRule.manage` for exactly that reason). Section 2 edits the five fleet
// platform settings through the platform's own endpoints: values from GET /settings/me
// (resolved user → branch → organization → default), writes behind `setting.edit` at
// organization scope; alarm thresholds re-colour the server's alarm projection and the
// HR-leave switch changes availability verdicts, so saving invalidates those subtrees.
import { useEffect, useState } from 'react';
import {
  FleetSettingKeys,
  type FleetVehicleTypeDto,
  type Locale,
  type ResolvedSettingDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Checkbox, Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { formatNumber } from '../../../shared/lib/format';
import { useMySettings } from '../../../platform/settings/settings-api';
import { useSetFleetSetting, useVehicleTypes } from '../api/fleet-queries';
import { VehicleTypeDialog } from '../components/CatalogDialogs';

/** The module's §13 defaults surface — labels only; VALUES always come from the resolver. */
const NUMBER_KEYS = [
  FleetSettingKeys.AlarmYellowKm,
  FleetSettingKeys.AlarmRedKm,
  FleetSettingKeys.VehicleLicenseWarnDays,
  FleetSettingKeys.DriverLicenseWarnDays,
] as const;

const SETTING_LABELS: Record<string, string> = {
  [FleetSettingKeys.AlarmYellowKm]: 'fleet.settings.keys.alarmYellowKm',
  [FleetSettingKeys.AlarmRedKm]: 'fleet.settings.keys.alarmRedKm',
  [FleetSettingKeys.UseHrLeave]: 'fleet.settings.keys.useHrLeave',
  [FleetSettingKeys.VehicleLicenseWarnDays]: 'fleet.settings.keys.vehicleLicenseWarnDays',
  [FleetSettingKeys.DriverLicenseWarnDays]: 'fleet.settings.keys.driverLicenseWarnDays',
};

const FleetSettingsCard = ({ resolved }: { resolved: ResolvedSettingDto[] }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const canEdit = can('setting.edit');
  const setSetting = useSetFleetSetting();

  const valueOf = (key: string): unknown => resolved.find((s) => s.key === key)?.value;
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [useHrLeave, setUseHrLeave] = useState(false);
  useEffect(() => {
    setNumbers(Object.fromEntries(NUMBER_KEYS.map((key) => [key, String(valueOf(key) ?? '')])));
    setUseHrLeave(valueOf(FleetSettingKeys.UseHrLeave) === true);
  }, [resolved]);

  const dirty = (key: string): boolean =>
    key === FleetSettingKeys.UseHrLeave
      ? useHrLeave !== (valueOf(key) === true)
      : numbers[key] !== String(valueOf(key) ?? '');
  const anyDirty = Object.keys(SETTING_LABELS).some(dirty);
  const valid = NUMBER_KEYS.every(
    (key) => Number.isInteger(Number(numbers[key])) && Number(numbers[key]) >= 0,
  );

  const save = async (): Promise<void> => {
    // Organization scope — one write per changed key; the server audits each.
    for (const key of NUMBER_KEYS) {
      if (dirty(key))
        await setSetting.mutateAsync({ key, scope: 'organization', value: Number(numbers[key]) });
    }
    if (dirty(FleetSettingKeys.UseHrLeave))
      await setSetting.mutateAsync({
        key: FleetSettingKeys.UseHrLeave,
        scope: 'organization',
        value: useHrLeave,
      });
    toast.success(t('fleet.settings.saved'));
  };

  return (
    <Card>
      <CardHeader
        title={t('fleet.settings.valuesTitle')}
        description={canEdit ? t('fleet.settings.valuesHint') : t('fleet.settings.readOnlyHint')}
      />
      <CardBody>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {NUMBER_KEYS.map((key) => (
              <Field key={key} label={t(SETTING_LABELS[key] ?? key)}>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={numbers[key] ?? ''}
                  onChange={(e) => setNumbers((prev) => ({ ...prev, [key]: e.target.value }))}
                  disabled={!canEdit}
                  dir="ltr"
                />
              </Field>
            ))}
          </div>
          <Checkbox
            label={t(SETTING_LABELS[FleetSettingKeys.UseHrLeave] ?? FleetSettingKeys.UseHrLeave)}
            checked={useHrLeave}
            onChange={(e) => setUseHrLeave(e.target.checked)}
            disabled={!canEdit}
          />
          {canEdit && (
            <div className="flex justify-end">
              <Button
                loading={setSetting.isPending}
                disabled={!anyDirty || !valid}
                onClick={() => void save()}
              >
                {t('common.save')}
              </Button>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
};

export const FleetSettingsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const types = useVehicleTypes({ pageSize: 100, sortBy: 'name.ar', sortDir: 'asc' });
  const settings = useMySettings();
  const fleetSettings = (settings.data ?? []).filter((s) => s.key.startsWith('fleet.'));

  const [creatingType, setCreatingType] = useState(false);
  const [editingType, setEditingType] = useState<FleetVehicleTypeDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const typeColumns: Column<FleetVehicleTypeDto>[] = [
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
    ...(can('fleetMaintenanceRule.manage')
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'end',
            render: (r: FleetVehicleTypeDto) => (
              <button
                type="button"
                className={actionButton}
                aria-label={t('fleet.settings.editType')}
                title={t('fleet.settings.editType')}
                onClick={() => setEditingType(r)}
              >
                <EditIcon className="h-4 w-4" />
              </button>
            ),
          } satisfies Column<FleetVehicleTypeDto>,
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.settings')}
        description={t('fleet.settings.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.settings') },
        ]}
      />

      <div className="space-y-6">
        <Card>
          <CardHeader
            title={t('fleet.settings.typesTitle')}
            description={t('fleet.settings.typesHint')}
            actions={
              <Can permission="fleetMaintenanceRule.manage">
                <Button
                  size="sm"
                  leftIcon={<PlusIcon className="h-4 w-4" />}
                  onClick={() => setCreatingType(true)}
                >
                  {t('fleet.settings.addType')}
                </Button>
              </Can>
            }
          />
          <DataTable
            columns={typeColumns}
            rows={types.data?.items ?? []}
            rowKey={(r) => r.id}
            loading={types.isLoading}
            error={types.isError ? types.error : undefined}
            onRetry={() => void types.refetch()}
          />
        </Card>

        {settings.data !== undefined && <FleetSettingsCard resolved={fleetSettings} />}
      </div>

      <VehicleTypeDialog open={creatingType} onClose={() => setCreatingType(false)} type={null} />
      <VehicleTypeDialog
        open={editingType !== null}
        onClose={() => setEditingType(null)}
        type={editingType}
      />
    </PageContainer>
  );
};
