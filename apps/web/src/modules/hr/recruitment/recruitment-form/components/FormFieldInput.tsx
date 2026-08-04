// One published field, rendered and checked.
//
// The rules are NOT re-stated here. A built-in field is mapped to the field name the applicant
// form already validates (`applicant-validation`), so "phone" means the same thing on a public
// page as it does in the recruiter's screen and on the server. A custom field has no column, so
// the only rule it can carry is "required", which the builder set.
import {
  RECRUITMENT_FORM_MANDATORY,
  citiesOfGovernorate,
  EDUCATION_LEVELS,
  EGYPT_GOVERNORATES,
  MARITAL_STATUSES,
  MILITARY_STATUSES,
  type Locale,
  type RecruitmentFormBuiltin,
  type RecruitmentFormField,
} from '@ecms/contracts';
import { Combobox } from '../../../../../shared/ui/Combobox';
import { Field, Input, Select, Checkbox } from '../../../../../shared/ui/form';
import { useT } from '../../../../../platform/localization/useT';
import { validateField, type FieldName } from '../../applicants/components/applicant-validation';

export type Answers = Record<string, string | boolean>;

/** Which already-validated field a built-in question is. `null` = nothing to check beyond required. */
const RULE_FOR: Partial<Record<RecruitmentFormBuiltin, FieldName>> = {
  fullNameAr: 'fullNameAr',
  fullNameEn: 'fullNameEn',
  nationalId: 'nationalId',
  primaryPhone: 'primaryPhone',
  secondaryPhone: 'secondaryPhone',
  email: 'email',
  addressLine1: 'officialAddress.line1',
  city: 'officialAddress.city',
  governorate: 'officialAddress.governorate',
  expectedSalary: 'expectedSalaryAmount',
};

export const isRequired = (field: RecruitmentFormField): boolean =>
  field.required ||
  (field.type === 'builtin' && RECRUITMENT_FORM_MANDATORY.includes(field.key));

