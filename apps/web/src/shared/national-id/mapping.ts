// Pure mapping helpers for the National-ID OCR flow — module-agnostic. Turns a raw extraction
// (confidence-banded, possibly unavailable) into the normalized review shape, applying the two
// client-side computations: number-derived fields (parseNationalId) and the Arabic→Latin name
// suggestion. Kept separate from the components so it is trivially unit-testable.
import { parseNationalId, type MaritalStatus, type OcrExtractionDto } from '@ecms/contracts';
import { transliterateArabicName } from './transliterate';
import { type NationalIdReviewData, type NationalIdReviewMeta } from './types';

/**
 * Which review fields each side of the card is read from — the one statement of it, so the
 * blanking below and the review's own marks cannot drift apart.
 *
 * The number is listed under the FRONT alone although it is printed on both sides: the back's copy
 * only cross-checks the front's, so a rejected back never costs a number that was read.
 * `fullNameEn` follows `fullNameAr`, being a transliteration of it. The card's occupation is read
 * by the reader but is not a field of this form, so nothing here carries it.
 */
export const SIDE_FIELDS = {
  front: ['fullNameAr', 'fullNameEn', 'nationalId', 'addressLine', 'city'],
  back: ['religion', 'maritalStatus', 'nationalIdExpiry'],
} as const satisfies Record<'front' | 'back', readonly (keyof NationalIdReviewData)[]>;

/** The fields of every side the reader could not read — left empty, never guessed at. */
export const unreadFields = (
  quality: NationalIdReviewMeta['quality'],
): (keyof NationalIdReviewData)[] =>
  (['front', 'back'] as const).flatMap((side) =>
    quality?.[side]?.verdict === 'reject' ? [...SIDE_FIELDS[side]] : [],
  );

/** Map a raw OCR marital-status string (Arabic or English) to the enum, else '' (unknown). */
export const mapMaritalStatus = (raw: string): MaritalStatus | '' => {
  const s = raw.trim().toLowerCase();
  // 'آنسة' is what a card prints for an unmarried woman where a man's says 'أعزب'.
  if (/أعزب|اعزب|عزباء|[آاأ]نس[ةه]|single/.test(s)) return 'single';
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

/**
 * Normalize a raw OCR extraction into the editable review shape (nothing is trusted).
 *
 * A side the reader REJECTED contributes nothing: its fields stay as `empty()` left them. The
 * reader still returns values for a photograph it could not read — it reads what it can see — and
 * on the live card that meant a religion of «ستدم T» and a marital status of nothing at all. An
 * empty box asks to be filled; a wrong value asks nothing and gets saved.
 */
export const ocrToReview = (r: OcrExtractionDto): NationalIdReviewData => {
  const base = empty();
  const unread = new Set<keyof NationalIdReviewData>(unreadFields(r.quality));
  const fullNameAr = r.fullNameAr?.value.trim() ?? '';
  const nationalId = r.nationalId?.value.trim() ?? '';
  const fullNameEn =
    r.fullNameEn !== null && r.fullNameEn.value.trim() !== ''
      ? r.fullNameEn.value.trim()
      : transliterateArabicName(fullNameAr);
  const read: NationalIdReviewData = {
    ...base,
    fullNameAr,
    fullNameEn,
    nationalId,
    maritalStatus: r.maritalStatus === null ? '' : mapMaritalStatus(r.maritalStatus.value),
    religion: r.religion?.value.trim() ?? '',
    nationalIdExpiry: isoDate(r.nationalIdExpiry?.value),
    addressLine: r.address?.value.trim() ?? '',
    city: r.city?.value.trim() ?? '',
  };
  // Every field of this shape reads as '' when it is unknown, derived ones included.
  for (const field of unread) read[field] = '';
  return { ...read, ...deriveFromNationalId(read.nationalId) };
};

/** A yyyy-mm-dd prefix, or '' — the reader can return words where a date belongs. */
const isoDate = (raw: string | undefined): string => {
  const head = (raw ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : '';
};

/** What the review shows beside the values: each field's confidence and the card images. */
export const ocrToMeta = (
  r: OcrExtractionDto,
  uploaded: { front?: string | undefined; back?: string | undefined } = {},
): NationalIdReviewMeta => {
  const confidence: NationalIdReviewMeta['confidence'] = {};
  const fields = [
    ['fullNameAr', r.fullNameAr],
    ['nationalId', r.nationalId],
    ['nationalIdExpiry', r.nationalIdExpiry],
    ['maritalStatus', r.maritalStatus],
    ['religion', r.religion],
    ['addressLine', r.address],
    ['city', r.city],
  ] as const;
  const unread = new Set<string>(unreadFields(r.quality));
  for (const [key, field] of fields) {
    // A field left empty carries no confidence: there is nothing to be confident about, and the
    // review marks it as not read instead.
    if (field !== null && field.value.trim() !== '' && !unread.has(key)) {
      confidence[key] = field.confidence;
    }
  }
  const images = r.images ?? {};
  return {
    confidence,
    ...(r.quality === undefined ? {} : { quality: r.quality }),
    ...(images.cardFront === undefined ? {} : { cardFront: images.cardFront }),
    ...(images.cardBack === undefined ? {} : { cardBack: images.cardBack }),
    ...(images.portrait === undefined ? {} : { portrait: images.portrait }),
    ...(uploaded.front === undefined ? {} : { uploadedFront: uploaded.front }),
    ...(uploaded.back === undefined ? {} : { uploadedBack: uploaded.back }),
  };
};
