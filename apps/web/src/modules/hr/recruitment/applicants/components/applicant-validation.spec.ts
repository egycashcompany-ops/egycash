import { describe, expect, it } from 'vitest';
import {
  firstErrorField,
  validateField,
  validateForm,
  type AddressForm,
  type FormState,
} from './applicant-validation';

const address = (patch: Partial<AddressForm> = {}): AddressForm => ({
  line1: '',
  line2: '',
  city: '',
  governorate: '',
  postalCode: '',
  ...patch,
});

const form = (patch: Partial<FormState> = {}): FormState => ({
  sourceId: 'src-1',
  intakeChannel: 'internal',
  fullNameAr: 'أحمد محمد',
  fullNameEn: '',
  nationalId: '',
  nationality: 'Egyptian',
  maritalStatus: '',
  religion: '',
  nationalIdExpiry: '',
  dependentsCount: '',
  primaryPhone: '01012345678',
  secondaryPhone: '',
  email: '',
  preferredContactChannel: '',
  officialAddress: address(),
  currentAddress: address(),
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
  ...patch,
});

describe('validateField', () => {
  it('leaves an empty optional field alone but flags an empty required one', () => {
    expect(validateField('email', '', 'create')).toBeUndefined();
    expect(validateField('secondaryPhone', '   ', 'create')).toBeUndefined();
    expect(validateField('fullNameAr', '', 'create')).toBe('applicants.validation.required');
    expect(validateField('primaryPhone', '', 'create')).toBe('applicants.validation.required');
  });

  it('requires the source only when registering', () => {
    expect(validateField('sourceId', '', 'create')).toBe('applicants.validation.required');
    expect(validateField('sourceId', '', 'edit')).toBeUndefined();
  });

  it('holds the Arabic name to Arabic and the Latin name to Latin', () => {
    expect(validateField('fullNameAr', 'أحمد محمد', 'create')).toBeUndefined();
    expect(validateField('fullNameAr', 'Ahmed', 'create')).toBe('applicants.validation.arabicOnly');
    expect(validateField('fullNameAr', 'أحمد 2', 'create')).toBe('applicants.validation.arabicOnly');
    expect(validateField('fullNameEn', 'Ahmed Mohamed', 'create')).toBeUndefined();
    expect(validateField('fullNameEn', 'أحمد', 'create')).toBe('applicants.validation.englishOnly');
  });

  it('accepts only the four Egyptian mobile prefixes, 11 digits', () => {
    for (const ok of ['01012345678', '01112345678', '01212345678', '01512345678']) {
      expect(validateField('primaryPhone', ok, 'create'), ok).toBeUndefined();
    }
    expect(validateField('primaryPhone', '01312345678', 'create')).toBe('applicants.validation.phone');
    expect(validateField('primaryPhone', '0101234567', 'create')).toBe('applicants.validation.phone');
    expect(validateField('primaryPhone', '010123456789', 'create')).toBe('applicants.validation.phone');
    // Whatever formatting an applicant writes on a CV is cleaned BEFORE the shape is judged:
    // international prefixes, separators, and digits typed on an Arabic keyboard.
    for (const messy of [
      '+201012345678',
      '0020 101 234 5678',
      '010 1234 5678',
      '010-1234-5678',
      '(010) 1234 5678',
      '٠١٠١٢٣٤٥٦٧٨',
    ]) {
      expect(validateField('primaryPhone', messy, 'create'), messy).toBeUndefined();
    }
  });

  it('reads numbers typed on an Arabic keyboard', () => {
    expect(validateField('nationalId', '٢٩٠٠١٠١١٢٠١٢٣٤', 'create')).toBeUndefined();
    expect(validateField('officialAddress.postalCode', '١١٥١١', 'create')).toBeUndefined();
  });

  it('checks the national ID structurally, not just its length', () => {
    expect(validateField('nationalId', '29001011201234', 'create')).toBeUndefined();
    expect(validateField('nationalId', '29013011201234', 'create')).toBe(
      'applicants.validation.nationalId', // month 30
    );
    expect(validateField('nationalId', '2900101120123', 'create')).toBe('applicants.validation.nationalId');
  });

  it('checks email, postal code and the numeric fields', () => {
    expect(validateField('email', 'a@b.com', 'create')).toBeUndefined();
    expect(validateField('email', 'a@b', 'create')).toBe('applicants.validation.email');
    expect(validateField('officialAddress.postalCode', '11511', 'create')).toBeUndefined();
    expect(validateField('officialAddress.postalCode', '115', 'create')).toBe(
      'applicants.validation.postalCode',
    );
    expect(validateField('dependentsCount', '3', 'create')).toBeUndefined();
    expect(validateField('dependentsCount', '51', 'create')).toBe('applicants.validation.dependents');
    expect(validateField('educationGraduationYear', '2019', 'create')).toBeUndefined();
    expect(validateField('educationGraduationYear', '1899', 'create')).toBe('applicants.validation.year');
    expect(validateField('expectedSalaryAmount', '-1', 'create')).toBe('applicants.validation.amount');
  });
});

describe('validateForm', () => {
  it('passes a minimal valid registration', () => {
    expect(validateForm(form(), 'create')).toEqual({});
  });

  it('does not demand identity fields when editing', () => {
    expect(validateForm(form({ sourceId: '', nationalId: '' }), 'edit')).toEqual({});
  });

  it('asks for the rest of a half-typed address instead of dropping it', () => {
    // The API only stores an address with line1 + city + governorate, so a lone city would
    // vanish on save. The form says so rather than losing the typing quietly.
    const errors = validateForm(form({ officialAddress: address({ city: 'الدقي' }) }), 'create');
    expect(errors['officialAddress.line1']).toBe('applicants.validation.required');
    expect(errors['officialAddress.governorate']).toBe('applicants.validation.required');
    expect(errors['officialAddress.city']).toBeUndefined();
  });

  it('leaves a completely empty address alone', () => {
    expect(validateForm(form(), 'create')['officialAddress.line1']).toBeUndefined();
  });

  it('still checks the postal code of an otherwise complete address', () => {
    const errors = validateForm(
      form({
        officialAddress: address({
          line1: '1 شارع',
          city: 'الدقي',
          governorate: 'الجيزة',
          postalCode: '12',
        }),
      }),
      'create',
    );
    expect(errors).toEqual({ 'officialAddress.postalCode': 'applicants.validation.postalCode' });
  });
});

describe('firstErrorField', () => {
  it('picks the field highest up the page, not the first one found', () => {
    expect(firstErrorField({ email: 'x', fullNameAr: 'x' })).toBe('fullNameAr');
    expect(firstErrorField({ 'currentAddress.city': 'x', primaryPhone: 'x' })).toBe('primaryPhone');
    expect(firstErrorField({})).toBeUndefined();
  });
});
