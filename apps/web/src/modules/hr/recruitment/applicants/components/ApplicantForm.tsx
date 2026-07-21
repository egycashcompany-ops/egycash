// Applicant create/edit form (manual entry + OCR assist). Reuses the shared form primitives.
// Client-side checks cover the always-required fields; the server remains the authoritative
// validator and its field errors are surfaced in a summary. Builds a RegisterApplicant (create)
// or UpdateApplicant (edit) payload; identity number / nationality are create-only (edits to the
// National ID go through the dedicated verify-identity flow).
import { useState } from 'react';
import {
  APPLICANT_INTAKE_CHANNELS,
  CONTACT_CHANNELS,
  EDUCATION_LEVELS,
  MARITAL_STATUSES,
  MILITARY_STATUSES,
  parseNationalId,
  type Address,
  type ApplicantDto,
  type ApplicantIntakeChannel,
  type ApplicantSourceDto,
  type ContactChannel,
  type EducationLevel,
  type MaritalStatus,
  type MilitaryStatus,
  type RegisterApplicant,
  type UpdateApplicant,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { localized, formatDate } from '../../../../../shared/lib/format';
import { validationDetails } from '../../../../../shared/lib/errors';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Input, Select, Checkbox, Form, FormActions } from '../../../../../shared/ui/form';
import { PlusIcon, TrashIcon } from '../../../../../shared/ui/icons';
import { transliterateArabicName, type NationalIdReviewData } from '../../../../../shared/national-id';
import { ApplicantNationalIdOcr } from './ApplicantNationalIdOcr';
import { ReferenceField } from './RefPickers';

interface AddressForm {
  line1: string;
  line2: string;
  city: string;
  governorate: string;
  postalCode: string;
}
const emptyAddress = (): AddressForm => ({ line1: '', line2: '', city: '', governorate: '', postalCode: '' });

interface ExperienceRow {
  employer: string;
  position: string;
  from: string;
  to: string;
  leavingReason: string;
}
interface LicenseRow {
  class: string;
  expiry: string;
}
interface ReferenceRow {
  name: string;
  relationship: string;
  phone: string;
}

interface FormState {
  sourceId: string;
  intakeChannel: ApplicantIntakeChannel;
  fullNameAr: string;
  fullNameEn: string;
  nationalId: string;
  nationality: string;
  maritalStatus: '' | MaritalStatus;
  religion: string;
  nationalIdExpiry: string;
  dependentsCount: string;
  primaryPhone: string;
  secondaryPhone: string;
  email: string;
  preferredContactChannel: '' | ContactChannel;
  officialAddress: AddressForm;
  currentAddress: AddressForm;
  expectedSalaryAmount: string;
  expectedSalaryCurrency: string;
  earliestStartDate: string;
  willingToRelocate: boolean;
  willingToTravel: boolean;
  willingToShiftWork: boolean;
  educationLevel: '' | EducationLevel;
  educationInstitution: string;
  educationSpecialization: string;
  educationGraduationYear: string;
  educationGrade: string;
  militaryStatus: '' | MilitaryStatus;
  militaryCertificateRef: string;
  militaryCompletedAt: string;
  experience: ExperienceRow[];
  drivingLicenses: LicenseRow[];
  references: ReferenceRow[];
  certifications: string;
}

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
  officialAddress: a.officialAddress === null ? emptyAddress() : { ...emptyAddress(), ...a.officialAddress, line2: a.officialAddress.line2 ?? '', postalCode: a.officialAddress.postalCode ?? '' },
  currentAddress: a.currentAddress === null ? emptyAddress() : { ...emptyAddress(), ...a.currentAddress, line2: a.currentAddress.line2 ?? '', postalCode: a.currentAddress.postalCode ?? '' },
  expectedSalaryAmount: a.expectedSalary === null ? '' : String(a.expectedSalary.amount),
  expectedSalaryCurrency: a.expectedSalary?.currency ?? 'EGP',
  earliestStartDate: a.earliestStartDate === null ? '' : a.earliestStartDate.slice(0, 10),
  willingToRelocate: a.willingToRelocate,
  willingToTravel: a.willingToTravel,
  willingToShiftWork: a.willingToShiftWork,
  educationLevel: a.education?.level ?? '',
  educationInstitution: a.education?.institution ?? '',
  educationSpecialization: a.education?.specialization ?? '',
  educationGraduationYear: a.education?.graduationYear === undefined ? '' : String(a.education.graduationYear),
  educationGrade: a.education?.grade ?? '',
  militaryStatus: a.military?.status ?? '',
  militaryCertificateRef: a.military?.certificateRef ?? '',
  militaryCompletedAt: a.military?.completedAt === undefined ? '' : a.military.completedAt.slice(0, 10),
  experience: a.experience.map((e) => ({
    employer: e.employer,
    position: e.position ?? '',
    from: e.from === undefined ? '' : e.from.slice(0, 10),
    to: e.to === undefined ? '' : e.to.slice(0, 10),
    leavingReason: e.leavingReason ?? '',
  })),
  drivingLicenses: a.drivingLicenses.map((l) => ({ class: l.class, expiry: l.expiry === undefined ? '' : l.expiry.slice(0, 10) })),
  references: a.references.map((r) => ({ name: r.name, relationship: r.relationship ?? '', phone: r.phone ?? '' })),
  certifications: a.certifications.join(', '),
});

