// The National ID is required to CREATE a person, and still optional everywhere that would break
// an existing record if it were not.
//
// Both halves matter. Sprint 4.1 shipped ID-less registration deliberately, so there are records
// in the database with no National ID; a rule that refused them on every save would lock their
// own correction out of the system. The line drawn here — required on the two create paths, never
// on edit or on the ID gate — is what lets the new rule hold without stranding them.
import { describe, expect, it } from 'vitest';
import {
  ConfirmApplicantIdentitySchema,
  EmployeePersonalSchema,
  RegisterApplicantSchema,
  UpdateEmployeePersonalSchema,
} from '../index.js';

const VALID_NID = '29801011234567';

const identity = (nationalId?: string): Record<string, unknown> => ({
  fullNameAr: 'أحمد محمد على حسن',
  nationality: 'Egyptian',
  ...(nationalId === undefined ? {} : { nationalId }),
});

const applicant = (nationalId?: string): Record<string, unknown> => ({
  sourceId: '6a71ba261db68a923e529cf8',
  intakeChannel: 'web',
  identity: identity(nationalId),
  contact: { primaryPhone: '01012345678' },
});

describe('creating a person requires a National ID', () => {
  it('accepts a registration that carries a valid one', () => {
    expect(RegisterApplicantSchema.safeParse(applicant(VALID_NID)).success).toBe(true);
  });

  it('refuses an applicant registration with the field missing', () => {
    const parsed = RegisterApplicantSchema.safeParse(applicant());
    expect(parsed.success).toBe(false);
    expect(parsed.success || JSON.stringify(parsed.error.issues)).toContain('nationalId');
  });

  it('refuses an empty string, and whitespace, and Arabic-Indic whitespace alike', () => {
    // No separate emptiness rule exists or is wanted: NationalIdSchema trims first, so a blank
    // reaches the format check as '' and fails there. This pins that it really does fail.
    for (const blank of ['', '   ', '\t\n', ' ']) {
      expect(RegisterApplicantSchema.safeParse(applicant(blank)).success, blank).toBe(false);
    }
  });

  it('still refuses a structurally invalid number — the format rule was not replaced', () => {
    for (const bad of ['123', '12345678901234', '29813011234567']) {
      expect(RegisterApplicantSchema.safeParse(applicant(bad)).success, bad).toBe(false);
    }
  });

  it('accepts a number typed on an Arabic keyboard, as it always did', () => {
    const arabicDigits = VALID_NID.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)] ?? d);
    const parsed = RegisterApplicantSchema.safeParse(applicant(`  ${arabicDigits}  `));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.identity.nationalId).toBe(VALID_NID);
  });

  it('binds the direct-registration path too', () => {
    // `DirectRegisterEmployeeSchema` composes `personal: EmployeePersonalSchema`, which is the
    // same identity block the applicant path uses. Asserting on that block keeps this test about
    // the National ID instead of about whatever else a full direct-registration payload owes.
    const personal = (nationalId?: string): Record<string, unknown> => ({
      identity: identity(nationalId),
      contact: { primaryPhone: '01012345678' },
    });
    const without = EmployeePersonalSchema.safeParse(personal());
    expect(without.success).toBe(false);
    expect(without.success || JSON.stringify(without.error.issues)).toContain('nationalId');
    expect(EmployeePersonalSchema.safeParse(personal(VALID_NID)).success).toBe(true);
  });
});

describe('and never blocks a record that already exists without one', () => {
  it('lets an edit save while leaving the National ID alone', () => {
    // `IdentityInputSchema.partial()` — this is what keeps every ID-less record editable.
    const parsed = UpdateEmployeePersonalSchema.safeParse({
      identity: { fullNameAr: 'أحمد محمد على حسن' },
      version: 3,
    });
    expect(parsed.success).toBe(true);
  });

  it('keeps the ID gate optional, which is how an ID-less record gets one', () => {
    expect(
      ConfirmApplicantIdentitySchema.safeParse({ fullNameAr: 'أحمد محمد', version: 1 }).success,
    ).toBe(true);
    expect(
      ConfirmApplicantIdentitySchema.safeParse({ nationalId: VALID_NID, version: 1 }).success,
    ).toBe(true);
  });
});
