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
import { type FleetDriverProfileDto, type Locale } from '@ecms/contracts';
import { Link } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { ExternalLinkIcon } from '../../../shared/ui/icons';
import { formatDate, localized } from '../../../shared/lib/format';
import {
  useCreateDriverProfile,
  useUpdateDriverProfile,
  useUploadDriverLicenseImage,
} from '../api/fleet-queries';
import { useBranches, useJobTitles } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import { CatalogSelect } from './CatalogSelect';
import { EmployeeName, useEmployeeRecord } from './EmployeeName';
import {
  HR_DELEGATION,
  hrProfileHref,
  mayDelegateTo,
  type HrDelegationGroup,
} from './hr-delegation';
import { DRIVER_LICENSE_IMAGE_ACCEPT, DriverLicenseImageField } from './DriverLicenseImage';
import { UploadIcon } from '../../../shared/ui/icons';
import { errorMessage } from '../../../shared/lib/errors';
import { useUpdateEmployeePersonal } from '../../hr/employee-management/employees/api/employee-queries';

interface FormState {
  licenseNumber: string;
  licenseExpiresAt: string;
  /** The two catalog ids. `''` = «not chosen», which is a state a profile is allowed to be in. */
  specializationId: string;
  licenseTypeId: string;
  isActive: boolean;
}

