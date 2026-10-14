// The machine list's filters (/atm/machines «كل الماكينات»), as plain functions over the query.
//
// One clause per column the reader narrowed, ANDed: Bank and Area are names (ORed within the
// column, each resolved to the stored spellings it stands for — `board-filter.ts`), ID is the codes
// named exactly and/or a substring of the code, ATM Name a substring of the name. Every substring
// is taken LITERALLY — a typed «.» or «(» is a character to find, never a pattern — and matched
// without regard to case.
//
// The same clauses serve the page, the export (every page of it) and the summary, so the three can
// never disagree about which machines a filter means. The summary's dropdowns use them with one
// column's own choice left out (`leave`) — the faceted rule the contract describes.
import { type AtmMachinesSummaryQuery } from '@ecms/contracts';

/** The fields the list and the summary filter by — the summary's query is exactly them. */
export type AtmMachineFilterQuery = AtmMachinesSummaryQuery;

/** The column whose own choice a dropdown leaves out when it asks what to offer. */
export type AtmMachineFacet = 'banks' | 'areas';

/**
 * The stored spellings the chosen bank and area names stand for, resolved by the caller over the
 * machines in scope. `undefined` — that column was not narrowed; `[]` — it was, to names nothing in
 * scope carries, and so it matches nothing.
 */
export interface AtmMachineSpellings {
  bankName?: string[] | undefined;
  area?: string[] | undefined;
}

/** Typed text as a literal inside a regular expression. */
export const literalPattern = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A case-insensitive substring match on a stored text field. */
const contains = (text: string): { $regex: string; $options: string } => ({
  $regex: literalPattern(text),
  $options: 'i',
});

/** The clauses one query asks for, in column order; `leave` drops that dropdown's own choice. */
export const machineFilterClauses = (
  query: AtmMachineFilterQuery,
  spellings: AtmMachineSpellings,
  leave?: AtmMachineFacet,
): Record<string, unknown>[] => {
  const clauses: Record<string, unknown>[] = [];
  if (query.isActive !== undefined) clauses.push({ isActive: query.isActive });
  // The list's existing parameters, exactly as they always read.
  if (query.bankName !== undefined) clauses.push({ bankName: query.bankName });
  if (query.area !== undefined) clauses.push({ area: query.area });
  if (query.search !== undefined && query.search !== '') {
    clauses.push({
      $or: [
        { machineCode: { $regex: query.search, $options: 'i' } },
        { name: { $regex: query.search, $options: 'i' } },
      ],
    });
  }
  // Bank · ID · ATM Name · Area — the table's own order.
  if (leave !== 'banks' && spellings.bankName !== undefined) {
    clauses.push({ bankName: { $in: spellings.bankName } });
  }
  if (query.codes !== undefined && query.codes.length > 0) {
    clauses.push({ machineCode: { $in: query.codes } });
  }
  if (query.code !== undefined && query.code !== '') {
    clauses.push({ machineCode: contains(query.code) });
  }
  if (query.name !== undefined && query.name !== '') clauses.push({ name: contains(query.name) });
  if (leave !== 'areas' && spellings.area !== undefined) {
    clauses.push({ area: { $in: spellings.area } });
  }
  return clauses;
};

/** The clauses as one filter: nothing, the one clause, or all of them ANDed. */
export const allOf = (clauses: readonly Record<string, unknown>[]): Record<string, unknown> => {
  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0] as Record<string, unknown>;
  return { $and: [...clauses] };
};
