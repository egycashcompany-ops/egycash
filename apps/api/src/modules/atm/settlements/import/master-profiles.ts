// Where each bank's master workbook keeps its machines' cassettes (docs/12-planning/
// atm-settlements-phase1.md §5.2). One profile per bank; phase 1 has Al Baraka's only (S-10).
//
// The other banks' masters are different shapes (`+200` markers, HDB text layouts, CIB `Q:V`); each
// is a new profile plus its own row parser in phase 2 (§1.3). A bank with no profile is refused
// (`ATM_LAYOUT_IMPORT_UNSUPPORTED_BANK`), never read with another bank's profile.
//
// Headers are bound by exact text after trimming and collapsing spaces. These are the sheets' own
// words, typos included (`Withdrawall`, `No- of bills2`) — research of the BRK master (grounding A
// §5, §8.5): headers and letters only, no value.
import { ErrorCodes, type AtmBankCode } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';

export interface AtmMasterProfile {
  sheet: 'Full list';
  headerRow: 1;
  firstDataRow: 3;
  /** Bound by header text in `headerRow`. */
  columns: {
    code: 'Reference';
    location: 'location';
    denominations: readonly ['Denom1', 'Denom2', 'Denom3', 'Denom4'];
    typeLabel: 'Bank';
    featuresLabel: 'Deposit';
    hubLabel: 'Dep';
    help: 'HELP';
  };
  /** 0 or blank = no cassette (DS-7). */
  emptyDenomination: 0;
  /** Every non-empty slot (GS-9). */
  slotKind: 'withdrawal';
  currency: 'EGP';
  /** `REP. TAPE!D1:G2`: D the total, E/F/G the 200/100/50 counts (S-3, DS-8). */
  standardLoads: {
    sheet: 'REP. TAPE';
    rows: readonly [1, 2];
    total: 'D';
    counts: { readonly E: 200; readonly F: 100; readonly G: 50 };
  };
  /** Today's lines: codes and denominations only — the count columns are never read. */
  dayLines: {
    sheet: 'REP. TAPE';
    headerRow: 7;
    firstRow: 8;
    lastRow: 107;
    code: 'B';
    denominations: readonly ['E', 'G', 'I', 'K'];
  };
}

const BRK_PROFILE: AtmMasterProfile = {
  sheet: 'Full list',
  headerRow: 1,
  firstDataRow: 3,
  columns: {
    code: 'Reference',
    location: 'location',
    denominations: ['Denom1', 'Denom2', 'Denom3', 'Denom4'],
    typeLabel: 'Bank',
    featuresLabel: 'Deposit',
    hubLabel: 'Dep',
    help: 'HELP',
  },
  emptyDenomination: 0,
  slotKind: 'withdrawal',
  currency: 'EGP',
  standardLoads: {
    sheet: 'REP. TAPE',
    rows: [1, 2],
    total: 'D',
    counts: { E: 200, F: 100, G: 50 },
  },
  dayLines: {
    sheet: 'REP. TAPE',
    headerRow: 7,
    firstRow: 8,
    lastRow: 107,
    code: 'B',
    denominations: ['E', 'G', 'I', 'K'],
  },
};

export const ATM_MASTER_PROFILES: Partial<Record<AtmBankCode, AtmMasterProfile>> = {
  BRK: BRK_PROFILE,
};

/** A header as the binding compares it: trimmed, inner runs of white space collapsed. */
export const headerKey = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** `A` → 1 … `Z` → 26, `AA` → 27. */
export const columnNumber = (letter: string): number =>
  [...letter.toUpperCase()].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);

/** §5.2: the bank's profile, or 422 `ATM_LAYOUT_IMPORT_UNSUPPORTED_BANK`. */
export const masterProfileOf = (bankCode: AtmBankCode): AtmMasterProfile => {
  const profile = ATM_MASTER_PROFILES[bankCode];
  if (profile === undefined) {
    throw new AppError(
      ErrorCodes.ATM_LAYOUT_IMPORT_UNSUPPORTED_BANK,
      422,
      'this bank has no master workbook import yet',
      { details: [{ field: 'bankCode', code: 'UNSUPPORTED_BANK', message: bankCode }] },
    );
  }
  return profile;
};
