// Ordering by Employee Code means ordering by the employee's NUMBER, not by the branch prefix.
//
// «عايز الـ Sort بتاع كود الموظف يعتمد آخر ٤ أرقام بس .. يعني Ignore 010 وهكذا فى الـ Sort فقط».
// A code is `<3-digit branch><number>` (ADR-017): 0100004, 0400005, 0200006. Sorted as text, every
// 010… comes before every 020…, so the list reads as a list of branches — and the prefix is the
// branch that HIRED somebody, not where they work, so it does not even group the way it looks.
// Sorted by what follows the prefix, the list reads 0004, 0005, 0006: the order people were hired.
//
// «What follows the prefix», not «the last four digits»: the two are the same today, and the number
// widens past 9999 (ADR-017 §3). Taking exactly four would put 10000 between 0000 and 0001.
//
// ONLY THE ORDER CHANGES. The code is displayed, searched and stored exactly as before; the number
// is computed for the sort and stripped from the result (`sortDerived`). Two codes with the same
// number under different prefixes — the company issued a few numbers twice on paper — fall back to
// the full code, so the order is stable from one page to the next.
import { type ListParams, type SortDerivedField } from '../../../shared/base/base.repository';

const PREFIX_DIGITS = 3;

/** The sortable key a code field gets: `code` → `codeNumber`, `employeeCode` → `employeeCodeNumber`. */
export const codeNumberKey = (field: string): string => `${field}Number`;

/**
 * The code's number as a sort value: everything after the 3-digit prefix, as a number. A code that
 * is not digits yields null, and a missing derived value sorts last whichever way the arrow points.
 */
export const codeNumberExpression = (field: string): unknown => ({
  $convert: {
    input: { $substrCP: [`$${field}`, PREFIX_DIGITS, 32] },
    to: 'long',
    onError: null,
    onNull: null,
  },
});

/**
 * What a repository passes to `list()` so that sorting by `field` orders by the number. Nothing at
 * all when the sort is by something else — every other column keeps its plain indexed query.
 */
export const employeeCodeSort = <T>(
  field: string,
  sortBy: string | undefined,
  sortDir: 'asc' | 'desc',
): Pick<ListParams<T>, 'sorts' | 'sortDerived'> => {
  if (sortBy !== field) return {};
  const key = codeNumberKey(field);
  const derived: SortDerivedField = { key, expression: codeNumberExpression(field) };
  return {
    sorts: [
      { by: key, dir: sortDir },
      { by: field, dir: sortDir },
    ],
    sortDerived: [derived],
  };
};
