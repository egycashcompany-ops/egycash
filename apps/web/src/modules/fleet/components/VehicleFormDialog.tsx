// Create/edit vehicle dialog (FR-1 identity + license + placement + radio). One controlled form
// for both modes; the server owns every rule — uniqueness (FR-1), lifecycle, scoping — so this
// form only shapes the payload and surfaces the API's verdicts. Optional text fields submit as
// null when cleared: an emptied field is an erased fact, not an untouched one.
import { useEffect, useState } from 'react';
import { type FleetVehicleDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { localized } from '../../../shared/lib/format';
import { useBranches } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import { useCreateVehicle, useUpdateVehicle, useVehicleTypes } from '../api/fleet-queries';

interface FormState {
  code: string;
  typeId: string;
  plateNumber: string;
  chassisNumber: string;
  motorNumber: string;
  joinedAt: string;
  licenseExpiresAt: string;
  licenseClass: string;
  branchId: string;
  issi: string;
  motorolaSn: string;
}

const day = (iso: string): string => iso.slice(0, 10);

const fromVehicle = (vehicle: FleetVehicleDto | null): FormState => ({
  code: vehicle?.code ?? '',
  typeId: vehicle?.typeId ?? '',
  plateNumber: vehicle?.plateNumber ?? '',
  chassisNumber: vehicle?.chassisNumber ?? '',
  motorNumber: vehicle?.motorNumber ?? '',
  joinedAt: vehicle === null ? '' : day(vehicle.joinedAt),
  licenseExpiresAt: vehicle === null ? '' : day(vehicle.licenseExpiresAt),
  licenseClass: vehicle?.licenseClass ?? '',
  branchId: vehicle?.branchId ?? '',
  issi: vehicle?.radio.issi ?? '',
  motorolaSn: vehicle?.radio.motorolaSn ?? '',
});

export const VehicleFormDialog = ({
  open,
  onClose,
  vehicle,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create mode. */
  vehicle: FleetVehicleDto | null;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [form, setForm] = useState<FormState>(fromVehicle(vehicle));
  useEffect(() => {
    if (open) setForm(fromVehicle(vehicle));
  }, [open, vehicle]);

  const types = useVehicleTypes();
  const { data: branches = [] } = useBranches(can('branch.view'));
  const create = useCreateVehicle();
  const update = useUpdateVehicle();
  const busy = create.isPending || update.isPending;

  const set = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const complete =
    form.code.trim() !== '' &&
    form.typeId !== '' &&
    form.plateNumber.trim() !== '' &&
    form.chassisNumber.trim() !== '' &&
    form.motorNumber.trim() !== '' &&
    form.joinedAt !== '' &&
    form.licenseExpiresAt !== '';

  const submit = async (): Promise<void> => {
    const opt = (value: string): string | null => (value.trim() === '' ? null : value.trim());
    const core = {
      code: form.code.trim(),
      typeId: form.typeId,
      plateNumber: form.plateNumber.trim(),
      chassisNumber: form.chassisNumber.trim(),
      motorNumber: form.motorNumber.trim(),
      joinedAt: new Date(form.joinedAt),
      licenseExpiresAt: new Date(form.licenseExpiresAt),
      licenseClass: opt(form.licenseClass),
      branchId: opt(form.branchId),
      radio: { issi: opt(form.issi), motorolaSn: opt(form.motorolaSn) },
    };
    if (vehicle === null) {
      await create.mutateAsync(core);
      toast.success(t('fleet.vehicles.created'));
    } else {
      await update.mutateAsync({ id: vehicle.id, body: { ...core, version: vehicle.version } });
      toast.success(t('fleet.vehicles.updated'));
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={vehicle === null ? t('fleet.vehicles.create') : t('fleet.vehicles.edit')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('fleet.vehicles.fields.code')} required>
          <Input value={form.code} onChange={(e) => set('code')(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('fleet.vehicles.fields.type')} required>
          <Select value={form.typeId} onChange={(e) => set('typeId')(e.target.value)}>
            <option value="">{t('common.select')}</option>
            {(types.data?.items ?? [])
              .filter((type) => type.isActive || type.id === vehicle?.typeId)
              .map((type) => (
                <option key={type.id} value={type.id}>
                  {localized(type.name, locale)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('fleet.vehicles.fields.plate')} required>
          <Input value={form.plateNumber} onChange={(e) => set('plateNumber')(e.target.value)} />
        </Field>
        <Field label={t('fleet.vehicles.fields.chassis')} required>
          <Input
            value={form.chassisNumber}
            onChange={(e) => set('chassisNumber')(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('fleet.vehicles.fields.motor')} required>
          <Input
            value={form.motorNumber}
            onChange={(e) => set('motorNumber')(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('fleet.vehicles.fields.joinedAt')} required>
          <Input
            type="date"
            value={form.joinedAt}
            onChange={(e) => set('joinedAt')(e.target.value)}
          />
        </Field>
        <Field label={t('fleet.vehicles.fields.licenseExpiresAt')} required>
          <Input
            type="date"
            value={form.licenseExpiresAt}
            onChange={(e) => set('licenseExpiresAt')(e.target.value)}
          />
        </Field>
        <Field label={t('fleet.vehicles.fields.licenseClass')}>
          <Input value={form.licenseClass} onChange={(e) => set('licenseClass')(e.target.value)} />
        </Field>
        {can('branch.view') && (
          <Field label={t('fleet.vehicles.fields.branch')}>
            <Select value={form.branchId} onChange={(e) => set('branchId')(e.target.value)}>
              <option value="">{t('fleet.vehicles.fields.noBranch')}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {localized(branch.name, locale)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('fleet.vehicles.fields.issi')}>
          <Input value={form.issi} onChange={(e) => set('issi')(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('fleet.vehicles.fields.motorolaSn')}>
          <Input
            value={form.motorolaSn}
            onChange={(e) => set('motorolaSn')(e.target.value)}
            dir="ltr"
          />
        </Field>
      </div>
    </Dialog>
  );
};
