// Job Offer numbering: organization-wide, yearly-reset, `JO-{YYYY}-{seq:6}` — the immutable,
// human-readable identifier HR uses instead of the Mongo ObjectId. Pure format/parse here;
// the atomic sequence allocation that feeds it lives in `offer-sequence.ts` (needs Mongo).
export const OFFER_NUMBER_PREFIX = 'JO';

/** `JO-2026-000001`. Pads the sequence to 6 digits; longer sequences are not truncated. */
export const formatOfferNumber = (year: number, seq: number): string =>
  `${OFFER_NUMBER_PREFIX}-${year}-${String(seq).padStart(6, '0')}`;

/** The per-year sequence key (yearly reset), namespaced apart from the applicant counter. */
export const offerSequenceKey = (year: number): string => `jobOffer:${year}`;

const OFFER_NUMBER_RE = /^JO-(\d{4})-(\d{6,})$/;

export const parseOfferNumber = (code: string): { year: number; seq: number } | null => {
  const m = OFFER_NUMBER_RE.exec(code);
  if (m === null) return null;
  return { year: Number(m[1]), seq: Number(m[2]) };
};
