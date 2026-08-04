// Applicant create/edit form (manual entry + OCR assist). Reuses the shared form primitives.
//
// Validation is LIVE: a field is checked when you leave it, so the mistake is named next to the
// field that made it rather than in a list at the bottom after a failed save. Saving re-checks
// everything and jumps to the first bad field. The rules live in `applicant-validation.ts` and
// come from `@ecms/contracts` — the same predicates the API validates with, so the form never
// accepts something the server will reject.
//
// Builds a RegisterApplicant (create) or UpdateApplicant (edit) payload; identity number /
// nationality are create-only (edits to the National ID go through the verify-identity flow).
import { useState } from 'react';
import {
  APPLICANT_INTAKE_CHANNELS,
  CONTACT_CHANNELS,
  EDUCATION_LEVELS,
  EGYPT_GOVERNORATES,
  MARITAL_STATUSES,
  MILITARY_STATUSES,
  NATIONALITY_EGYPTIAN,
  NATIONALITY_LABELS,
  RELIGIONS,
  asciiDigits,
  citiesOfGovernorate,
  findGovernorate,
  normalizeEgyptianPhone,
  normalizeReligion,
  parseNationalId,
  type Address,
  type ApplicantDto,
  type ApplicantIntakeChannel,
  type ApplicantSourceDto,
  type RegisterApplicant,
  type UpdateApplicant,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { localized, formatDate } from '../../../../../shared/lib/format';
import { validationDetails } from '../../../../../shared/lib/errors';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Combobox } from '../../../../../shared/ui/Combobox';
import { Field, Input, Select, Checkbox, Form, FormActions } from '../../../../../shared/ui/form';
import { PlusIcon, TrashIcon } from '../../../../../shared/ui/icons';
import { transliterateArabicName, type NationalIdReviewData } from '../../../../../shared/national-id';
import { ApplicantNationalIdOcr } from './ApplicantNationalIdOcr';
import { ReferenceField } from './RefPickers';
import {
  firstErrorField,
  validateField,
  validateForm,
  type AddressForm,
  type FieldErrors,
  type FieldName,
  type FormState,
} from './applicant-validation';

const emptyAddress = (): AddressForm => ({
  line1: '',
  line2: '',
  city: '',
  governorate: '',
  postalCode: '',
});

const GOVERNORATE_NAMES = EGYPT_GOVERNORATES.map((g) => g.ar);

/** A governorate spelled any way the data might carry it, rendered as the catalog spells it.
 *  Empty when the catalog does not know it — callers decide what an unknown place means. */
const toCatalogGovernorate = (value: string): string => findGovernorate(value)?.ar ?? '';

/** Reading a STORED address: an unrecognised governorate is kept verbatim. A record written
 *  before the catalog existed must not be blanked by the act of opening it for editing. */
const storedGovernorate = (value: string): string => toCatalogGovernorate(value) || value.trim();

const fromDto = (a: ApplicantDto): FormState => ({
  sourceId: a.sourceId,
  intakeChannel: a.intakeChannel,
  fullNameAr: a.fullNameAr,
  fullNameEn: a.fullNameEn ?? '',
  nationalId: '',
  nationality: a.nationality,
  maritalStatus: a.maritalStatus ?? '',
  religion: a.religion ?? '',
  nationalIdExpiry: a.nationalIdExpiry === null ? '' : a.nationalIdExpiry.slice(0, 10),
  dependentsCount: a.dependentsCount === null ? '' : String(a.dependentsCount),
  primaryPhone: a.contact.primaryPhone,
  secondaryPhone: a.contact.secondaryPhone ?? '',
  email: a.contact.email ?? '',
  preferredContactChannel: a.contact.preferredContactChannel ?? '',
  officialAddress:
    a.officialAddress === null
      ? emptyAddress()
      : {
          ...emptyAddress(),
          ...a.officialAddress,
          governorate: storedGovernorate(a.officialAddress.governorate),
          line2: a.officialAddress.line2 ?? '',
          postalCode: a.officialAddress.postalCode ?? '',
        },
  currentAddress:
    a.currentAddress === null
      ? emptyAddress()
      : {
          ...emptyAddress(),
          ...a.currentAddress,
          governorate: storedGovernorate(a.currentAddress.governorate),
          line2: a.currentAddress.line2 ?? '',
          postalCode: a.currentAddress.postalCode ?? '',
        },
  expectedSalaryAmount: a.expectedSalary === null ? '' : String(a.expectedSalary.amount),
  expectedSalaryCurrency: a.expectedSalary?.currency ?? 'EGP',
  earliestStartDate: a.earliestStartDate === null ? '' : a.earliestStartDate.slice(0, 10),
  willingToRelocate: a.willingToRelocate,
  willingToTravel: a.willingToTravel,
  willingToShiftWork: a.willingToShiftWork,
  educationLevel: a.education?.level ?? '',
  educationInstitution: a.education?.institution ?? '',
  educationSpecialization: a.education?.specialization ?? '',
  educationGraduationYear:
    a.education?.graduationYear === undefined ? '' : String(a.education.graduationYear),
  educationGrade: a.education?.grade ?? '',
  militaryStatus: a.military?.status ?? '',
  militaryCompletedAt: a.military?.completedAt === undefined ? '' : a.military.completedAt.slice(0, 10),
  experience: a.experience.map((e) => ({
    employer: e.employer,
    position: e.position ?? '',
    from: e.from === undefined ? '' : e.from.slice(0, 10),
    to: e.to === undefined ? '' : e.to.slice(0, 10),
    leavingReason: e.leavingReason ?? '',
  })),
  drivingLicenses: a.drivingLicenses.map((l) => ({
    class: l.class,
    expiry: l.expiry === undefined ? '' : l.expiry.slice(0, 10),
  })),
  references: a.references.map((r) => ({
    name: r.name,
    relationship: r.relationship ?? '',
    phone: r.phone ?? '',
  })),
  certifications: a.certifications.join(', '),
});

