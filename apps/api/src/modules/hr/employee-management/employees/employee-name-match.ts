// Which employee a NAME means — the rule behind the directory's by-names lookup.
//
// The old fleet system kept no employee ids: a driver on an odometer row is the name somebody
// typed that morning. Bringing those rows across means matching spellings to HR's file, and this
// is where that rule lives — beside HR's own search, which already folds Arabic the same way
// (`normalizeArabic`), so «أحمد» and «احمد» are one person here exactly as they are there.
//
// TWO WAYS A NAME MATCHES, in order, and no third:
//
//   1. The WHOLE name, folded and with its spaces removed. The book has «احمدصالح» where the file
//      has «احمد صالح», and «عبد الفتاح» where it has «عبدالفتاح» — spacing inside compound
//      names is the most common difference and carries no meaning, so it is dropped before
//      comparing rather than guessed at.
//   2. A PREFIX of the file's name, for a book that wrote two or three of a person's four names.
//      Only when the book's name has at least two words: a single «محمد» is the start of half the
//      company and means nobody in particular.
//
// The answer is every candidate the rule admits. ONE candidate is a match. NONE is a name HR does
// not have. SEVERAL — two employees whose file names both begin «محمد احمد» — is an ambiguity
// the caller must report, not resolve: the rule cannot tell them apart, and crediting a reading
// to whichever came first would put a name on work that is not theirs. Pure, so the rule is
// tested on spellings and nothing else.
import { normalizeArabic } from '../../shared/arabic';

/** The folded name with its spaces removed — what two spellings of one person agree on. */
export const compactName = (name: string): string => normalizeArabic(name).replace(/\s+/g, '');

/** A name has enough of a person in it to be matched as a prefix. */
const isPrefixable = (name: string): boolean => normalizeArabic(name).split(' ').length >= 2;

/**
 * For each name asked, the employees it could mean — by the two rules above, in order.
 *
 * `employees` is whatever the caller has: only `name` is read, and the whole record travels back
 * so the caller learns nothing it did not already hold. Keyed by the name AS ASKED.
 */
export const matchEmployeesByName = <T extends { name: string }>(
  names: readonly string[],
  employees: readonly T[],
): Map<string, T[]> => {
  const keyed = employees.map((employee) => ({ key: compactName(employee.name), employee }));
  const result = new Map<string, T[]>();
  for (const name of names) {
    const key = compactName(name);
    if (key === '') {
      result.set(name, []);
      continue;
    }
    const exact = keyed.filter((entry) => entry.key === key).map((entry) => entry.employee);
    if (exact.length > 0 || !isPrefixable(name)) {
      result.set(name, exact);
      continue;
    }
    result.set(
      name,
      keyed.filter((entry) => entry.key.startsWith(key)).map((entry) => entry.employee),
    );
  }
  return result;
};
