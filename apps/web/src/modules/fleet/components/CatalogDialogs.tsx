// Catalog + rules dialogs (FW-10). Catalog items and vehicle types ARCHIVE instead of delete —
// history references them — so the edit form offers `isActive`, never a delete. `countsForAlarm`
// is a workType-only fact (closing a visit of such a type resets the alarm baseline) and the
// form offers it only there, mirroring the schema's own refinement. The vehicle type carries
// the §2.2 maintenance rule: interval km, 0 = no periodic-maintenance rule — the wording the
// hint uses, because the ALARM engine reads exactly that.
import { useEffect, useState } from 'react';
import {
  type FleetCatalogItemDto,
  type FleetViolationSide,
  type FleetCatalogKind,
  type FleetVehicleTypeDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Select } from '../../../shared/ui/form';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCreateCatalogItem,
  useCreateVehicleType,
  useUpdateCatalogItem,
  useUpdateVehicleType,
} from '../api/fleet-queries';

export const CatalogItemDialog = ({
  open,
  onClose,
  kind,
  item,
}: {
  open: boolean;
  onClose: () => void;
  kind: FleetCatalogKind;
  /** null = create in `kind`; a document = version-aware edit (the kind is identity). */
  item: FleetCatalogItemDto | null;
}): JSX.Element => {
  const t = useT();
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [countsForAlarm, setCountsForAlarm] = useState(false);
  // A violation type belongs to one half of the violations screen; «company» is the default
  // because a fine the house pays is the commoner entry and the safer one to guess wrong.
  const [violationSide, setViolationSide] = useState<FleetViolationSide>('company');
  const [isActive, setIsActive] = useState(true);
  useEffect(() => {
    if (!open) return;
    setNameAr(item?.name.ar ?? '');
    setNameEn(item?.name.en ?? '');
    setCountsForAlarm(item?.countsForAlarm ?? false);
    setViolationSide(item?.violationSide ?? 'company');
    setIsActive(item?.isActive ?? true);
  }, [open, item]);

  const create = useCreateCatalogItem();
  const update = useUpdateCatalogItem();
  const pending = create.isPending || update.isPending;
  // Save stays pressable: pressing it with either name empty names it and turns its box red
  // (`useRequiredFields`).
  const required = useRequiredFields(
    [
      { key: 'nameAr', label: t('fleet.catalogs.fields.nameAr'), ok: nameAr.trim() !== '' },
      { key: 'nameEn', label: t('fleet.catalogs.fields.nameEn'), ok: nameEn.trim() !== '' },
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    const name = { ar: nameAr.trim(), en: nameEn.trim() };
    if (item === null) {
      await create.mutateAsync({
        kind,
        name,
        countsForAlarm: kind === 'workType' ? countsForAlarm : false,
        // Required for a violation type and refused for every other kind — the server says so,
        // and sending it anywhere else would be a 422 the reader could do nothing about.
        ...(kind === 'violationType' ? { violationSide } : {}),
      });
    } else {
      await update.mutateAsync({
        id: item.id,
        body: {
          version: item.version,
          ...(name.ar !== item.name.ar || name.en !== item.name.en ? { name } : {}),
          ...(kind === 'workType' && countsForAlarm !== item.countsForAlarm
            ? { countsForAlarm }
            : {}),
          ...(kind === 'violationType' && violationSide !== item.violationSide
            ? { violationSide }
            : {}),
          ...(isActive !== item.isActive ? { isActive } : {}),
        },
      });
    }
    toast.success(t('fleet.catalogs.saved'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissOnOutsideClick={false}
      title={
        item === null
          ? t('fleet.catalogs.addItem', { kind: t(`fleet.catalogs.kind.${kind}`) })
          : t('fleet.catalogs.editItem')
      }
      description={t('fleet.catalogs.archiveHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} onClick={required.guard(submit)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <Field
          label={t('fleet.catalogs.fields.nameAr')}
          required
          missing={required.isMissing('nameAr')}
        >
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} rule="arabic" />
        </Field>
        <Field
          label={t('fleet.catalogs.fields.nameEn')}
          required
          missing={required.isMissing('nameEn')}
        >
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} rule="english" />
        </Field>
        {kind === 'workType' && (
          <Checkbox
            label={t('fleet.catalogs.fields.countsForAlarm')}
            checked={countsForAlarm}
            onChange={(e) => setCountsForAlarm(e.target.checked)}
          />
        )}
        {/* Which half of the violations screen offers this type. Not a preference — a type with
            the wrong side is filed into the wrong ledger, and the rollup's company/driver split
            is what a branch is judged on. */}
        {kind === 'violationType' && (
          <Field label={t('fleet.catalogs.fields.violationSide')} required>
            <Select
              value={violationSide}
              data-violation-side="true"
              onChange={(e) => setViolationSide(e.target.value as FleetViolationSide)}
            >
              <option value="company">{t('fleet.violations.side.company')}</option>
              <option value="driver">{t('fleet.violations.side.driver')}</option>
            </Select>
          </Field>
        )}
        {item !== null && (
          <Checkbox
            label={t('fleet.catalogs.fields.isActive')}
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
        )}
      </div>
    </Dialog>
  );
};

export const VehicleTypeDialog = ({
  open,
  onClose,
  type,
}: {
  open: boolean;
  onClose: () => void;
  /** null = create; a document = version-aware edit. */
  type: FleetVehicleTypeDto | null;
}): JSX.Element => {
  const t = useT();
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [intervalKm, setIntervalKm] = useState('0');
  const [isActive, setIsActive] = useState(true);
  useEffect(() => {
    if (!open) return;
    setNameAr(type?.name.ar ?? '');
    setNameEn(type?.name.en ?? '');
    setIntervalKm(String(type?.maintenanceIntervalKm ?? 0));
    setIsActive(type?.isActive ?? true);
  }, [open, type]);

  const create = useCreateVehicleType();
  const update = useUpdateVehicleType();
  const pending = create.isPending || update.isPending;
  const interval = Number(intervalKm);
  // Save stays pressable: pressing it with any of these empty names them and turns their boxes red
  // (`useRequiredFields`). An emptied interval is missing, not «no rule» — `Number('')` is 0, and
  // a cleared box would otherwise save as 0 and silently drop the type's maintenance rule.
  const required = useRequiredFields(
    [
      { key: 'nameAr', label: t('fleet.catalogs.fields.nameAr'), ok: nameAr.trim() !== '' },
      { key: 'nameEn', label: t('fleet.catalogs.fields.nameEn'), ok: nameEn.trim() !== '' },
      {
        key: 'intervalKm',
        label: t('fleet.settings.fields.intervalKm'),
        ok: intervalKm.trim() !== '' && Number.isInteger(interval) && interval >= 0,
      },
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    const name = { ar: nameAr.trim(), en: nameEn.trim() };
    if (type === null) {
      await create.mutateAsync({ name, maintenanceIntervalKm: interval });
    } else {
      await update.mutateAsync({
        id: type.id,
        body: {
          version: type.version,
          ...(name.ar !== type.name.ar || name.en !== type.name.en ? { name } : {}),
          ...(interval !== type.maintenanceIntervalKm ? { maintenanceIntervalKm: interval } : {}),
          ...(isActive !== type.isActive ? { isActive } : {}),
        },
      });
    }
    toast.success(t('fleet.settings.typeSaved'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissOnOutsideClick={false}
      title={type === null ? t('fleet.settings.addType') : t('fleet.settings.editType')}
      description={t('fleet.settings.typeHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} onClick={required.guard(submit)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <Field
          label={t('fleet.catalogs.fields.nameAr')}
          required
          missing={required.isMissing('nameAr')}
        >
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} rule="arabic" />
        </Field>
        <Field
          label={t('fleet.catalogs.fields.nameEn')}
          required
          missing={required.isMissing('nameEn')}
        >
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} rule="english" />
        </Field>
        <Field
          label={t('fleet.settings.fields.intervalKm')}
          required
          missing={required.isMissing('intervalKm')}
          hint={t('fleet.settings.intervalHint')}
        >
          <Input
            rule="integer"
            value={intervalKm}
            onChange={(e) => setIntervalKm(e.target.value)}
            dir="ltr"
          />
        </Field>
        {type !== null && (
          <Checkbox
            label={t('fleet.catalogs.fields.isActive')}
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
        )}
      </div>
    </Dialog>
  );
};