const emptyForm = (): FormState => ({
  sourceId: '',
  intakeChannel: 'internal',
  fullNameAr: '',
  fullNameEn: '',
  nationalId: '',
  nationality: NATIONALITY_EGYPTIAN,
  maritalStatus: '',
  religion: '',
  nationalIdExpiry: '',
  dependentsCount: '',
  primaryPhone: '',
  secondaryPhone: '',
  email: '',
  preferredContactChannel: '',
  officialAddress: emptyAddress(),
  currentAddress: emptyAddress(),
  expectedSalaryAmount: '',
  expectedSalaryCurrency: 'EGP',
  earliestStartDate: '',
  willingToRelocate: false,
  willingToTravel: false,
  willingToShiftWork: false,
  educationLevel: '',
  educationInstitution: '',
  educationSpecialization: '',
  educationGraduationYear: '',
  educationGrade: '',
  militaryStatus: '',
  militaryCompletedAt: '',
  experience: [],
  drivingLicenses: [],
  references: [],
  certifications: '',
});

const str = (v: string): string | undefined => (v.trim() === '' ? undefined : v.trim());
const num = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v));

const buildAddress = (a: AddressForm): Address | undefined => {
  if (a.line1.trim() === '' || a.city.trim() === '' || a.governorate.trim() === '') return undefined;
  return {
    line1: a.line1.trim(),
    city: a.city.trim(),
    governorate: a.governorate.trim(),
    ...(str(a.line2) === undefined ? {} : { line2: a.line2.trim() }),
    ...(str(a.postalCode) === undefined ? {} : { postalCode: a.postalCode.trim() }),
  };
};

