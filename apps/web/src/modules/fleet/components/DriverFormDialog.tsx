// Create/edit driver profile (FR-11: the profile holds ONLY what Fleet owns — license,
// specialization, area, the active switch; the person stays in HR). Create picks the employee
// through the directory search; edit never re-points the profile (the backend contract has no
// employeeId on update — a profile is an extension of ONE person, forever). Version-aware.
import { useEffect, useState } from 'react';
import { type FleetDriverProfileDto, type FleetDriverSpecialization } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useCreateDriverProfile, useUpdateDriverProfile } from '../api/fleet-queries';
import { EmployeeSearchPicker } from './EmployeeSearchPicker';
import { EmployeeName } from './EmployeeName';

const SPECIALIZATIONS: FleetDriverSpecialization[] = ['cashTransport', 'atm', 'both'];

interface FormState {
  employeeId: string;
  licenseNumber: string;
  licenseExpiresAt: string;
  specialization: FleetDriverSpecialization;
  area: string;
  isActive: boolean;
}

const fromProfile = (profile: FleetDriverProfileDto | null): FormState => ({
  employeeId: profile?.employeeId ?? '',
  licenseNumber: profile?.licenseNumber ?? '',
  licenseExpiresAt: profile === null ? '' : profile.licenseExpiresAt.slice(0, 10),
  specialization: profile?.specialization ?? 'cashTransport',
  area: profile?.area ?? '',
  isActive: profile?.isActive ?? true,
});

export const DriverFormDialog = ({
  open,
  onClose,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create mode (with the employee picker). */
  profile: FleetDriverProfileDto | null;
}): JSX.Element => {
  const t = useT();
  const [form, setForm] = useState<FormState>(fromProfile(profile));
  useEffect(() => {
    if (open) setForm(fromProfile(profile));
  }, [open, profile]);

  const create = useCreateDriverProfile();
  const update = useUpdateDriverProfile();
  const busy = create.isPending || update.isPending;

  const complete =
    form.employeeId !== '' && form.licenseNumber.trim() !== '' && form.licenseExpiresAt !== '';

  const submit = async (): Promise<void> => {
    const area = form.area.trim() === '' ? null : form.area.trim();
    if (profile === null) {
      await create.mutateAsync({
        employeeId: form.employeeId,
        licenseNumber: form.licenseNumber.trim(),
        licenseExpiresAt: new Date(form.licenseExpiresAt),
        specialization: form.specialization,
        area,
      });
      toast.success(t('fleet.drivers.created'));
    } else {
      await update.mutateAsync({
        id: profile.id,
        body: {
          licenseNumber: form.licenseNumber.trim(),
          licenseExpiresAt: new Date(form.licenseExpiresAt),
          specialization: form.specialization,
          area,
          isActive: form.isActive,
          version: profile.version,
        },
      });
      toast.success(t('fleet.drivers.updated'));
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={profile === null ? t('fleet.drivers.create') : t('fleet.drivers.edit')}
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
      <div className="space-y-4">
        {profile === null ? (
          <Field label={t('fleet.drivers.fields.employee')} required>
            <EmployeeSearchPicker
              value={form.employeeId}
              onPick={(employeeId) => setForm((prev) => ({ ...prev, employeeId }))}
            />
          </Field>
        ) : (
          <Field label={t('fleet.drivers.fields.employee')}>
            <p className="text-sm">
              <EmployeeName employeeId={profile.employeeId} />
            </p>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fleet.drivers.fields.licenseNumber')} required>
            <Input
              value={form.licenseNumber}
              onChange={(e) => setForm((prev) => ({ ...prev, licenseNumber: e.target.value }))}
              dir="ltr"
            />
          </Field>
          <Field label={t('fleet.drivers.fields.licenseExpiresAt')} required>
            <Input
              type="date"
              value={form.licenseExpiresAt}
              onChange={(e) => setForm((prev) => ({ ...prev, licenseExpiresAt: e.target.value }))}
            />
          </Field>
          <Field label={t('fleet.drivers.fields.specialization')} required>
            <Select
              value={form.specialization}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  specialization: e.target.value as FleetDriverSpecialization,
                }))
              }
            >
              {SPECIALIZATIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`fleet.drivers.specialization.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('fleet.drivers.fields.area')}>
            <Input
              value={form.area}
              onChange={(e) => setForm((prev) => ({ ...prev, area: e.target.value }))}
            />
          </Field>
        </div>
        {profile !== null && (
          <Checkbox
            label={t('fleet.drivers.fields.isActive')}
            checked={form.isActive}
            onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
          />
        )}
      </div>
    </Dialog>
  );
};
