// Pure mapping helpers for the National-ID OCR flow — module-agnostic. Turns a raw extraction
// (confidence-banded, possibly unavailable) into the normalized review shape, applying the two
// client-side computations: number-derived fields (parseNationalId) and the Arabic→Latin name
// suggestion. Kept separate from the components so it is trivially unit-testable.
import { parseNationalId, type MaritalStatus, type OcrExtractionDto } from '@ecms/contracts';
import { transliterateArabicName } from './transliterate';
import { type NationalIdReviewData } from './types';

/** Map a raw OCR marital-status string (Arabic or English) to the enum, else '' (unknown). */
export const mapMaritalStatus = (raw: string): MaritalStatus | '' => {
  const s = raw.trim().toLowerCase();
  if (/أعزب|اعزب|عزباء|single/.test(s)) return 'single';
  if (/متزوجة|متزوج|married/.test(s)) return 'married';
  if (/مطلقة|مطلق|divorc/.test(s)) return 'divorced';
  if (/أرملة|ارملة|أرمل|ارمل|widow/.test(s)) return 'widowed';
  return '';
};

const empty = (): NationalIdReviewData => ({
  fullNameAr: '',
  fullNameEn: '',
  nationalId: '',
  maritalStatus: '',
  religion: '',
  nationalIdExpiry: '',
  addressLine: '',
  city: '',
  governorate: '',
  birthDate: '',
  gender: '',
});

/** Recompute the number-derived fields (birth date / gender / governorate) from a National ID. */
export const deriveFromNationalId = (
  nationalId: string,
): Pick<NationalIdReviewData, 'birthDate' | 'gender' | 'governorate'> => {
  const parsed = parseNationalId(nationalId.trim());
  if (parsed === null) return { birthDate: '', gender: '', governorate: '' };
  return {
    birthDate: parsed.birthDate.toISOString(),
    gender: parsed.gender,
    governorate: parsed.governorate,
  };
};

/** Normalize a raw OCR extraction into the editable review shape (nothing is trusted). */
export const ocrToReview = (r: OcrExtractionDto): NationalIdReviewData => {
  const base = empty();
  const fullNameAr = r.fullNameAr?.value.trim() ?? '';
  const nationalId = r.nationalId?.value.trim() ?? '';
  const fullNameEn =
    r.fullNameEn !== null && r.fullNameEn.value.trim() !== ''
      ? r.fullNameEn.value.trim()
      : transliterateArabicName(fullNameAr);
  return {
    ...base,
    fullNameAr,
    fullNameEn,
    nationalId,
    maritalStatus: r.maritalStatus === null ? '' : mapMaritalStatus(r.maritalStatus.value),
    religion: r.religion?.value.trim() ?? '',
    nationalIdExpiry: r.nationalIdExpiry === null ? '' : r.nationalIdExpiry.value.slice(0, 10),
    addressLine: r.address?.value.trim() ?? '',
    city: r.city?.value.trim() ?? '',
    ...deriveFromNationalId(nationalId),
  };
};
