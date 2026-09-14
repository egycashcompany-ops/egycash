// A driver's FLEET record, and nothing else — «شيل موضوع الموارد البشريه دا ... انا عاوز
// الانبوتس اللى انا قولت عليها تبقى موجوده وبس».
//
// This form used to carry a second half: every HR-owned fact about the person — name, employee
// code, address, governorate, job title, branch, hire date — displayed read-only, grouped by
// which HR screen owned the change, each group carrying a link out to that screen. It was
// careful and it was correct, and it was answering a question nobody asked here: «لما ادوس على
// تعديل ان اعدل فى الموارد البشريه انا مش عاوز هنا». HR is edited in HR.
//
// So what is left is exactly what this screen is for:
//
//   • the licence NUMBER and its expiry — Fleet's own, and the two the server will not create a
//     profile without (`CreateFleetDriverProfileSchema` requires both);
//   • the specialization and the licence TYPE — Fleet's own catalogs;
//   • the licence SCAN — Fleet's own file;
//   • the mobile number — HR's field, written through HR's own
//     `PATCH /hr/employees/:id/personal` behind `employee.editPersonal`, because a driver's
//     number is corrected by whoever is looking at the driver. Fleet is the screen it is typed
//     on, never the owner of the value.
//
// The BRANCH is deliberately not here, and cannot be. A branch moves by a personnel action with
// an effective date, a reason and an entry in the employee's timeline — a dropdown writing
// `branchId` would be a transfer with no record of itself.
//
// The profile is never re-pointed at another person (the contract has no employeeId on update —
// a profile is an extension of ONE person, forever). Version-aware.
import { useEffect, useState } from 'react';
import { type FleetDriverProfileDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';

import {
  useCreateDriverProfile,
  useUpdateDriverProfile,
  useUploadDriverLicenseImage,
} from '../api/fleet-queries';
import { CatalogSelect } from './CatalogSelect';
import { EmployeeName, useEmployeeRecord } from './EmployeeName';
import {
  DRIVER_LICENSE_IMAGE_ACCEPT,
  DriverLicenseImageField,
  StagedDriverLicenseImage,
} from './DriverLicenseImage';
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
  const [inputKey, setInputKey] = useState(0);
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

  // The phone box follows the record: it fills when the dialog opens and refills if the record
  // arrives after it, which is the ordinary case on a row whose employee is still being fetched.
  const storedPhone = employee?.personal.contact.primaryPhone ?? '';
  useEffect(() => {
    if (open) setPhone(storedPhone);
  }, [open, storedPhone]);

  /**
   * Save is live when the form holds what THIS mode needs, and the two modes need different
   * things.
   *
   * EDITING needs nothing: every field is optional and an empty one is simply not sent, so there
   * is no state of this form that a save could not express. Gating it would disable the button
   * over boxes the reader deliberately left alone.
   *
   * CREATING still needs the licence number and its expiry, and not because this screen wants
   * them: `CreateFleetDriverProfileSchema` requires both, and the driver profile document stores
   * them `required: true`. A create without them is refused by the server, so a live Save would
   * be a button that only ever produced an error.
   */
  const complete =
    profile !== null || (form.licenseNumber.trim() !== '' && form.licenseExpiresAt !== '');

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
    // AN EMPTY BOX MEANS «LEAVE IT», NOT «CLEAR IT» — «لو في داتا كانت موجوده لو عدل عليها يحط
    // داتا مكانها لكن ميمسحهاش».
    //
    // Every field on this form is optional now, and «optional» had two possible meanings: an
    // empty box could travel as `null` and erase what is stored, or it could not travel at all
    // and leave it. The owner named the second. So a field is sent ONLY when it holds something,
    // and the update contract makes that expressible — every key on it is `.optional()`, and a
    // key that is absent is a key the service does not `$set`.
    //
    // The cost is that this form can no longer CLEAR a specialization or a licence type once one
    // is set; emptying the select and saving leaves the old value. That is the trade the
    // instruction asks for, and it is the safer half of it: a value lost to a stray click is
    // worse than a value that needs the right screen to change.
    const given = (value: string): boolean => value.trim() !== '';
    await update.mutateAsync({
      id: profile.id,
      body: {
        // NO `licenseNumber`. The edit form does not show it (see the field above), and a field
        // a form does not show must not be written by it — sending the value it happened to load
        // would be this screen claiming an edit nobody made.
        ...(given(form.licenseExpiresAt)
          ? { licenseExpiresAt: new Date(form.licenseExpiresAt) }
          : {}),
        // `jobId` and `area` are NOT sent either, for the same reason: this form does not show
        // them, and the screen that does still owns them.
        ...(given(form.specializationId) ? { specializationId: form.specializationId } : {}),
        ...(given(form.licenseTypeId) ? { licenseTypeId: form.licenseTypeId } : {}),
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
          {/* THE NUMBER IS ASKED ONCE, WHEN THE PROFILE IS MADE, AND NEVER AGAIN — «انا مش عاوز
              اغير الرقم انا عاوز النوع بتاع الرخصه اولى او تانيه».
              
              It cannot go entirely: `CreateFleetDriverProfileSchema` requires a licence number of
              at least one character, so a create form without this box could not enrol anybody.
              `UpdateFleetDriverProfileSchema` makes it optional, which is what lets the EDIT form
              drop it — and the payload below drops it with the field, because a form that does
              not show a value must not write one. */}
          {profile === null && (
            <Field label={t('fleet.drivers.fields.licenseNumber')}>
              <Input
                value={form.licenseNumber}
                onChange={(e) => setForm((prev) => ({ ...prev, licenseNumber: e.target.value }))}
                dir="ltr"
              />
            </Field>
          )}
          <Field label={t('fleet.drivers.fields.licenseExpiresAt')}>
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
          {/* THE ONE HR FACT THIS FORM WRITES, now in the grid with the rest rather than at the
              bottom of a read-only block that no longer exists.

              It is still HR's field: the write goes to HR's own `PATCH /hr/employees/:id/personal`
              behind `employee.editPersonal`, so the value, its validation and its audit entry all
              stay where they belong. Fleet is only the screen the change is made ON — which is
              the whole ask: a driver's number is corrected by whoever is looking at the driver.

              Without the grant it is not shown at all. There is nothing to fall back to now that
              the read-only block is gone, and a box that silently refuses to save is worse than
              no box. */}
          {mayEditPhone && (
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
          )}
        </div>

        {/* «نشط فى مجمع السائقين» — KEPT, after it was nearly dropped.
            
            It looks like a preference and it is not: this checkbox is the only writer of
            `isActive` anywhere in the application. The profile screen displays the flag and
            never sets it, and the one other thing that moves it is automatic — the service
            deactivates a driver when HR records the employee's exit. Removing it would have left
            a driver who had been activated impossible to retire by hand, ever. */}
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
            // ONCE A SCAN IS CHOSEN, THE PICKER IS DONE — «انا مش عاوز دى تظهر انا رفعت الصوره
            // خلاص». It answers with the picture, an eye and a bin, exactly as the vehicles
            // registry does, rather than with the upload button still sitting there beside a file
            // name off somebody's phone. Until then it is the picker and nothing else.
            //
            // `inputKey` remounts the input after the bin empties it, so choosing the SAME file
            // again still fires a change event — the trick `DriverLicenseImageCell` needs for the
            // same reason, and needed here because unstaging and re-picking one image is the
            // obvious way to check you picked the right one.
            stagedImage === null ? (
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 focus-within:ring-2 focus-within:ring-brand-500/40 dark:border-slate-700 dark:hover:bg-slate-800">
                <UploadIcon className="h-4 w-4" />
                {t('fleet.drivers.licenseImage.upload')}
                <input
                  key={inputKey}
                  type="file"
                  data-driver-license-staged
                  accept={DRIVER_LICENSE_IMAGE_ACCEPT}
                  className="hidden"
                  aria-label={t('fleet.drivers.licenseImage.upload')}
                  onChange={(e) => setStagedImage(e.target.files?.[0] ?? null)}
                />
              </label>
            ) : (
              <StagedDriverLicenseImage
                file={stagedImage}
                onClear={() => {
                  setStagedImage(null);
                  setInputKey((k) => k + 1);
                }}
              />
            )
          ) : (
            <DriverLicenseImageField driver={profile} />
          )}
        </Field>

      </div>
    </Dialog>
  );
};
