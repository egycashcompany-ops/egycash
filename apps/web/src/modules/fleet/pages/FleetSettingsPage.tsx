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
import { FleetSettingKeys, type ResolvedSettingDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input } from '../../../shared/ui/form';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { PlusIcon } from '../../../shared/ui/icons';
import { useMySettings } from '../../../platform/settings/settings-api';
import { useSetFleetSetting } from '../api/fleet-queries';
import { VehicleTypesTable } from '../components/VehicleTypesTable';

/** The module's §13 defaults surface — labels only; VALUES always come from the resolver. */
const NUMBER_KEYS = [
  FleetSettingKeys.AlarmYellowKm,
  FleetSettingKeys.AlarmRedKm,
  FleetSettingKeys.VehicleLicenseWarnDays,
  FleetSettingKeys.DriverLicenseWarnDays,
  FleetSettingKeys.FuelCardExpiryWarnDays,
  // R-07: the dashboard's «بلا قراءة عداد منذ N أيام» — whole days, 1 to 30 (the server's bounds).
  FleetSettingKeys.OdometerMissingReadingDays,
] as const;

/** A number setting's accepted range, where the server declares one narrower than «not below zero». */
const NUMBER_BOUNDS: Partial<Record<string, { min: number; max: number }>> = {
  [FleetSettingKeys.OdometerMissingReadingDays]: { min: 1, max: 30 },
};

/** The number settings that carry a line of explanation under the box. */
const NUMBER_HINTS: Partial<Record<string, string>> = {
  [FleetSettingKeys.OdometerMissingReadingDays]:
    'fleet.settings.keys.odometerMissingReadingDaysHint',
};

/**
 * Money settings — decimals, not counts: the four fuel prices per litre the receipts screen turns
 * an amount into litres with, and the two card-balance lines the charging screen colours by.
 */
const MONEY_KEYS = [
  FleetSettingKeys.FuelPricePetrol80,
  FleetSettingKeys.FuelPricePetrol92,
  FleetSettingKeys.FuelPricePetrol95,
  FleetSettingKeys.FuelPriceDiesel,
  FleetSettingKeys.FuelCardBalanceYellow,
  FleetSettingKeys.FuelCardBalanceRed,
] as const;

/**
 * Free-text settings: the branch NAME the new-vehicle form preselects (§2.1), and the six lines of
 * the signature block every printed Fleet report carries.
 *
 * The signatories are here because they are PEOPLE — «في إعدادات الحركة». A printed report goes up
 * for signature and into a binder, so it names who prepared it, who approves it and who endorses
 * the totals; freezing those in a print template would mean a release every time one of them was
 * promoted. The titles sit beside the names for the same reason: an office can be renamed too, and
 * a literal title beside an editable name drifts apart from it the first time that happens.
 */
const TEXT_KEYS = [
  FleetSettingKeys.DefaultBranchName,
  FleetSettingKeys.ReportPreparedByTitle,
  FleetSettingKeys.ReportPreparedByName,
  FleetSettingKeys.ReportApprovedByTitle,
  FleetSettingKeys.ReportApprovedByName,
  FleetSettingKeys.ReportEndorsementNote,
  FleetSettingKeys.ReportEndorsedByName,
] as const;

const SETTING_LABELS: Record<string, string> = {
  [FleetSettingKeys.AlarmYellowKm]: 'fleet.settings.keys.alarmYellowKm',
  [FleetSettingKeys.AlarmRedKm]: 'fleet.settings.keys.alarmRedKm',
  [FleetSettingKeys.UseHrLeave]: 'fleet.settings.keys.useHrLeave',
  [FleetSettingKeys.VehicleLicenseWarnDays]: 'fleet.settings.keys.vehicleLicenseWarnDays',
  [FleetSettingKeys.DriverLicenseWarnDays]: 'fleet.settings.keys.driverLicenseWarnDays',
  [FleetSettingKeys.DefaultBranchName]: 'fleet.settings.keys.defaultBranchName',
  [FleetSettingKeys.ReportPreparedByTitle]: 'fleet.settings.keys.reportPreparedByTitle',
  [FleetSettingKeys.ReportPreparedByName]: 'fleet.settings.keys.reportPreparedByName',
  [FleetSettingKeys.ReportApprovedByTitle]: 'fleet.settings.keys.reportApprovedByTitle',
  [FleetSettingKeys.ReportApprovedByName]: 'fleet.settings.keys.reportApprovedByName',
  [FleetSettingKeys.ReportEndorsementNote]: 'fleet.settings.keys.reportEndorsementNote',
  [FleetSettingKeys.ReportEndorsedByName]: 'fleet.settings.keys.reportEndorsedByName',
  [FleetSettingKeys.FuelPricePetrol80]: 'fleet.settings.keys.fuelPricePetrol80',
  [FleetSettingKeys.FuelPricePetrol92]: 'fleet.settings.keys.fuelPricePetrol92',
  [FleetSettingKeys.FuelPricePetrol95]: 'fleet.settings.keys.fuelPricePetrol95',
  [FleetSettingKeys.FuelPriceDiesel]: 'fleet.settings.keys.fuelPriceDiesel',
  [FleetSettingKeys.FuelCardExpiryWarnDays]: 'fleet.settings.keys.fuelCardExpiryWarnDays',
  [FleetSettingKeys.FuelCardBalanceYellow]: 'fleet.settings.keys.fuelCardBalanceYellow',
  [FleetSettingKeys.FuelCardBalanceRed]: 'fleet.settings.keys.fuelCardBalanceRed',
  [FleetSettingKeys.RosterRefuseExpiredLicence]: 'fleet.settings.keys.refuseExpiredLicence',
  [FleetSettingKeys.OdometerMissingReadingDays]: 'fleet.settings.keys.odometerMissingReadingDays',
};