const buildCommon = (f: FormState): Record<string, unknown> => {
  const official = buildAddress(f.officialAddress);
  const current = buildAddress(f.currentAddress);
  const experience = f.experience
    .filter((e) => e.employer.trim() !== '')
    .map((e) => ({
      employer: e.employer.trim(),
      ...(str(e.position) ? { position: e.position.trim() } : {}),
      ...(str(e.from) ? { from: e.from } : {}),
      ...(str(e.to) ? { to: e.to } : {}),
      ...(str(e.leavingReason) ? { leavingReason: e.leavingReason.trim() } : {}),
    }));
  const drivingLicenses = f.drivingLicenses
    .filter((l) => l.class.trim() !== '')
    .map((l) => ({ class: l.class.trim(), ...(str(l.expiry) ? { expiry: l.expiry } : {}) }));
  const references = f.references
    .filter((r) => r.name.trim() !== '')
    .map((r) => ({
      name: r.name.trim(),
      ...(str(r.relationship) ? { relationship: r.relationship.trim() } : {}),
      ...(str(r.phone) ? { phone: r.phone.trim() } : {}),
    }));
  const certifications = f.certifications
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== '');
  return {
    fullNameAr: f.fullNameAr.trim(),
    ...(str(f.fullNameEn) ? { fullNameEn: f.fullNameEn.trim() } : {}),
    contact: {
      primaryPhone: f.primaryPhone.trim(),
      ...(str(f.secondaryPhone) ? { secondaryPhone: f.secondaryPhone.trim() } : {}),
      ...(str(f.email) ? { email: f.email.trim() } : {}),
      ...(f.preferredContactChannel === '' ? {} : { preferredContactChannel: f.preferredContactChannel }),
    },
    ...(official === undefined ? {} : { officialAddress: official }),
    ...(current === undefined ? {} : { currentAddress: current }),
    ...(num(f.expectedSalaryAmount) === undefined
      ? {}
      : { expectedSalary: { amount: num(f.expectedSalaryAmount), currency: f.expectedSalaryCurrency } }),
    ...(str(f.earliestStartDate) ? { earliestStartDate: f.earliestStartDate } : {}),
    willingToRelocate: f.willingToRelocate,
    willingToTravel: f.willingToTravel,
    willingToShiftWork: f.willingToShiftWork,
    ...(f.educationLevel === ''
      ? {}
      : {
          education: {
            level: f.educationLevel,
            ...(str(f.educationInstitution) ? { institution: f.educationInstitution.trim() } : {}),
            ...(str(f.educationSpecialization)
              ? { specialization: f.educationSpecialization.trim() }
              : {}),
            ...(num(f.educationGraduationYear) === undefined
              ? {}
              : { graduationYear: num(f.educationGraduationYear) }),
            ...(str(f.educationGrade) ? { grade: f.educationGrade.trim() } : {}),
          },
        }),
    ...(f.militaryStatus === ''
      ? {}
      : {
          military: {
            status: f.militaryStatus,
            ...(str(f.militaryCompletedAt) ? { completedAt: f.militaryCompletedAt } : {}),
          },
        }),
    ...(experience.length > 0 ? { experience } : {}),
    ...(drivingLicenses.length > 0 ? { drivingLicenses } : {}),
    ...(references.length > 0 ? { references } : {}),
    ...(certifications.length > 0 ? { certifications } : {}),
  };
};

