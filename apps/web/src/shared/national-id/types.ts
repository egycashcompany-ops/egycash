// Generic Egyptian National-ID OCR types — module-agnostic so the capture/review flow can be
// reused by Applicants, Employees, KYC, etc. The extractor is injected by the consuming module
// (it owns the upload + OCR endpoint binding), keeping this component free of any module coupling.
import {
  type Gender,
  type MaritalStatus,
  type OcrExtractionDto,
  type OcrSideQualityDto,
} from '@ecms/contracts';

/**
 * The reviewed, normalized National-ID fields handed back on confirm. Editable fields carry the
 * user's (or OCR's) value; the derived fields (birthDate/gender/governorate) are computed from the
 * number — never OCR'd — and are read-only in the review.
 */
export interface NationalIdReviewData {
  fullNameAr: string;
  /** Transliterated from the Arabic name (editable). */
  fullNameEn: string;
  nationalId: string;
  maritalStatus: MaritalStatus | '';
  religion: string;
  /** Card expiry as yyyy-mm-dd (or '' when unknown). */
  nationalIdExpiry: string;
  /** Official address (single line as read from the card). */
  addressLine: string;
  city: string;
  // ── Derived from the number (parseNationalId), read-only ──
  governorate: string;
  /** ISO birth date, or '' when the number is not (yet) valid. */
  birthDate: string;
  gender: Gender | '';
}

export type OcrConfidence = 'high' | 'medium' | 'low';

/**
 * What the review shows beside the editable values: how sure the reader was of each, the card as
 * it was read, the holder's photograph cut from it, and the photos the user uploaded (shown when
 * the reader returned no image of its own). Display only — never part of the confirmed data.
 */
export interface NationalIdReviewMeta {
  confidence: Partial<
    Record<
      | 'fullNameAr'
      | 'nationalId'
      | 'nationalIdExpiry'
      | 'maritalStatus'
      | 'religion'
      | 'addressLine'
      | 'city',
      OcrConfidence
    >
  >;
  cardFront?: string;
  cardBack?: string;
  portrait?: string;
  uploadedFront?: string;
  uploadedBack?: string;
  /**
   * What the reader thought of each photograph. A side it rejected has its fields left empty and
   * marked, with a notice that asks for another photograph of that side — see `SIDE_FIELDS`.
   */
  quality?: { front?: OcrSideQualityDto; back?: OcrSideQualityDto };
}

/**
 * Runs the OCR extraction for the two card images. Injected by the consuming module, which owns
 * the file upload + the OCR endpoint call (so this generic component stays decoupled from HR).
 */
export type NationalIdExtractor = (input: {
  frontFile: File | null;
  backFile: File | null;
}) => Promise<OcrExtractionDto>;