/**
 * The on/off settings, each a checkbox: HR leave in availability, and Q-01's refusal. The refusal
 * is OFF by default and changes what planning accepts the moment it is saved, so its hint sends the
 * administrator to the roster's «منهم رخصة منتهية» list first.
 */
const BOOLEAN_KEYS = [
  FleetSettingKeys.UseHrLeave,
  FleetSettingKeys.RosterRefuseExpiredLicence,
] as const;
const BOOLEAN_HINTS: Partial<Record<string, string>> = {
  [FleetSettingKeys.RosterRefuseExpiredLicence]: 'fleet.settings.keys.refuseExpiredLicenceHint',
};

const FleetSettingsCard = ({ resolved }: { resolved: ResolvedSettingDto[] }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const canEdit = can('setting.edit');
  const setSetting = useSetFleetSetting();

  const valueOf = (key: string): unknown => resolved.find((s) => s.key === key)?.value;
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [moneys, setMoneys] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setNumbers(Object.fromEntries(NUMBER_KEYS.map((key) => [key, String(valueOf(key) ?? '')])));
    setTexts(Object.fromEntries(TEXT_KEYS.map((key) => [key, String(valueOf(key) ?? '')])));
    setMoneys(Object.fromEntries(MONEY_KEYS.map((key) => [key, String(valueOf(key) ?? '')])));
    setFlags(Object.fromEntries(BOOLEAN_KEYS.map((key) => [key, valueOf(key) === true])));
  }, [resolved]);

  const isText = (key: string): boolean => (TEXT_KEYS as readonly string[]).includes(key);
  const isMoney = (key: string): boolean => (MONEY_KEYS as readonly string[]).includes(key);
  const isFlag = (key: string): boolean => (BOOLEAN_KEYS as readonly string[]).includes(key);
  const numberHint = (key: string): string | undefined => {
    const hintKey = NUMBER_HINTS[key];
    return hintKey === undefined ? undefined : t(hintKey);
  };
  const dirty = (key: string): boolean => {
    if (isFlag(key)) return (flags[key] === true) !== (valueOf(key) === true);
    if (isText(key)) return texts[key] !== String(valueOf(key) ?? '');
    if (isMoney(key)) return moneys[key] !== String(valueOf(key) ?? '');
    return numbers[key] !== String(valueOf(key) ?? '');
  };
  const anyDirty = Object.keys(SETTING_LABELS).some(dirty);
  /** Filled in, and a whole number (`integer`) or an amount (`money`) not below zero. */
  const isAmount = (value: string | undefined, integer: boolean): boolean => {
    const trimmed = (value ?? '').trim();
    const n = Number(trimmed);
    // An emptied box is missing, not zero — `Number('')` is 0, and saving it would write 0.
    return trimmed !== '' && (integer ? Number.isInteger(n) : Number.isFinite(n)) && n >= 0;
  };
  /** Within the server's own bounds, where it declares any — otherwise the save comes back 400. */
  const inBounds = (key: string, value: string | undefined): boolean => {
    const bounds = NUMBER_BOUNDS[key];
    const n = Number((value ?? '').trim());
    return bounds === undefined || (n >= bounds.min && n <= bounds.max);
  };
  // Save stays pressable once something changed: pressing it with a box empty or invalid names it
  // and turns it red (`useRequiredFields`) instead of writing it.
  const required = useRequiredFields(
    [
      ...NUMBER_KEYS.map((key) => ({
        key,
        label: t(SETTING_LABELS[key] ?? key),
        ok: isAmount(numbers[key], true) && inBounds(key, numbers[key]),
      })),
      ...MONEY_KEYS.map((key) => ({
        key,
        label: t(SETTING_LABELS[key] ?? key),
        ok: isAmount(moneys[key], false),
      })),
      // A blank default-branch name would resolve to nothing and silently disable the preselect.
      ...TEXT_KEYS.map((key) => ({
        key,
        label: t(SETTING_LABELS[key] ?? key),
        ok: (texts[key] ?? '').trim() !== '',
      })),
    ],
    resolved,
  );

  const save = async (): Promise<void> => {
    // Organization scope — one write per changed key; the server audits each.
    for (const key of NUMBER_KEYS) {
      if (dirty(key))
        await setSetting.mutateAsync({ key, scope: 'organization', value: Number(numbers[key]) });
    }
    for (const key of MONEY_KEYS) {
      if (dirty(key))
        await setSetting.mutateAsync({ key, scope: 'organization', value: Number(moneys[key]) });
    }
    for (const key of TEXT_KEYS) {
      if (dirty(key))
        await setSetting.mutateAsync({
          key,
          scope: 'organization',
          value: (texts[key] ?? '').trim(),
        });
    }
    for (const key of BOOLEAN_KEYS) {
      if (dirty(key))
        await setSetting.mutateAsync({ key, scope: 'organization', value: flags[key] === true });
    }
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
          <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
          <div className="grid gap-4 sm:grid-cols-2">
            {NUMBER_KEYS.map((key) => (
              <Field
                key={key}
                label={t(SETTING_LABELS[key] ?? key)}
                required
                missing={required.isMissing(key)}
                hint={numberHint(key)}
              >
                <Input
                  rule="integer"
                  value={numbers[key] ?? ''}
                  onChange={(e) => setNumbers((prev) => ({ ...prev, [key]: e.target.value }))}
                  disabled={!canEdit}
                />
              </Field>
            ))}
          </div>
          {/* «ضيف كمان ... اسعار الوقود ... والمعاد قبل انتهاء الفيزا ... وقبل ما الرصيد يخلص» */}
          <div className="grid gap-4 sm:grid-cols-2" data-fleet-fuel-settings="true">
            {MONEY_KEYS.map((key) => (
              <Field
                key={key}
                label={t(SETTING_LABELS[key] ?? key)}
                required
                missing={required.isMissing(key)}
              >
                <MoneyInput
                  value={moneys[key] ?? ''}
                  onChange={(next) => setMoneys((prev) => ({ ...prev, [key]: next }))}
                  disabled={!canEdit}
                />
              </Field>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {TEXT_KEYS.map((key) => (
              <Field
                key={key}
                label={t(SETTING_LABELS[key] ?? key)}
                required
                missing={required.isMissing(key)}
                hint={t('fleet.settings.keys.defaultBranchNameHint')}
              >
                <Input
                  value={texts[key] ?? ''}
                  onChange={(e) => setTexts((prev) => ({ ...prev, [key]: e.target.value }))}
                  disabled={!canEdit}
                  // The signatories' names and titles print in Arabic; the branch name matches a
                  // branch as it is written.
                  {...(key === FleetSettingKeys.DefaultBranchName
                    ? {}
                    : { rule: 'arabic' as const })}
                />
              </Field>
            ))}
          </div>
          {BOOLEAN_KEYS.map((key) => {
            const hint = BOOLEAN_HINTS[key];
            return (
              <div key={key} data-fleet-setting={key}>
                <Checkbox
                  label={t(SETTING_LABELS[key] ?? key)}
                  checked={flags[key] === true}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setFlags((prev) => ({ ...prev, [key]: checked }));
                  }}
                  disabled={!canEdit}
                />
                {hint !== undefined && (
                  <p className="ms-6 mt-1 text-xs text-slate-500 dark:text-slate-400">{t(hint)}</p>
                )}
              </div>
            );
          })}
          {canEdit && (
            <div className="flex justify-end">
              <Button
                loading={setSetting.isPending}
                disabled={!anyDirty}
                onClick={required.guard(save)}
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

  const settings = useMySettings();
  const fleetSettings = (settings.data ?? []).filter((s) => s.key.startsWith('fleet.'));

  const [creatingType, setCreatingType] = useState(false);

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.settings')}
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
          <VehicleTypesTable creating={creatingType} onCloseCreate={() => setCreatingType(false)} />
        </Card>

        {settings.data !== undefined && <FleetSettingsCard resolved={fleetSettings} />}

        {/* NO go-live report here any more — «نحذف الرسايل دى متظهرش خالص». The runs are still
            written to `fleet_go_live_runs` and readable at `GET /fleet/go-live`; no screen shows them. */}
      </div>
    </PageContainer>
  );
};
