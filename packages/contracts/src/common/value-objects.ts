// Shared value objects (Review R8) — the single implementation used by every
// feature (Users now; Applicant/Employee later). One Zod schema per value object.
import { z } from 'zod';
import { LocalizedStringSchema } from './localized.js';

// ── PersonName ──────────────────────────────────────────────────────────────

export const PersonNameSchema = z.object({
  firstName: LocalizedStringSchema,
  lastName: LocalizedStringSchema,
});
export type PersonName = z.infer<typeof PersonNameSchema>;

// ── PhoneNumber (Egyptian mobile) ───────────────────────────────────────────
// Accepts local (01XXXXXXXXX) or international (+201XXXXXXXXX / 00201XXXXXXXXX)
// and normalizes to the local 11-digit form.

const EG_MOBILE_LOCAL = /^01[0125]\d{8}$/;

export const normalizeEgyptianPhone = (raw: string): string | null => {
  const digits = raw.replace(/[\s\-()]/g, '');
  const local = digits.replace(/^(\+20|0020)/, '0');
  return EG_MOBILE_LOCAL.test(local) ? local : null;
};

export const PhoneNumberSchema = z.string().transform((raw, ctx) => {
  const normalized = normalizeEgyptianPhone(raw);
  if (normalized === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid Egyptian mobile number' });
    return z.NEVER;
  }
  return normalized;
});
export type PhoneNumber = z.infer<typeof PhoneNumberSchema>;

// ── Address ─────────────────────────────────────────────────────────────────

export const AddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  governorate: z.string().min(1),
  postalCode: z.string().optional(),
});
export type Address = z.infer<typeof AddressSchema>;

// ── NationalId (Egyptian, 14 digits) ────────────────────────────────────────
// Structure: C YYMMDD GG SSSS K
//   C  = century (2 → 19xx, 3 → 20xx)
//   YYMMDD = birth date
//   GG = governorate code
//   SSSS = serial (last digit of serial encodes gender: odd = male)
//   K  = check digit (not publicly documented — structural checks only)

export const EGYPT_GOVERNORATE_CODES: Readonly<Record<string, string>> = {
  '01': 'Cairo',
  '02': 'Alexandria',
  '03': 'Port Said',
  '04': 'Suez',
  '11': 'Damietta',
  '12': 'Dakahlia',
  '13': 'Sharqia',
  '14': 'Qalyubia',
  '15': 'Kafr El Sheikh',
  '16': 'Gharbia',
  '17': 'Monufia',
  '18': 'Beheira',
  '19': 'Ismailia',
  '21': 'Giza',
  '22': 'Beni Suef',
  '23': 'Fayoum',
  '24': 'Minya',
  '25': 'Assiut',
  '26': 'Sohag',
  '27': 'Qena',
  '28': 'Aswan',
  '29': 'Luxor',
  '31': 'Red Sea',
  '32': 'New Valley',
  '33': 'Matrouh',
  '34': 'North Sinai',
  '35': 'South Sinai',
  '88': 'Born abroad',
};

export interface NationalIdParts {
  birthDate: Date;
  governorateCode: string;
  governorate: string;
  gender: 'male' | 'female';
}

/** Structural validation + decoding of an Egyptian national ID. Returns null when invalid. */
export const parseNationalId = (value: string): NationalIdParts | null => {
  if (!/^\d{14}$/.test(value)) return null;

  const century = value[0];
  if (century !== '2' && century !== '3') return null;
  const base = century === '2' ? 1900 : 2000;

  const year = base + Number(value.slice(1, 3));
  const month = Number(value.slice(3, 5));
  const day = Number(value.slice(5, 7));
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day ||
    birthDate.getTime() > Date.now()
  ) {
    return null;
  }

  const governorateCode = value.slice(7, 9);
  const governorate = EGYPT_GOVERNORATE_CODES[governorateCode];
  if (governorate === undefined) return null;

  const genderDigit = Number(value[12]);
  return {
    birthDate,
    governorateCode,
    governorate,
    gender: genderDigit % 2 === 1 ? 'male' : 'female',
  };
};

export const NationalIdSchema = z.string().refine((value) => parseNationalId(value) !== null, {
  message: 'invalid Egyptian national ID',
});
export type NationalId = z.infer<typeof NationalIdSchema>;

/** Default masking for list views (Security Architecture §3): 298*******4567 */
export const maskNationalId = (value: string): string =>
  value.length === 14 ? `${value.slice(0, 3)}*******${value.slice(10)}` : '*'.repeat(value.length);
