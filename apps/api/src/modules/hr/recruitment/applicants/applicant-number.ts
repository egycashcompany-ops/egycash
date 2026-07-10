// Applicant numbering (BD-002): organization-wide, yearly-reset, `APP-{YYYY}-{seq:6}`.
// This file holds the pure format/parse; the atomic sequence allocation that feeds it
// lives in `applicant-sequence.ts` (needs Mongo).
export const APPLICANT_NUMBER_PREFIX = 'APP';

/** `APP-2026-000001`. Pads the sequence to 6 digits; longer sequences are not truncated. */
export const formatApplicantNumber = (year: number, seq: number): string =>
  `${APPLICANT_NUMBER_PREFIX}-${year}-${String(seq).padStart(6, '0')}`;

/** The per-year sequence key (yearly reset). */
export const applicantSequenceKey = (year: number): string => `applicant:${year}`;

const APPLICANT_NUMBER_RE = /^APP-(\d{4})-(\d{6,})$/;

export const parseApplicantNumber = (code: string): { year: number; seq: number } | null => {
  const m = APPLICANT_NUMBER_RE.exec(code);
  if (m === null) return null;
  return { year: Number(m[1]), seq: Number(m[2]) };
};