export const ApplicantForm = ({
  mode,
  initial,
  sources,
  submitting,
  presetRequisitionId,
  presetBranchId,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial?: ApplicantDto;
  sources: ApplicantSourceDto[];
  submitting: boolean;
  /** Supplied by context (URL) for create — the future Requisitions screen deep-links here. */
  presetRequisitionId?: string | undefined;
  presetBranchId?: string | undefined;
  onSubmit: (body: RegisterApplicant | UpdateApplicant) => Promise<void>;
  onCancel: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const [f, setF] = useState<FormState>(initial === undefined ? emptyForm() : fromDto(initial));
  const [errors, setErrors] = useState<{ field?: string; message: string }[]>([]);
  const [fieldErr, setFieldErr] = useState<FieldErrors>({});

  const [extracted, setExtracted] = useState(false);

  const set = (patch: Partial<FormState>): void => setF((prev) => ({ ...prev, ...patch }));
  const setAddr = (which: 'officialAddress' | 'currentAddress', patch: Partial<AddressForm>): void =>
    setF((prev) => ({ ...prev, [which]: { ...prev[which], ...patch } }));

  /**
   * Tidy a phone the moment its field is left: "+20 10 1234-5678" and "٠١٠١٢٣٤٥٦٧٨" are the same
   * number as "01012345678", and the server stores the tidy form either way — so the field should
   * show what will actually be saved rather than leave the two disagreeing.
   */
  const tidyPhone = (which: 'primaryPhone' | 'secondaryPhone'): void =>
    setF((prev) => {
      const clean = normalizeEgyptianPhone(prev[which]);
      return clean === null || clean === prev[which] ? prev : { ...prev, [which]: clean };
    });

  /** Check one field and keep — or clear — its message. Called when the field loses focus. */
  const check = (name: FieldName, value: string): void =>
    setFieldErr((prev) => {
      const problem = validateField(name, value, mode);
      if (problem === prev[name]) return prev;
      const next = { ...prev };
      if (problem === undefined) delete next[name];
      else next[name] = problem;
      return next;
    });

  /** Wire a text field: id for the jump-to-error scroll, red ring + message, on-blur check. */
  const bind = (
    name: FieldName,
    value: string,
  ): { id: string; error: boolean; onBlur: () => void } => ({
    id: name,
    error: fieldErr[name] !== undefined,
    onBlur: () => check(name, value),
  });
  const msg = (name: FieldName): string | undefined => {
    const key = fieldErr[name];
    return key === undefined ? undefined : t(key);
  };

  // Deterministic National-ID derivation (birth date / gender / governorate) — computed from the
  // number, never OCR'd. Recomputes live as the number is typed or extracted (§ value-objects).
  const derived = parseNationalId(f.nationalId.trim());

  // Setting the Arabic name auto-suggests an English transliteration ONLY while the English field
  // is still empty — never clobbering a value the user (or OCR) already provided. Editable after.
  const setArabicName = (value: string): void =>
    setF((prev) => ({
      ...prev,
      fullNameAr: value,
      fullNameEn: prev.fullNameEn.trim() === '' ? transliterateArabicName(value) : prev.fullNameEn,
    }));

  /** Populate the form from the reviewed National-ID data (after the user confirms the OCR review).
   *  Reviewed values win; empty fields leave the current form value untouched. */
  const applyReview = (r: NationalIdReviewData): void => {
    setExtracted(true);
    setF((prev) => {
      // The card's governorate arrives as free text (or as an English name derived from the
      // number); resolve it to the catalog so the city list below it is the right one.
      const governorate = toCatalogGovernorate(r.governorate) || prev.officialAddress.governorate;
      const city = r.city.trim();
      return {
        ...prev,
        fullNameAr: r.fullNameAr.trim() === '' ? prev.fullNameAr : r.fullNameAr.trim(),
        fullNameEn: r.fullNameEn.trim() === '' ? prev.fullNameEn : r.fullNameEn.trim(),
        nationalId: r.nationalId.trim() === '' ? prev.nationalId : r.nationalId.trim(),
        ...(r.maritalStatus === '' ? {} : { maritalStatus: r.maritalStatus }),
        religion: normalizeReligion(r.religion) ?? prev.religion,
        nationalIdExpiry: r.nationalIdExpiry === '' ? prev.nationalIdExpiry : r.nationalIdExpiry,
        officialAddress: {
          ...prev.officialAddress,
          line1: r.addressLine.trim() === '' ? prev.officialAddress.line1 : r.addressLine.trim(),
          governorate,
          // Only keep the read city when the catalog agrees it belongs to that governorate;
          // otherwise leave the picker empty rather than store a place that does not exist.
          city: citiesOfGovernorate(governorate).includes(city) ? city : prev.officialAddress.city,
        },
      };
    });
  };

  const submit = async (): Promise<void> => {
    const found = validateForm(f, mode);
    setFieldErr(found);
    const first = firstErrorField(found);
    if (first !== undefined) {
      const el = document.getElementById(first);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (el as HTMLElement | null)?.focus?.({ preventScroll: true });
      return;
    }

    const common = buildCommon(f);
    let body: RegisterApplicant | UpdateApplicant;
    if (mode === 'create') {
      const identity = {
        fullNameAr: f.fullNameAr.trim(),
        ...(str(f.fullNameEn) ? { fullNameEn: f.fullNameEn.trim() } : {}),
        ...(str(f.nationalId) ? { nationalId: f.nationalId.trim() } : {}),
        nationality: f.nationality.trim() === '' ? NATIONALITY_EGYPTIAN : f.nationality.trim(),
        ...(f.maritalStatus === '' ? {} : { maritalStatus: f.maritalStatus }),
        ...(str(f.religion) ? { religion: f.religion.trim() } : {}),
        ...(str(f.nationalIdExpiry) ? { nationalIdExpiry: f.nationalIdExpiry } : {}),
        ...(num(f.dependentsCount) === undefined ? {} : { dependentsCount: num(f.dependentsCount) }),
      };
      const rest = Object.fromEntries(
        Object.entries(common).filter(([k]) => k !== 'fullNameAr' && k !== 'fullNameEn'),
      );
      body = {
        // Requisition is OPTIONAL — a direct intake has no linked Job Request; it is only sent
        // when provided by context (the future Requisitions screen deep-links here).
        ...(presetRequisitionId !== undefined && presetRequisitionId.trim() !== ''
          ? { jobRequisitionId: presetRequisitionId.trim() }
          : {}),
        ...(presetBranchId !== undefined && presetBranchId.trim() !== '' ? { branchId: presetBranchId.trim() } : {}),
        sourceId: f.sourceId,
        intakeChannel: f.intakeChannel,
        identity,
        ...rest,
      } as unknown as RegisterApplicant;
    } else {
      body = { ...common, version: initial?.version ?? 0 } as unknown as UpdateApplicant;
    }

    try {
      setErrors([]);
      await onSubmit(body);
    } catch (error) {
      setErrors(validationDetails(error));
    }
  };

  const sectionCls = 'grid grid-cols-1 gap-4 sm:grid-cols-2';

  /** Address block — governorate first, then the cities that belong to it (§ owner request). */
  const addressBlock = (which: 'officialAddress' | 'currentAddress'): JSX.Element => {
    const a = f[which];
    const cities = citiesOfGovernorate(a.governorate);
    return (
      <div key={which}>
        <p className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
          {t(`applicants.form.${which}`)}
        </p>
        <div className={sectionCls}>
          <Field label={t('applicants.form.governorate')} error={msg(`${which}.governorate`)}>
            <Combobox
              id={`${which}.governorate`}
              value={a.governorate}
              options={GOVERNORATE_NAMES}
              onChange={(governorate) =>
                // Only a real change invalidates the city; re-picking the same governorate
                // (or clearing the box and choosing it again) must not throw a valid city away.
                setAddr(which, governorate === a.governorate ? { governorate } : { governorate, city: '' })
              }
              onBlur={() => check(`${which}.governorate`, a.governorate)}
              error={fieldErr[`${which}.governorate`] !== undefined}
              placeholder={t('applicants.form.selectGovernorate')}
              emptyText={t('common.noResults')}
              clearLabel={t('common.clear')}
            />
          </Field>
          <Field
            label={t('applicants.form.city')}
            error={msg(`${which}.city`)}
            hint={a.governorate === '' ? t('applicants.form.cityNeedsGovernorate') : undefined}
          >
            <Combobox
              id={`${which}.city`}
              value={a.city}
              options={cities}
              onChange={(city) => setAddr(which, { city })}
              onBlur={() => check(`${which}.city`, a.city)}
              error={fieldErr[`${which}.city`] !== undefined}
              disabled={a.governorate === ''}
              placeholder={t('applicants.form.selectCity')}
              emptyText={t('common.noResults')}
              clearLabel={t('common.clear')}
            />
          </Field>
          <Field label={t('applicants.form.line1')} error={msg(`${which}.line1`)}>
            <Input
              value={a.line1}
              onChange={(e) => setAddr(which, { line1: e.target.value })}
              {...bind(`${which}.line1`, a.line1)}
            />
          </Field>
          <Field label={t('applicants.form.line2')}>
            <Input value={a.line2} onChange={(e) => setAddr(which, { line2: e.target.value })} />
          </Field>
          <Field
            label={t('applicants.form.postalCode')}
            error={msg(`${which}.postalCode`)}
            hint={t('applicants.form.postalCodeHint')}
          >
            <Input
              value={a.postalCode}
              // Digits only, five of them: pasting a mixed string keeps its digits rather than
              // letting `maxLength` clip the letters first and swallow most of the number.
              onChange={(e) =>
                setAddr(which, {
                  postalCode: asciiDigits(e.target.value).replace(/\D/g, '').slice(0, 5),
                })
              }
              dir="ltr"
              inputMode="numeric"
              {...bind(`${which}.postalCode`, a.postalCode)}
            />
          </Field>
        </div>
      </div>
    );
  };

  return (
    <Form onSubmit={() => void submit()}>
      {errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          <p className="mb-1 font-medium">{t('applicants.form.serverErrors')}</p>
          <ul className="list-inside list-disc space-y-0.5">
            {errors.map((e, i) => (
              <li key={i}>{e.field !== undefined ? `${e.field}: ${e.message}` : e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'create' && (
        <>
          <ApplicantNationalIdOcr onConfirm={applyReview} />
          {extracted && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              {t('applicants.ocr.reviewBanner')}
            </p>
          )}
          <Card>
            <CardHeader title={t('applicants.form.context')} description={t('applicants.form.contextHint')} />
            <CardBody className="space-y-4">
              <div className={sectionCls}>
                <ReferenceField kind="requisition" value={presetRequisitionId} />
                <ReferenceField kind="branch" value={presetBranchId} />
                <Field label={t('applicants.form.source')} required error={msg('sourceId')}>
                  <Select
                    id="sourceId"
                    value={f.sourceId}
                    error={fieldErr.sourceId !== undefined}
                    onChange={(e) => {
                      set({ sourceId: e.target.value });
                      check('sourceId', e.target.value);
                    }}
                    onBlur={() => check('sourceId', f.sourceId)}
                  >
                    <option value="">{t('applicants.form.selectSource')}</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>{localized(s.name, locale)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('applicants.form.channel')}>
                  <Select value={f.intakeChannel} onChange={(e) => set({ intakeChannel: e.target.value as ApplicantIntakeChannel })}>
                    {APPLICANT_INTAKE_CHANNELS.map((c) => (
                      <option key={c} value={c}>{t(`applicants.channel.${c}`)}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            </CardBody>
          </Card>
        </>
      )}

      <Card>
        <CardHeader title={t('applicants.form.identity')} />
        <CardBody className={sectionCls}>
          <Field
            label={t('applicants.form.fullNameAr')}
            required
            error={msg('fullNameAr')}
            hint={t('applicants.form.fullNameArHint')}
          >
            <Input
              value={f.fullNameAr}
              onChange={(e) => (mode === 'create' ? setArabicName(e.target.value) : set({ fullNameAr: e.target.value }))}
              {...bind('fullNameAr', f.fullNameAr)}
            />
          </Field>
          <Field
            label={t('applicants.form.fullNameEn')}
            error={msg('fullNameEn')}
            hint={mode === 'create' ? t('applicants.form.fullNameEnHint') : undefined}
          >
            <Input
              value={f.fullNameEn}
              onChange={(e) => set({ fullNameEn: e.target.value })}
              dir="ltr"
              {...bind('fullNameEn', f.fullNameEn)}
            />
          </Field>
          {mode === 'create' && (
            <>
              <Field
                label={t('applicants.form.nationalId')}
                error={msg('nationalId')}
                hint={t('applicants.form.nationalIdHint')}
              >
                <Input
                  value={f.nationalId}
                  onChange={(e) => set({ nationalId: asciiDigits(e.target.value).replace(/\D/g, '') })}
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={14}
                  {...bind('nationalId', f.nationalId)}
                />
              </Field>
              <Field label={t('applicants.form.nationality')}>
                <Select value={f.nationality} onChange={(e) => set({ nationality: e.target.value })}>
                  {Object.entries(NATIONALITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{locale === 'ar' ? label.ar : label.en}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('applicants.form.maritalStatus')}>
                <Select value={f.maritalStatus} onChange={(e) => set({ maritalStatus: e.target.value as FormState['maritalStatus'] })}>
                  <option value="">{t('applicants.form.unspecified')}</option>
                  {MARITAL_STATUSES.map((m) => (
                    <option key={m} value={m}>{t(`applicants.marital.${m}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('applicants.form.religion')}>
                <Select value={f.religion} onChange={(e) => set({ religion: e.target.value })}>
                  <option value="">{t('applicants.form.unspecified')}</option>
                  {RELIGIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                  {/* A legacy value the catalog does not carry stays selectable rather than
                      silently turning into "unspecified" the next time the record is saved. */}
                  {f.religion !== '' && !RELIGIONS.some((r) => r === f.religion) && (
                    <option value={f.religion}>{f.religion}</option>
                  )}
                </Select>
              </Field>
              <Field label={t('applicants.form.nationalIdExpiry')}>
                <Input type="date" value={f.nationalIdExpiry} onChange={(e) => set({ nationalIdExpiry: e.target.value })} dir="ltr" />
              </Field>
              <Field label={t('applicants.form.dependents')} error={msg('dependentsCount')}>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={f.dependentsCount}
                  onChange={(e) => set({ dependentsCount: e.target.value })}
                  {...bind('dependentsCount', f.dependentsCount)}
                />
              </Field>
              {derived !== null && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40 sm:col-span-2">
                  <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t('applicants.form.derivedFromNid')}
                  </p>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                    <div className="flex justify-between gap-2 sm:block">
                      <dt className="text-slate-500 dark:text-slate-400">{t('applicants.detail.birthDate')}</dt>
                      <dd className="font-medium text-slate-700 dark:text-slate-200">{formatDate(derived.birthDate.toISOString(), locale)}</dd>
                    </div>
                    <div className="flex justify-between gap-2 sm:block">
                      <dt className="text-slate-500 dark:text-slate-400">{t('applicants.detail.gender')}</dt>
                      <dd className="font-medium text-slate-700 dark:text-slate-200">{t(`applicants.gender.${derived.gender}`)}</dd>
                    </div>
                    <div className="flex justify-between gap-2 sm:block">
                      <dt className="text-slate-500 dark:text-slate-400">{t('applicants.detail.governorate')}</dt>
                      <dd className="font-medium text-slate-700 dark:text-slate-200">
                        {findGovernorate(derived.governorate)?.ar ?? derived.governorate}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('applicants.form.contact')} />
        <CardBody className={sectionCls}>
          <Field
            label={t('applicants.form.primaryPhone')}
            required
            error={msg('primaryPhone')}
            hint={t('applicants.form.phoneHint')}
          >
            <Input
              value={f.primaryPhone}
              onChange={(e) => set({ primaryPhone: e.target.value })}
              dir="ltr"
              inputMode="tel"
              {...bind('primaryPhone', f.primaryPhone)}
              onBlur={() => {
                tidyPhone('primaryPhone');
                check('primaryPhone', f.primaryPhone);
              }}
            />
          </Field>
          <Field label={t('applicants.form.secondaryPhone')} error={msg('secondaryPhone')}>
            <Input
              value={f.secondaryPhone}
              onChange={(e) => set({ secondaryPhone: e.target.value })}
              dir="ltr"
              inputMode="tel"
              {...bind('secondaryPhone', f.secondaryPhone)}
              onBlur={() => {
                tidyPhone('secondaryPhone');
                check('secondaryPhone', f.secondaryPhone);
              }}
            />
          </Field>
          <Field label={t('applicants.form.email')} error={msg('email')}>
            <Input
              type="email"
              value={f.email}
              onChange={(e) => set({ email: e.target.value })}
              dir="ltr"
              {...bind('email', f.email)}
            />
          </Field>
          <Field label={t('applicants.form.preferredChannel')}>
            <Select value={f.preferredContactChannel} onChange={(e) => set({ preferredContactChannel: e.target.value as FormState['preferredContactChannel'] })}>
              <option value="">{t('applicants.form.unspecified')}</option>
              {CONTACT_CHANNELS.map((c) => (
                <option key={c} value={c}>{t(`applicants.contactChannel.${c}`)}</option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('applicants.form.addresses')} />
        <CardBody className="space-y-4">
          {(['officialAddress', 'currentAddress'] as const).map(addressBlock)}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('applicants.form.preferences')} />
        <CardBody className="space-y-4">
          <div className={sectionCls}>
            <Field label={t('applicants.form.expectedSalary')} error={msg('expectedSalaryAmount')}>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  value={f.expectedSalaryAmount}
                  onChange={(e) => set({ expectedSalaryAmount: e.target.value })}
                  {...bind('expectedSalaryAmount', f.expectedSalaryAmount)}
                />
                <Input className="w-24" value={f.expectedSalaryCurrency} onChange={(e) => set({ expectedSalaryCurrency: e.target.value })} dir="ltr" />
              </div>
            </Field>
            <Field label={t('applicants.form.earliestStart')}>
              <Input type="date" value={f.earliestStartDate} onChange={(e) => set({ earliestStartDate: e.target.value })} dir="ltr" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <Checkbox label={t('applicants.form.willingRelocate')} checked={f.willingToRelocate} onChange={(e) => set({ willingToRelocate: e.target.checked })} />
            <Checkbox label={t('applicants.form.willingTravel')} checked={f.willingToTravel} onChange={(e) => set({ willingToTravel: e.target.checked })} />
            <Checkbox label={t('applicants.form.willingShift')} checked={f.willingToShiftWork} onChange={(e) => set({ willingToShiftWork: e.target.checked })} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('applicants.form.education')} />
        <CardBody className={sectionCls}>
          <Field label={t('applicants.form.educationLevel')}>
            <Select value={f.educationLevel} onChange={(e) => set({ educationLevel: e.target.value as FormState['educationLevel'] })}>
              <option value="">{t('applicants.form.unspecified')}</option>
              {EDUCATION_LEVELS.map((l) => (
                <option key={l} value={l}>{t(`applicants.education.${l}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('applicants.form.institution')}>
            <Input value={f.educationInstitution} onChange={(e) => set({ educationInstitution: e.target.value })} />
          </Field>
          <Field label={t('applicants.form.specialization')}>
            <Input value={f.educationSpecialization} onChange={(e) => set({ educationSpecialization: e.target.value })} />
          </Field>
          <Field label={t('applicants.form.graduationYear')} error={msg('educationGraduationYear')}>
            <Input
              type="number"
              min={1950}
              max={2100}
              value={f.educationGraduationYear}
              onChange={(e) => set({ educationGraduationYear: e.target.value })}
              dir="ltr"
              {...bind('educationGraduationYear', f.educationGraduationYear)}
            />
          </Field>
          <Field label={t('applicants.form.grade')}>
            <Input value={f.educationGrade} onChange={(e) => set({ educationGrade: e.target.value })} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('applicants.form.military')} />
        <CardBody className={sectionCls}>
          <Field label={t('applicants.form.militaryStatus')}>
            <Select value={f.militaryStatus} onChange={(e) => set({ militaryStatus: e.target.value as FormState['militaryStatus'] })}>
              <option value="">{t('applicants.form.unspecified')}</option>
              {MILITARY_STATUSES.map((m) => (
                <option key={m} value={m}>{t(`applicants.military.${m}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('applicants.form.completedAt')}>
            <Input type="date" value={f.militaryCompletedAt} onChange={(e) => set({ militaryCompletedAt: e.target.value })} dir="ltr" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('applicants.form.experience')}
          actions={
            <Button size="sm" variant="secondary" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => set({ experience: [...f.experience, { employer: '', position: '', from: '', to: '', leavingReason: '' }] })}>
              {t('applicants.form.addRow')}
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {f.experience.length === 0 && <p className="text-sm text-slate-400">{t('applicants.form.noRows')}</p>}
          {f.experience.map((row, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-5">
              <Input placeholder={t('applicants.form.employer')} value={row.employer} onChange={(e) => set({ experience: f.experience.map((r, idx) => (idx === i ? { ...r, employer: e.target.value } : r)) })} />
              <Input placeholder={t('applicants.form.position')} value={row.position} onChange={(e) => set({ experience: f.experience.map((r, idx) => (idx === i ? { ...r, position: e.target.value } : r)) })} />
              <Input type="date" value={row.from} onChange={(e) => set({ experience: f.experience.map((r, idx) => (idx === i ? { ...r, from: e.target.value } : r)) })} dir="ltr" />
              <Input type="date" value={row.to} onChange={(e) => set({ experience: f.experience.map((r, idx) => (idx === i ? { ...r, to: e.target.value } : r)) })} dir="ltr" />
              <div className="flex gap-1">
                <Input placeholder={t('applicants.form.leavingReason')} value={row.leavingReason} onChange={(e) => set({ experience: f.experience.map((r, idx) => (idx === i ? { ...r, leavingReason: e.target.value } : r)) })} />
                <Button size="sm" variant="ghost" onClick={() => set({ experience: f.experience.filter((_, idx) => idx !== i) })} aria-label={t('common.remove')}>
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('applicants.form.references')}
          actions={
            <Button size="sm" variant="secondary" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => set({ references: [...f.references, { name: '', relationship: '', phone: '' }] })}>
              {t('applicants.form.addRow')}
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {f.references.length === 0 && <p className="text-sm text-slate-400">{t('applicants.form.noRows')}</p>}
          {f.references.map((row, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-4">
              <Input placeholder={t('applicants.form.refName')} value={row.name} onChange={(e) => set({ references: f.references.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)) })} />
              <Input placeholder={t('applicants.form.relationship')} value={row.relationship} onChange={(e) => set({ references: f.references.map((r, idx) => (idx === i ? { ...r, relationship: e.target.value } : r)) })} />
              <Input placeholder={t('applicants.form.phone')} value={row.phone} onChange={(e) => set({ references: f.references.map((r, idx) => (idx === i ? { ...r, phone: e.target.value } : r)) })} dir="ltr" />
              <Button size="sm" variant="ghost" onClick={() => set({ references: f.references.filter((_, idx) => idx !== i) })} aria-label={t('common.remove')}>
                <TrashIcon className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Driving licences and certificates are separate records of separate things — a licence has
          a class and an expiry the Fleet module reads; a certificate is a line of prose. They used
          to share a card, which read as though one were a kind of the other. */}
      <Card>
        <CardHeader
          title={t('applicants.form.licenses')}
          description={t('applicants.form.licensesHint')}
          actions={
            <Button size="sm" variant="secondary" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => set({ drivingLicenses: [...f.drivingLicenses, { class: '', expiry: '' }] })}>
              {t('applicants.form.addRow')}
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {f.drivingLicenses.length === 0 && <p className="text-sm text-slate-400">{t('applicants.form.noRows')}</p>}
          {f.drivingLicenses.map((row, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-3">
              <Input placeholder={t('applicants.form.licenseClass')} value={row.class} onChange={(e) => set({ drivingLicenses: f.drivingLicenses.map((r, idx) => (idx === i ? { ...r, class: e.target.value } : r)) })} />
              <Input type="date" value={row.expiry} onChange={(e) => set({ drivingLicenses: f.drivingLicenses.map((r, idx) => (idx === i ? { ...r, expiry: e.target.value } : r)) })} dir="ltr" />
              <Button size="sm" variant="ghost" onClick={() => set({ drivingLicenses: f.drivingLicenses.filter((_, idx) => idx !== i) })} aria-label={t('common.remove')}>
                <TrashIcon className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('applicants.form.certifications')} />
        <CardBody>
          <Field label={t('applicants.form.certifications')} hint={t('applicants.form.certificationsHint')}>
            <Input value={f.certifications} onChange={(e) => set({ certifications: e.target.value })} />
          </Field>
        </CardBody>
      </Card>

      <FormActions>
        <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" loading={submitting}>
          {mode === 'create' ? t('applicants.actions.create') : t('common.save')}
        </Button>
      </FormActions>
    </Form>
  );
};