/** The verdict on one answer, as an i18n key — the same keys the applicant form shows. */
export const checkAnswer = (field: RecruitmentFormField, answers: Answers): string | undefined => {
  const raw = answers[field.key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (isRequired(field)) {
    const answered = field.type === 'custom' && field.kind === 'checkbox' ? raw === true : value !== '';
    if (!answered) return 'applicants.validation.required';
  }
  if (value === '' || field.type !== 'builtin') return undefined;
  const rule = RULE_FOR[field.key];
  return rule === undefined ? undefined : validateField(rule, value);
};

const LABEL_KEY: Record<RecruitmentFormBuiltin, string> = {
  fullNameAr: 'applicants.form.fullNameAr',
  fullNameEn: 'applicants.form.fullNameEn',
  nationalId: 'applicants.form.nationalId',
  primaryPhone: 'applicants.form.primaryPhone',
  secondaryPhone: 'applicants.form.secondaryPhone',
  email: 'applicants.form.email',
  educationLevel: 'applicants.form.educationLevel',
  educationSpecialization: 'applicants.form.specialization',
  governorate: 'applicants.form.governorate',
  city: 'applicants.form.city',
  addressLine1: 'applicants.form.line1',
  maritalStatus: 'applicants.form.maritalStatus',
  militaryStatus: 'applicants.form.militaryStatus',
  expectedSalary: 'applicants.form.expectedSalary',
  willingToRelocate: 'applicants.form.willingRelocate',
};

/** The label a field shows, in the reader's language. */
export const fieldLabel = (field: RecruitmentFormField, t: (k: string) => string, locale: Locale): string =>
  field.type === 'builtin' ? t(LABEL_KEY[field.key]) : field.label[locale];

const GOVERNORATES = EGYPT_GOVERNORATES.map((g) => g.ar);

export const FormFieldInput = ({
  field,
  answers,
  error,
  onChange,
  onBlur,
  locale,
}: {
  field: RecruitmentFormField;
  answers: Answers;
  error?: string | undefined;
  onChange: (patch: Answers) => void;
  onBlur: () => void;
  locale: Locale;
}): JSX.Element => {
  const t = useT();
  const label = fieldLabel(field, t, locale);
  const value = typeof answers[field.key] === 'string' ? (answers[field.key] as string) : '';
  const set = (next: string | boolean): void => onChange({ [field.key]: next });
  const invalid = error !== undefined;
  const common = { id: field.key, error: invalid, onBlur };

  if (field.type === 'builtin') {
    if (field.key === 'governorate' || field.key === 'city') {
      const governorate =
        typeof answers.governorate === 'string' ? (answers.governorate as string) : '';
      const options = field.key === 'governorate' ? GOVERNORATES : citiesOfGovernorate(governorate);
      return (
        <Field
          label={label}
          required={isRequired(field)}
          error={error}
          hint={
            field.key === 'city' && governorate === ''
              ? t('applicants.form.cityNeedsGovernorate')
              : undefined
          }
        >
          <Combobox
            id={field.key}
            value={value}
            options={options}
            // Changing the governorate invalidates a city chosen under the old one.
            onChange={(next) =>
              onChange(
                field.key === 'governorate' && next !== governorate
                  ? { governorate: next, city: '' }
                  : { [field.key]: next },
              )
            }
            onBlur={onBlur}
            error={invalid}
            disabled={field.key === 'city' && governorate === ''}
            placeholder={t(
              field.key === 'governorate'
                ? 'applicants.form.selectGovernorate'
                : 'applicants.form.selectCity',
            )}
            emptyText={t('common.noResults')}
            clearLabel={t('common.clear')}
          />
        </Field>
      );
    }

    const choices =
      field.key === 'educationLevel'
        ? EDUCATION_LEVELS.map((l) => ({ value: l, label: t(`applicants.education.${l}`) }))
        : field.key === 'maritalStatus'
          ? MARITAL_STATUSES.map((m) => ({ value: m, label: t(`applicants.marital.${m}`) }))
          : field.key === 'militaryStatus'
            ? MILITARY_STATUSES.map((m) => ({ value: m, label: t(`applicants.military.${m}`) }))
            : null;
    if (choices !== null) {
      return (
        <Field label={label} required={isRequired(field)} error={error}>
          <Select {...common} value={value} onChange={(e) => set(e.target.value)}>
            <option value="">{t('applicants.form.unspecified')}</option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </Field>
      );
    }

    if (field.key === 'willingToRelocate') {
      return (
        <div className="flex items-end">
          <Checkbox label={label} checked={answers[field.key] === true} onChange={(e) => set(e.target.checked)} />
        </div>
      );
    }

    const numeric = field.key === 'nationalId' || field.key === 'expectedSalary';
    return (
      <Field
        label={label}
        required={isRequired(field)}
        error={error}
        hint={
          field.key === 'primaryPhone' || field.key === 'secondaryPhone'
            ? t('applicants.form.phoneHint')
            : undefined
        }
      >
        <Input
          {...common}
          value={value}
          onChange={(e) => set(e.target.value)}
          {...(field.key === 'nationalId' ? { inputMode: 'numeric' as const, maxLength: 14 } : {})}
          {...(field.key === 'primaryPhone' || field.key === 'secondaryPhone'
            ? { inputMode: 'tel' as const, dir: 'ltr' as const }
            : {})}
          {...(field.key === 'email' || field.key === 'fullNameEn' ? { dir: 'ltr' as const } : {})}
          {...(numeric ? { dir: 'ltr' as const } : {})}
        />
      </Field>
    );
  }

  // Custom
  if (field.kind === 'checkbox') {
    return (
      <div className="flex items-end">
        <Checkbox label={label} checked={answers[field.key] === true} onChange={(e) => set(e.target.checked)} />
        {invalid && <p className="ms-2 text-xs text-red-600">{error}</p>}
      </div>
    );
  }
  if (field.kind === 'select') {
    return (
      <Field label={label} required={isRequired(field)} error={error}>
        <Select {...common} value={value} onChange={(e) => set(e.target.value)}>
          <option value="">{t('applicants.form.unspecified')}</option>
          {field.options.map((o, i) => (
            <option key={i} value={o[locale]}>{o[locale]}</option>
          ))}
        </Select>
      </Field>
    );
  }
  return (
    <Field label={label} required={isRequired(field)} error={error}>
      <Input
        {...common}
        type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </Field>
  );
};
