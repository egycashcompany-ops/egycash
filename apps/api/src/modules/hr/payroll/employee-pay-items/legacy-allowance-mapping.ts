// Can a legacy allowance become a pay item at all? (PY-10). PURE.
//
// WHAT THIS IS FOR, AND WHAT IT DELIBERATELY IS NOT.
//
// `employment.allowances[]` predates the pay-item catalog. Each row is `{name, amount, currency}`
// where `name` is FREE TEXT — no code, no kind, no calculation basis, and no dates. A pay item is
// the opposite: a coded catalog entry whose kind and basis ARE its meaning, assigned over an
// interval. Turning one into the other is therefore a MATCHING problem before it is anything else,
// and the rule this phase was given is unambiguous: prove every record is convertible before a
// single legacy row is deleted.
//
// So this file answers exactly one question — CAN this row be converted, and by what evidence —
// and answers it without a database, so the report can be argued with. It converts nothing, writes
// nothing, and decides no money. Whether a converted allowance should then be PAID, and from what
// date, are decisions with money attached that this file does not take.
//
// THE MATCHES IT WILL MAKE, AND THE ONE IT REFUSES TO. An allowance is matched to a catalog item
// only on an EXACT name — its code, or one of its two localized names, after trimming and case
// folding. Nothing fuzzy, no stemming, no partial match: "بدل سكن" and "بدل السكن" are two
// strings, and deciding they are one allowance is a judgement about this organization's payroll
// that nobody has delegated to a similarity score. An unmatched row is REPORTED, so a human can
// create the catalog item and say so, which is the only honest way this ends.
import { type PayItemCalcBasis, type PayItemKind } from '@ecms/contracts';

/** A legacy row, exactly as `employment.allowances[]` holds it. */
export interface LegacyAllowance {
  name: string;
  amount: number;
  currency: string;
}

/** The catalog, reduced to what a match needs. */
export interface CatalogEntry {
  id: string;
  code: string;
  name: { ar: string; en: string };
  kind: PayItemKind;
  calcBasis: PayItemCalcBasis;
  status: 'active' | 'archived';
}

export const ALLOWANCE_MAPPING_OUTCOMES = [
  /** The name is a catalog CODE. The strongest evidence there is. */
  'byCode',
  /** The name is exactly one catalog item's Arabic or English name. */
  'byName',
  /** The name matches SEVERAL items — a human must say which. */
  'ambiguous',
  /** No catalog item carries this name. The item has to be created first. */
  'unmapped',
  /** Nothing to pay: a zero or negative amount is not an allowance. */
  'notPayable',
] as const;
export type AllowanceMappingOutcome = (typeof ALLOWANCE_MAPPING_OUTCOMES)[number];

export interface AllowanceMapping {
  allowance: LegacyAllowance;
  outcome: AllowanceMappingOutcome;
  /** The catalog item it maps to — set only for `byCode` and `byName`. */
  payItemId: string | null;
  /** Every candidate, so an `ambiguous` row names what it was ambiguous between. */
  candidateIds: string[];
}

/** Trim, collapse runs of whitespace, fold case. Nothing language-specific — see the header. */
const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();

export const classifyAllowance = (
  allowance: LegacyAllowance,
  catalog: readonly CatalogEntry[],
): AllowanceMapping => {
  const blank = { allowance, payItemId: null, candidateIds: [] };
  if (!(allowance.amount > 0)) return { ...blank, outcome: 'notPayable' };

  const wanted = normalize(allowance.name);
  if (wanted === '') return { ...blank, outcome: 'unmapped' };

  const byCode = catalog.filter((item) => normalize(item.code) === wanted);
  if (byCode.length === 1) {
    return { allowance, outcome: 'byCode', payItemId: byCode[0]?.id ?? null, candidateIds: [] };
  }
  if (byCode.length > 1) {
    return { ...blank, outcome: 'ambiguous', candidateIds: byCode.map((i) => i.id) };
  }

  const byName = catalog.filter(
    (item) => normalize(item.name.ar) === wanted || normalize(item.name.en) === wanted,
  );
  if (byName.length === 1) {
    return { allowance, outcome: 'byName', payItemId: byName[0]?.id ?? null, candidateIds: [] };
  }
  if (byName.length > 1) {
    return { ...blank, outcome: 'ambiguous', candidateIds: byName.map((i) => i.id) };
  }

  return { ...blank, outcome: 'unmapped' };
};

export interface AllowanceReadiness {
  total: number;
  byOutcome: Record<AllowanceMappingOutcome, number>;
  /** The distinct names nobody can convert yet — the work list, alphabetical. */
  unmappedNames: string[];
  /**
   * Whether EVERY row can be converted.
   *
   * The gate the brief names: no legacy data is deleted until this is true. `notPayable` counts
   * as convertible — a zero-amount row carries nothing to lose — while `ambiguous` does not,
   * because guessing between two catalog items is exactly the judgement being refused.
   */
  convertible: boolean;
}

export const readinessOf = (
  mappings: readonly AllowanceMapping[],
): AllowanceReadiness => {
  const byOutcome = Object.fromEntries(
    ALLOWANCE_MAPPING_OUTCOMES.map((outcome) => [outcome, 0]),
  ) as Record<AllowanceMappingOutcome, number>;
  const unmapped = new Set<string>();

  for (const mapping of mappings) {
    byOutcome[mapping.outcome] += 1;
    if (mapping.outcome === 'unmapped' || mapping.outcome === 'ambiguous') {
      unmapped.add(mapping.allowance.name.trim());
    }
  }

  return {
    total: mappings.length,
    byOutcome,
    unmappedNames: [...unmapped].sort(),
    convertible: byOutcome.unmapped === 0 && byOutcome.ambiguous === 0,
  };
};
