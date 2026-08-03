// Catalog + rules dialogs (FW-10). Catalog items and vehicle types ARCHIVE instead of delete —
// history references them — so the edit form offers `isActive`, never a delete. `countsForAlarm`
// is a workType-only fact (closing a visit of such a type resets the alarm baseline) and the
// form offers it only there, mirroring the schema's own refinement. The vehicle type carries
// the §2.2 maintenance rule: interval km, 0 = no periodic-maintenance rule — the wording the
// hint uses, because the ALARM engine reads exactly that.
import { useEffect, useState } from 'react';
import {
  type FleetCatalogItemDto,
  type FleetCatalogKind,
  type FleetVehicleTypeDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input } from '../../../shared/ui/form';
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
  const [isActive, setIsActive] = useState(true);
  useEffect(() => {
    if (!open) return;
    setNameAr(item?.name.ar ?? '');
    setNameEn(item?.name.en ?? '');
    setCountsForAlarm(item?.countsForAlarm ?? false);
    setIsActive(item?.isActive ?? true);
  }, [open, item]);

  const create = useCreateCatalogItem();
  const update = useUpdateCatalogItem();
  const pending = create.isPending || update.isPending;
  const complete = nameAr.trim() !== '' && nameEn.trim() !== '';

  const submit = async (): Promise<void> => {
    const name = { ar: nameAr.trim(), en: nameEn.trim() };
    if (item === null) {
      await create.mutateAsync({
        kind,
        name,
        countsForAlarm: kind === 'workType' ? countsForAlarm : false,
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
          <Button loading={pending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('fleet.catalogs.fields.nameAr')} required>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('fleet.catalogs.fields.nameEn')} required>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
        </Field>
        {kind === 'workType' && (
          <Checkbox
            label={t('fleet.catalogs.fields.countsForAlarm')}
            checked={countsForAlarm}
            onChange={(e) => setCountsForAlarm(e.target.checked)}
          />
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
  const complete =
    nameAr.trim() !== '' && nameEn.trim() !== '' && Number.isInteger(interval) && interval >= 0;

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
      title={type === null ? t('fleet.settings.addType') : t('fleet.settings.editType')}
      description={t('fleet.settings.typeHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('fleet.catalogs.fields.nameAr')} required>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('fleet.catalogs.fields.nameEn')} required>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
        </Field>
        <Field
          label={t('fleet.settings.fields.intervalKm')}
          required
          hint={t('fleet.settings.intervalHint')}
        >
          <Input
            type="number"
            min={0}
            step={1}
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
