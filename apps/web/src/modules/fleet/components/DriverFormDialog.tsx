// EDIT a driver profile. There is no create mode: enrolling a driver was removed from the UI, and
// this dialog is reached only from a row that already exists.
//
// FR-11 draws the line down the middle of this form. The fleet-owned facts — licence number and
// date, specialization, work area, the active switch and the licence scan — are editable here.
// The HR-owned facts are DISPLAYED so the editor can see who they are working on, and are
// read-only because Fleet does not own people.
//
// Read-only is not a dead end, though: each HR group carries a link to the HR screen that DOES
// own the change, shown only to someone holding that screen's grant. The grouping is by owner,
// because these are not one kind of field:
//
//   • name, address, governorate, mobile → `PATCH /hr/employees/:id/personal`, so the link goes
//     to the Personal tab and needs `employee.editPersonal`;
//   • job title, hire date, branch → PERSONNEL ACTIONS (promotion / dataCorrection / transfer),
//     each with an effective date and a reason and an entry in the employee's timeline. A form
//     that wrote `branchId` directly would not be a shortcut, it would be a transfer with no
//     record. The link goes to the Employment tab and needs `employee.manageActions`;
//   • employee code is DERIVED (`<BranchCode><employeeNumber>`) and no API anywhere writes it, so
//     it gets no action at all — offering one would promise something nothing can do.
//
// Fleet writes none of it. The profile itself is never re-pointed at another person (the contract
// has no employeeId on update — a profile is an extension of ONE person, forever). Version-aware.
import { useEffect, useState } from 'react';
import {
  type FleetDriverProfileDto,
  type FleetDriverSpecialization,
  type Locale,
} from '@ecms/contracts';
import { Link } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { ExternalLinkIcon } from '../../../shared/ui/icons';
import { formatDate, localized } from '../../../shared/lib/format';
import { useUpdateDriverProfile } from '../api/fleet-queries';
import { useBranches, useJobTitles } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import { EmployeeName, useEmployeeRecord } from './EmployeeName';
import {
  HR_DELEGATION,
  hrProfileHref,
  mayDelegateTo,
  type HrDelegationGroup,
} from './hr-delegation';
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

/**
 * The link out to the HR screen that owns a group of facts.
 *
 * Rendered only when the caller holds the grant that screen's own edit action requires, so the
 * dialog never offers a door the user cannot walk through. `/employees/:id?tab=…` is the HR
 * profile's existing tab convention — no new route, no duplicated form.
 */
const HrEditLink = ({
  employeeId,
  group,
  label,
}: {
  employeeId: string;
  group: HrDelegationGroup;
  label: string;
}): JSX.Element => (
  <Link
    to={hrProfileHref(employeeId, group.tab)}
    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-slate-50 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-slate-800"
  >
    {label}
    <ExternalLinkIcon className="h-3.5 w-3.5" />
  </Link>
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
  const employeeId = profile?.employeeId ?? '';
  const employee = useEmployeeRecord(employeeId);
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

        <section className="space-y-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('fleet.drivers.hrOwned')}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('fleet.drivers.hrOwnedHint')}
            </p>
          </div>

          {/* Employee code first, alone and with NO action: it is derived, not stored. */}
          <ReadOnlyFact
            label={t('fleet.drivers.columns.employeeCode')}
            value={employee?.code ?? null}
          />

          {/* Group 1 — personal data, changed by `PATCH /hr/employees/:id/personal`. */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t('fleet.drivers.hrPersonal')}
              </h4>
              {employeeId !== '' && mayDelegateTo(HR_DELEGATION.personal, can) && (
                <HrEditLink
                  employeeId={employeeId}
                  group={HR_DELEGATION.personal}
                  label={t('fleet.drivers.hrEditPersonal')}
                />
              )}
            </div>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <ReadOnlyFact
                label={t('fleet.drivers.columns.driver')}
                value={employee?.personal.fullNameAr ?? null}
              />
              <ReadOnlyFact
                label={t('fleet.drivers.columns.phone')}
                value={employee?.personal.contact.primaryPhone ?? null}
              />
              <ReadOnlyFact
                label={t('fleet.drivers.columns.address')}
                value={address === null ? null : [address.line1, address.city].join('، ')}
              />
              <ReadOnlyFact
                label={t('fleet.drivers.columns.governorate')}
                value={address?.governorate ?? null}
              />
            </div>
          </div>

          {/* Group 2 — placement and dates, each changed by a PERSONNEL ACTION, not a field edit. */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t('fleet.drivers.hrEmployment')}
              </h4>
              {employeeId !== '' && mayDelegateTo(HR_DELEGATION.employment, can) && (
                <HrEditLink
                  employeeId={employeeId}
                  group={HR_DELEGATION.employment}
                  label={t('fleet.drivers.hrEditEmployment')}
                />
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('fleet.drivers.hrEmploymentHint')}
            </p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <ReadOnlyFact
                label={t('fleet.drivers.columns.jobTitle')}
                value={nameOf(jobTitles, employee?.employment.jobTitleId)}
              />
              <ReadOnlyFact
                label={t('fleet.drivers.columns.branch')}
                value={nameOf(branches, employee?.employment.branchId)}
              />
              <ReadOnlyFact
                label={t('fleet.drivers.columns.hiredAt')}
                value={employee === undefined ? null : formatDate(employee.hiredAt, locale)}
              />
            </div>
          </div>
        </section>
      </div>
    </Dialog>
  );
};