const fromProfile = (profile: FleetDriverProfileDto | null): FormState => ({
  licenseNumber: profile?.licenseNumber ?? '',
  licenseExpiresAt: profile === null ? '' : profile.licenseExpiresAt.slice(0, 10),
  specializationId: profile?.specializationId ?? '',
  licenseTypeId: profile?.licenseTypeId ?? '',
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
  employeeId: subjectId,
  profile,
  initialImage = null,
}: {
  open: boolean;
  onClose: () => void;
  /** WHO the row is about. Always known — the registry's rows are people, not profiles. */
  employeeId: string;
  /**
   * A scan the caller ALREADY has in hand, staged the moment the dialog opens.
   *
   * The registry's licence cell offers the file picker first — «تدوس الأيقونة، مستكشف الملفات
   * يفتح على طول، تختار الصورة» — so by the time this dialog appears the reader has chosen the
   * image and is only being asked for the two facts the server refuses to create a profile
   * without. Passing the file in rather than making them pick it again is the whole point of
   * opening the picker first.
   */
  initialImage?: File | null;
  /**
   * What Fleet has recorded about them, or null when nothing has been.
   *
   * Null is the ordinary case for a driver the org chart just produced: they hold a seat that
   * requires a driving test, so they are on the registry, and their licence has not been entered
   * yet. The form then RECORDS for the first time instead of editing — which is what finally gives
   * the create endpoint a caller. It had none since «Add Driver» left the UI, so a profile could
   * not be made at all and the registry stayed empty however many drivers were hired.
   */
  profile: FleetDriverProfileDto | null;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [form, setForm] = useState<FormState>(fromProfile(profile));

  const update = useUpdateDriverProfile();
  const create = useCreateDriverProfile();
  const uploadLicense = useUploadDriverLicenseImage();
  /**
   * A SCAN CHOSEN BEFORE THERE IS ANYWHERE TO PUT IT.
   *
   * Every licence endpoint is keyed on the profile id, so on a driver who is not enrolled yet
   * there is literally no id to upload against — which is why this field used to render «—» and
   * why the list's cell had nothing to offer. Making the reader enrol, close the dialog, find the
   * row again and only then upload is two visits for one intention; the file is held here instead
   * and sent the moment the create answers with an id.
   */
  const [stagedImage, setStagedImage] = useState<File | null>(initialImage);
  // ONE reset, on open, for the form AND the staged scan together. They are one draft: a file
  // chosen for one driver and then cancelled must not still be attached when the dialog reopens
  // on the next one, and `initialImage` is only ever the file THIS opening was given.
  useEffect(() => {
    if (!open) return;
    setForm(fromProfile(profile));
    setStagedImage(initialImage);
  }, [open, profile, initialImage]);
  // HR's own mutation, called with HR's own permission — see the note beside the field.
  const mayEditPhone = can('employee.editPersonal');
  const [phone, setPhone] = useState('');
  const savePhone = useUpdateEmployeePersonal(subjectId);

  // The HR half of the form — the same cached employee record the table row already fetched.
  const employeeId = profile?.employeeId ?? subjectId;
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

  // The phone box follows the record: it fills when the dialog opens and refills if the record
  // arrives after it, which is the ordinary case on a row whose employee is still being fetched.
  const storedPhone = employee?.personal.contact.primaryPhone ?? '';
  useEffect(() => {
    if (open) setPhone(storedPhone);
  }, [open, storedPhone]);

  const complete = form.licenseNumber.trim() !== '' && form.licenseExpiresAt !== '';

  /**
   * Send the phone to HR, and only if it CHANGED.
   *
   * Version-checked like every HR write, and skipped entirely when untouched — an unchanged value
   * re-sent is an audit entry saying somebody edited a number they did not.
   */
  const persistPhone = async (): Promise<void> => {
    if (!mayEditPhone || employee === undefined) return;
    const next = phone.trim();
    if (next === storedPhone) return;
    // ONLY the field that changed. `contact` is a partial on the HR schema, so echoing the whole
    // object back would put this form's idea of an email and a preferred channel into a write it
    // has no business making — and would overwrite them with whatever it happened to have read.
    await savePhone.mutateAsync({
      contact: { primaryPhone: next },
      version: employee.version,
    });
  };

  const submit = async (): Promise<void> => {
    // `''` in the form means «nobody has chosen one», and it must reach the server as `null` —
    // both to CLEAR a grade that was set by mistake and because an empty string is not an id.
    const ref = (value: string): string | null => (value === '' ? null : value);
    // FIRST TIME: the person is on the registry because of their seat, and this is the licence
    // being written down. `isActive` is not offered here — a profile is created active, and
    // deactivating one is a decision about a driver who already exists.
    if (profile === null) {
      if (subjectId === '') return;
      const created = await create.mutateAsync({
        employeeId: subjectId,
        licenseNumber: form.licenseNumber.trim(),
        licenseExpiresAt: new Date(form.licenseExpiresAt),
        specializationId: ref(form.specializationId),
        licenseTypeId: ref(form.licenseTypeId),
      });
      // The scan, now that there is something to hang it on. A failure here must not read as a
      // failed enrolment — the profile IS created, and saying otherwise would send the reader
      // looking for a driver who is already there.
      if (stagedImage !== null) {
        try {
          await uploadLicense.mutateAsync({ id: created.id, file: stagedImage });
        } catch (error) {
          toast.error(errorMessage(error, locale));
        }
      }
      await persistPhone();
      toast.success(t('fleet.drivers.recorded'));
      onClose();
      return;
    }
    await update.mutateAsync({
      id: profile.id,
      body: {
        licenseNumber: form.licenseNumber.trim(),
        licenseExpiresAt: new Date(form.licenseExpiresAt),
        // `jobId` and `area` are NOT sent. This form no longer shows them, and a field a form
        // does not show must not be written by it — sending `null` would silently clear whatever
        // somebody set through the screen that still owns them.
        specializationId: ref(form.specializationId),
        licenseTypeId: ref(form.licenseTypeId),
        isActive: form.isActive,
        version: profile.version,
      },
    });
    await persistPhone();
    toast.success(t('fleet.drivers.updated'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={profile === null ? t('fleet.drivers.record') : t('fleet.drivers.edit')}
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
          {/* The three fleet catalogs. Exactly the lists /fleet/drivers FILTERS by and the table
              DISPLAYS — one `useFleetCatalog` cache entry per kind, read by all three — so a value
              an admin adds is offered here the moment it exists, and the form can never offer a
              vocabulary the filter bar does not have. */}
          <Field label={t('fleet.drivers.fields.specialization')}>
            <CatalogSelect
              kind="driverSpecialization"
              value={form.specializationId}
              onChange={(id) => setForm((prev) => ({ ...prev, specializationId: id }))}
              allLabel={t('fleet.drivers.noSpecialization')}
              ariaLabel={t('fleet.drivers.fields.specialization')}
            />
          </Field>
          <Field label={t('fleet.drivers.fields.licenseType')}>
            <CatalogSelect
              kind="driverLicenseType"
              value={form.licenseTypeId}
              onChange={(id) => setForm((prev) => ({ ...prev, licenseTypeId: id }))}
              allLabel={t('fleet.drivers.noLicenseType')}
              ariaLabel={t('fleet.drivers.fields.licenseType')}
            />
          </Field>
        </div>
        <Checkbox
          label={t('fleet.drivers.fields.isActive')}
          checked={form.isActive}
          onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
        />

        <Field
          label={t('fleet.drivers.columns.licenseImage')}
          {...(profile === null && stagedImage !== null
            ? { hint: t('fleet.drivers.licenseImage.stagedHint') }
            : {})}
        >
          {profile === null ? (
            <span className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 focus-within:ring-2 focus-within:ring-brand-500/40 dark:border-slate-700 dark:hover:bg-slate-800">
                <UploadIcon className="h-4 w-4" />
                {t('fleet.drivers.licenseImage.upload')}
                <input
                  type="file"
                  data-driver-license-staged
                  accept={DRIVER_LICENSE_IMAGE_ACCEPT}
                  className="hidden"
                  aria-label={t('fleet.drivers.licenseImage.upload')}
                  onChange={(e) => setStagedImage(e.target.files?.[0] ?? null)}
                />
              </label>
              {stagedImage !== null && (
                <span className="truncate text-sm text-slate-600 dark:text-slate-300">
                  {t('fleet.drivers.licenseImage.staged', { name: stagedImage.name })}
                </span>
              )}
            </span>
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
              {/* THE ONE HR FACT THIS FORM WRITES. It is still HR's field — the write goes to
                  HR's own `PATCH /hr/employees/:id/personal` behind `employee.editPersonal`, so
                  the value, its validation and its audit entry all stay where they belong. Fleet
                  is only the screen the change is made ON, which is the whole ask: a driver's
                  number is corrected by whoever is looking at the driver.

                  Without the grant it stays exactly as it was — a read-only fact with the link
                  out to the screen that can change it. */}
              {mayEditPhone ? (
                <Field label={t('fleet.drivers.columns.phone')}>
                  <Input
                    data-driver-phone
                    aria-label={t('fleet.drivers.columns.phone')}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    dir="ltr"
                    inputMode="tel"
                  />
                </Field>
              ) : (
                <ReadOnlyFact
                  label={t('fleet.drivers.columns.phone')}
                  value={employee?.personal.contact.primaryPhone ?? null}
                />
              )}
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
