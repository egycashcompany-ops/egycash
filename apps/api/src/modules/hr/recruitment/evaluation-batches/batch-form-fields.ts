// The two derivations the outgoing forms need, kept PURE so they can be settled without a database.
//
// Both are about turning what the system stores into what a printed row expects: an address is a
// structured value here and a single line on paper, and a driving grade is a key here and a tick in
// one of four columns there.
import { type Address, type DrivingTestGrade, type Locale } from '@ecms/contracts';

/**
 * An address as one line, or null when there is nothing to print.
 *
 * Order follows how an Egyptian address is read aloud — street, then district, then city, then
 * governorate — and every empty part simply drops out rather than leaving a stray separator. The
 * postal code is omitted: the security form asks for a place somebody can be found at, and a
 * five-digit code is noise on a handwritten row.
 */
export const formatAddress = (address: Address | null | undefined): string | null => {
  if (address === null || address === undefined) return null;
  const parts = [address.line1, address.line2, address.city, address.governorate]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0);
  return parts.length === 0 ? null : parts.join('، ');
};

/** The grade labels, in the order the official form prints its columns (weakest first). */
export const DRIVING_GRADE_LABELS: Record<DrivingTestGrade, Record<Locale, string>> = {
  weak: { ar: 'ضعيف', en: 'Weak' },
  good: { ar: 'جيد', en: 'Good' },
  veryGood: { ar: 'جيد جداً', en: 'Very good' },
  excellent: { ar: 'إمتياز', en: 'Excellent' },
};
