// EDIT a driver profile. There is no create mode: enrolling a driver was removed from the UI, and
// this dialog is reached only from a row that already exists.
//
// FR-11 draws the line down the middle of this form. The fleet-owned facts — licence number and
// date, specialization, work area, the active switch and the licence scan — are editable here.
// The HR-owned facts — name, employee code, job title, address, governorate, mobile number, hire
// date, branch — are DISPLAYED so the editor can see who they are working on, and are read-only
// because Fleet does not own people. There is no frontend workaround for that: the backend's
// update contract has no field for any of them, and inventing one here would only fail at the
// wire. The profile itself is never re-pointed at another person (the contract has no employeeId
// on update — a profile is an extension of ONE person, forever). Version-aware.
import { useEffect, useState } from 'react';
import {
  type FleetDriverProfileDto,
  type FleetDriverSpecialization,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDate, localized } from '../../../shared/lib/format';
import { useUpdateDriverProfile } from '../api/fleet-queries';
import { useBranches, useJobTitles } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import { EmployeeName, useEmployeeRecord } from './EmployeeName';
import { DriverLicenseImageField } from './DriverLicenseImage';

const SPECIALIZATIONS: FleetDriverSpecialization[] = ['cashTransport', 'atm', 'both'];

interface FormState {
  licenseNumber: string;
  licenseExpiresAt: string;
  specialization: FleetDriverSpecialization;
  area: string;
  isActive: boolean;
}

const fromProfile = (profile: FleetDriverProfileDto | null): FormState => ({
  licenseNumber: profile?.licenseNumber ?? '',
  licenseExpiresAt: profile === null ? '' : profile.licenseExpiresAt.slice(0, 10),
  specialization: profile?.specialization ?? 'cashTransport',
  area: profile?.area ?? '',
  isActive: profile?.isActive ?? true,
});

/** One HR fact, read-only, dashed out when it is absent or the caller lacks `employee.view`. */
const ReadOnlyFact = ({ label, value }: { label: string; value: string | null }): JSX.Element => (
  <Field label={label}>
    <p className="text-sm text-slate-600 dark:text-slate-300">
      {value === null || value === '' ? '—' : value}
    </p>
  </Field>
);

export const DriverFormDialog = ({
  open,
  onClose,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  /** The profile being edited. null only while the dialog is closed. */
  profile: FleetDriverProfileDto | null;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [form, setForm] = useState<FormState>(fromProfile(profile));
  useEffect(() => {
    if (open) setForm(fromProfile(profile));
  }, [open, profile]);

  const update = useUpdateDriverProfile();

  // The HR half of the form — the same cached employee record the table row already fetched.
  const employee = useEmployeeRecord(profile?.employeeId ?? '');
  const { data: branches = [] } = useBranches(open && can('branch.view'));
  const { data: jobTitles = [] } = useJobTitles(open && can('jobTitle.view'));
  const address = employee?.personal.officialAddress ?? employee?.personal.currentAddress ?? null;
  const nameOf = (
    items: readonly { id: string; name: { ar: string; en: string } }[],
    id: string | undefined,
  ): string | null => {
    if (id === undefined) return null;
    const found = items.find((item) => item.id === id);
    return found === undefined ? null : localized(found.name, locale);
  };

  const complete = form.licenseNumber.trim() !== '' && form.licenseExpiresAt !== '';

  const submit = async (): Promise<void> => {
    if (profile === null) return;
    await update.mutateAsync({
      id: profile.id,
      body: {
        licenseNumber: form.licenseNumber.trim(),
        licenseExpiresAt: new Date(form.licenseExpiresAt),
        specialization: form.specialization,
        area: form.area.trim() === '' ? null : form.area.trim(),
        isActive: form.isActive,
        version: profile.version,
      },
    });
    toast.success(t('fleet.drivers.updated'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.drivers.edit')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={update.isPending} disabled={!complete} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('fleet.drivers.fields.employee')}>
          <p className="text-sm">
            {profile === null ? '—' : <EmployeeName employeeId={profile.employeeId} />}
          </p>
        </Field>
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
        <Checkbox
          label={t('fleet.drivers.fields.isActive')}
          checked={form.isActive}
          onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
        />

        <Field label={t('fleet.drivers.columns.licenseImage')}>
          {profile === null ? (
            <p className="text-sm">—</p>
          ) : (
            <DriverLicenseImageField driver={profile} />
          )}
        </Field>

        <section className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('fleet.drivers.hrOwned')}
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('fleet.drivers.hrOwnedHint')}
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <ReadOnlyFact
              label={t('fleet.drivers.columns.driver')}
              value={employee?.personal.fullNameAr ?? null}
            />
            <ReadOnlyFact
              label={t('fleet.drivers.columns.employeeCode')}
              value={employee?.code ?? null}
            />
            <ReadOnlyFact
              label={t('fleet.drivers.columns.jobTitle')}
              value={nameOf(jobTitles, employee?.employment.jobTitleId)}
            />
            <ReadOnlyFact
              label={t('fleet.drivers.columns.branch')}
              value={nameOf(branches, employee?.employment.branchId)}
            />
            <ReadOnlyFact
              label={t('fleet.drivers.columns.address')}
              value={address === null ? null : [address.line1, address.city].join('، ')}
            />
            <ReadOnlyFact
              label={t('fleet.drivers.columns.governorate')}
              value={address?.governorate ?? null}
            />
            <ReadOnlyFact
              label={t('fleet.drivers.columns.phone')}
              value={employee?.personal.contact.primaryPhone ?? null}
            />
            <ReadOnlyFact
              label={t('fleet.drivers.columns.hiredAt')}
              value={employee === undefined ? null : formatDate(employee.hiredAt, locale)}
            />
          </div>
        </section>
      </div>
    </Dialog>
  );
};