const emptyForm = (): FormState => ({
  sourceId: '',
  intakeChannel: 'internal',
  fullNameAr: '',
  fullNameEn: '',
  nationalId: '',
  nationality: 'Egyptian',
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
  militaryCertificateRef: '',
  militaryCompletedAt: '',
  experience: [],
  drivingLicenses: [],
  references: [],
  certifications: [].join(''),
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
    .map((e) => ({ employer: e.employer.trim(), ...(str(e.position) ? { position: e.position.trim() } : {}), ...(str(e.from) ? { from: e.from } : {}), ...(str(e.to) ? { to: e.to } : {}), ...(str(e.leavingReason) ? { leavingReason: e.leavingReason.trim() } : {}) }));
  const drivingLicenses = f.drivingLicenses
    .filter((l) => l.class.trim() !== '')
    .map((l) => ({ class: l.class.trim(), ...(str(l.expiry) ? { expiry: l.expiry } : {}) }));
  const references = f.references
    .filter((r) => r.name.trim() !== '')
    .map((r) => ({ name: r.name.trim(), ...(str(r.relationship) ? { relationship: r.relationship.trim() } : {}), ...(str(r.phone) ? { phone: r.phone.trim() } : {}) }));
  const certifications = f.certifications.split(',').map((c) => c.trim()).filter((c) => c !== '');
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
    ...(num(f.expectedSalaryAmount) === undefined ? {} : { expectedSalary: { amount: num(f.expectedSalaryAmount), currency: f.expectedSalaryCurrency } }),
    ...(str(f.earliestStartDate) ? { earliestStartDate: f.earliestStartDate } : {}),
    willingToRelocate: f.willingToRelocate,
    willingToTravel: f.willingToTravel,
    willingToShiftWork: f.willingToShiftWork,
    ...(f.educationLevel === '' ? {} : { education: { level: f.educationLevel, ...(str(f.educationInstitution) ? { institution: f.educationInstitution.trim() } : {}), ...(str(f.educationSpecialization) ? { specialization: f.educationSpecialization.trim() } : {}), ...(num(f.educationGraduationYear) === undefined ? {} : { graduationYear: num(f.educationGraduationYear) }), ...(str(f.educationGrade) ? { grade: f.educationGrade.trim() } : {}) } }),
    ...(f.militaryStatus === '' ? {} : { military: { status: f.militaryStatus, ...(str(f.militaryCertificateRef) ? { certificateRef: f.militaryCertificateRef.trim() } : {}), ...(str(f.militaryCompletedAt) ? { completedAt: f.militaryCompletedAt } : {}) } }),
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
  const [clientErr, setClientErr] = useState<Record<string, string>>({});

  const [extracted, setExtracted] = useState(false);

  const set = (patch: Partial<FormState>): void => setF((prev) => ({ ...prev, ...patch }));
  const setAddr = (which: 'officialAddress' | 'currentAddress', patch: Partial<AddressForm>): void =>
    setF((prev) => ({ ...prev, [which]: { ...prev[which], ...patch } }));

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
    setF((prev) => ({
      ...prev,
      fullNameAr: r.fullNameAr.trim() === '' ? prev.fullNameAr : r.fullNameAr.trim(),
      fullNameEn: r.fullNameEn.trim() === '' ? prev.fullNameEn : r.fullNameEn.trim(),
      nationalId: r.nationalId.trim() === '' ? prev.nationalId : r.nationalId.trim(),
      ...(r.maritalStatus === '' ? {} : { maritalStatus: r.maritalStatus }),
      religion: r.religion.trim() === '' ? prev.religion : r.religion.trim(),
      nationalIdExpiry: r.nationalIdExpiry === '' ? prev.nationalIdExpiry : r.nationalIdExpiry,
      officialAddress: {
        ...prev.officialAddress,
        line1: r.addressLine.trim() === '' ? prev.officialAddress.line1 : r.addressLine.trim(),
        city: r.city.trim() === '' ? prev.officialAddress.city : r.city.trim(),
        // Governorate is derived from the number (not OCR'd).
        governorate: r.governorate === '' ? prev.officialAddress.governorate : r.governorate,
      },
    }));
  };

  const submit = async (): Promise<void> => {
    const ce: Record<string, string> = {};
    if (f.fullNameAr.trim().length < 2) ce.fullNameAr = t('applicants.form.required');
    if (f.primaryPhone.trim() === '') ce.primaryPhone = t('applicants.form.required');
    if (mode === 'create') {
      if (f.sourceId === '') ce.sourceId = t('applicants.form.required');
    }
    setClientErr(ce);
    if (Object.keys(ce).length > 0) return;

    const common = buildCommon(f);
    let body: RegisterApplicant | UpdateApplicant;
    if (mode === 'create') {
      const identity = {
        fullNameAr: f.fullNameAr.trim(),
        ...(str(f.fullNameEn) ? { fullNameEn: f.fullNameEn.trim() } : {}),
        ...(str(f.nationalId) ? { nationalId: f.nationalId.trim() } : {}),
        nationality: f.nationality.trim() === '' ? 'Egyptian' : f.nationality.trim(),
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
                <Field label={t('applicants.form.source')} required error={clientErr.sourceId}>
                  <Select value={f.sourceId} onChange={(e) => set({ sourceId: e.target.value })}>
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
          <Field label={t('applicants.form.fullNameAr')} required error={clientErr.fullNameAr}>
            <Input value={f.fullNameAr} onChange={(e) => (mode === 'create' ? setArabicName(e.target.value) : set({ fullNameAr: e.target.value }))} />
          </Field>
          <Field label={t('applicants.form.fullNameEn')} hint={mode === 'create' ? t('applicants.form.fullNameEnHint') : undefined}>
            <Input value={f.fullNameEn} onChange={(e) => set({ fullNameEn: e.target.value })} dir="ltr" />
          </Field>
          {mode === 'create' && (
            <>
              <Field label={t('applicants.form.nationalId')} hint={t('applicants.form.nationalIdHint')}>
                <Input value={f.nationalId} onChange={(e) => set({ nationalId: e.target.value })} dir="ltr" inputMode="numeric" />
              </Field>
              <Field label={t('applicants.form.nationality')}>
                <Input value={f.nationality} onChange={(e) => set({ nationality: e.target.value })} />
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
                <Input value={f.religion} onChange={(e) => set({ religion: e.target.value })} />
              </Field>
              <Field label={t('applicants.form.nationalIdExpiry')}>
                <Input type="date" value={f.nationalIdExpiry} onChange={(e) => set({ nationalIdExpiry: e.target.value })} dir="ltr" />
              </Field>
              <Field label={t('applicants.form.dependents')}>
                <Input type="number" min={0} value={f.dependentsCount} onChange={(e) => set({ dependentsCount: e.target.value })} />
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
                      <dd className="font-medium text-slate-700 dark:text-slate-200">{derived.governorate}</dd>
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
          <Field label={t('applicants.form.primaryPhone')} required error={clientErr.primaryPhone}>
            <Input value={f.primaryPhone} onChange={(e) => set({ primaryPhone: e.target.value })} dir="ltr" inputMode="tel" />
          </Field>
          <Field label={t('applicants.form.secondaryPhone')}>
            <Input value={f.secondaryPhone} onChange={(e) => set({ secondaryPhone: e.target.value })} dir="ltr" inputMode="tel" />
          </Field>
          <Field label={t('applicants.form.email')}>
            <Input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} dir="ltr" />
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
          {(['officialAddress', 'currentAddress'] as const).map((which) => (
            <div key={which}>
              <p className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                {t(`applicants.form.${which}`)}
              </p>
              <div className={sectionCls}>
                <Field label={t('applicants.form.line1')}>
                  <Input value={f[which].line1} onChange={(e) => setAddr(which, { line1: e.target.value })} />
                </Field>
                <Field label={t('applicants.form.line2')}>
                  <Input value={f[which].line2} onChange={(e) => setAddr(which, { line2: e.target.value })} />
                </Field>
                <Field label={t('applicants.form.city')}>
                  <Input value={f[which].city} onChange={(e) => setAddr(which, { city: e.target.value })} />
                </Field>
                <Field label={t('applicants.form.governorate')}>
                  <Input value={f[which].governorate} onChange={(e) => setAddr(which, { governorate: e.target.value })} />
                </Field>
                <Field label={t('applicants.form.postalCode')}>
                  <Input value={f[which].postalCode} onChange={(e) => setAddr(which, { postalCode: e.target.value })} dir="ltr" />
                </Field>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('applicants.form.preferences')} />
        <CardBody className="space-y-4">
          <div className={sectionCls}>
            <Field label={t('applicants.form.expectedSalary')}>
              <div className="flex gap-2">
                <Input type="number" min={0} value={f.expectedSalaryAmount} onChange={(e) => set({ expectedSalaryAmount: e.target.value })} />
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
          <Field label={t('applicants.form.graduationYear')}>
            <Input type="number" min={1950} max={2100} value={f.educationGraduationYear} onChange={(e) => set({ educationGraduationYear: e.target.value })} dir="ltr" />
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
          <Field label={t('applicants.form.certificateRef')}>
            <Input value={f.militaryCertificateRef} onChange={(e) => set({ militaryCertificateRef: e.target.value })} />
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

      <Card>
        <CardHeader
          title={t('applicants.form.licenses')}
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
