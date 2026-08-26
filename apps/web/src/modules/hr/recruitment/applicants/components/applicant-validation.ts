// The applicant form's shape and its rules, kept out of the component so both can be read — and
// tested — without rendering anything.
//
// Every rule returns an i18n KEY, never a sentence: the message the recruiter reads is chosen by
// the locale, and the same rule has to be able to say the same thing in Arabic and English.
// The predicates themselves come from `@ecms/contracts`, which is also what the API validates
// with, so a value the form accepts is a value the server accepts.
import {
  isArabicName,
  isEmail,
  isEnglishName,
  isPostalCode,
  normalizeEgyptianPhone,
  parseNationalId,
  type ContactChannel,
  type EducationLevel,
  type MaritalStatus,
  type MilitaryStatus,
} from '@ecms/contracts';

export interface AddressForm {
  line1: string;
  line2: string;
  city: string;
  governorate: string;
  postalCode: string;
}

export interface ExperienceRow {
  employer: string;
  position: string;
  from: string;
  to: string;
  leavingReason: string;
}
export interface LicenseRow {
  class: string;
  expiry: string;
}
export interface ReferenceRow {
  name: string;
  relationship: string;
  phone: string;
}

export interface FormState {
  fullNameAr: string;
  fullNameEn: string;
  nationalId: string;
  nationality: string;
  maritalStatus: '' | MaritalStatus;
  religion: string;
  /** The security-check form's field — typed by hand, never OCR-derived. */
  motherName: string;
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
  militaryCompletedAt: string;
  experience: ExperienceRow[];
  drivingLicenses: LicenseRow[];
  references: ReferenceRow[];
  certifications: string;
}

/** A form field's name — also its DOM id, which is how "jump to the first error" finds it. */
export type FieldName =
  | 'fullNameAr'
  | 'fullNameEn'
  | 'nationalId'
  | 'primaryPhone'
  | 'secondaryPhone'
  | 'email'
  | 'dependentsCount'
  | 'expectedSalaryAmount'
  | 'educationGraduationYear'
  | `${'officialAddress' | 'currentAddress'}.${'line1' | 'city' | 'governorate' | 'postalCode'}`;

export type FieldErrors = Partial<Record<FieldName, string>>;

const KEY = 'applicants.validation.';
const required = KEY + 'required';

/**
 * One field's verdict. An empty optional field is always fine — "required" is decided by the
 * caller (it depends on the mode), never by the rule, so the two never drift apart.
 */
export const validateField = (name: FieldName, raw: string): string | undefined => {
  const value = raw.trim();
  const isRequired = name === 'fullNameAr' || name === 'primaryPhone';
  if (value === '') return isRequired ? required : undefined;

  switch (name) {
    case 'fullNameAr':
      if (!isArabicName(value)) return KEY + 'arabicOnly';
      return value.length < 2 ? KEY + 'tooShort' : undefined;
    case 'fullNameEn':
      return isEnglishName(value) ? undefined : KEY + 'englishOnly';
    case 'nationalId':
      return parseNationalId(value) === null ? KEY + 'nationalId' : undefined;
    case 'primaryPhone':
    case 'secondaryPhone':
      return normalizeEgyptianPhone(value) === null ? KEY + 'phone' : undefined;
    case 'email':
      return isEmail(value) ? undefined : KEY + 'email';
    case 'officialAddress.postalCode':
    case 'currentAddress.postalCode':
      return isPostalCode(value) ? undefined : KEY + 'postalCode';
    case 'dependentsCount': {
      const n = Number(value);
      return Number.isInteger(n) && n >= 0 && n <= 50 ? undefined : KEY + 'dependents';
    }
    case 'expectedSalaryAmount': {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? undefined : KEY + 'amount';
    }
    case 'educationGraduationYear': {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1950 && n <= 2100 ? undefined : KEY + 'year';
    }
    default:
      return undefined;
  }
};

/**
 * An address is all-or-nothing: the API only stores one when line 1, the city and the governorate
 * are all present, so a half-filled address would be silently dropped. Rather than lose the typing
 * quietly, the form asks for the rest of it.
 */
const addressErrors = (
  which: 'officialAddress' | 'currentAddress',
  a: AddressForm,
): FieldErrors => {
  const errors: FieldErrors = {};
  const started = [a.line1, a.city, a.governorate, a.line2, a.postalCode].some(
    (v) => v.trim() !== '',
  );
  if (started) {
    for (const part of ['line1', 'city', 'governorate'] as const) {
      if (a[part].trim() === '') errors[`${which}.${part}`] = required;
    }
  }
  const postal = validateField(`${which}.postalCode`, a.postalCode);
  if (postal !== undefined) errors[`${which}.postalCode`] = postal;
  return errors;
};

/** Everything wrong with the form right now, in the order the fields appear on the page. */
export const validateForm = (f: FormState, mode: 'create' | 'edit'): FieldErrors => {
  const errors: FieldErrors = {};
  const simple: FieldName[] = [
    'fullNameAr',
    'fullNameEn',
    'nationalId',
    'dependentsCount',
    'primaryPhone',
    'secondaryPhone',
    'email',
    'expectedSalaryAmount',
    'educationGraduationYear',
  ];
  const value: Record<string, string> = {
    fullNameAr: f.fullNameAr,
    fullNameEn: f.fullNameEn,
    nationalId: f.nationalId,
    dependentsCount: f.dependentsCount,
    primaryPhone: f.primaryPhone,
    secondaryPhone: f.secondaryPhone,
    email: f.email,
    expectedSalaryAmount: f.expectedSalaryAmount,
    educationGraduationYear: f.educationGraduationYear,
  };
  for (const name of simple) {
    // Identity fields only exist on the create form; the edit form must not demand them.
    if (mode === 'edit' && (name === 'nationalId' || name === 'dependentsCount')) {
      continue;
    }
    const problem = validateField(name, value[name] ?? '');
    if (problem !== undefined) errors[name] = problem;
  }
  return {
    ...errors,
    ...addressErrors('officialAddress', f.officialAddress),
    ...addressErrors('currentAddress', f.currentAddress),
  };
};

/** The field a failed save should take you to: the first one on the page that is wrong. */
export const firstErrorField = (errors: FieldErrors): FieldName | undefined => {
  const order: FieldName[] = [
    'fullNameAr',
    'fullNameEn',
    'nationalId',
    'dependentsCount',
    'primaryPhone',
    'secondaryPhone',
    'email',
    'officialAddress.line1',
    'officialAddress.city',
    'officialAddress.governorate',
    'officialAddress.postalCode',
    'currentAddress.line1',
    'currentAddress.city',
    'currentAddress.governorate',
    'currentAddress.postalCode',
    'expectedSalaryAmount',
    'educationGraduationYear',
  ];
  return order.find((name) => errors[name] !== undefined);
};
