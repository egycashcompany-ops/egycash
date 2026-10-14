// /atm/machines «كل الماكينات» — the parts of the screen a suite can reach without a DOM: what the
// filters ask the API, how a typed ID list is read, what the ID picker offers, the export.
//
// THE FILTER IS THE SERVER'S. The directory holds some 2,600 active machines and the list is paged,
// so a filter applied to the rows in hand would only ever narrow the page being looked at — and the
// counts beside the title, the pages and the export would each answer a different question. Every
// filter here is a query parameter (`ListAtmMachinesQuerySchema`), and the summary, the pages and
// the export all send the same ones.
import {
  ATM_MACHINE_CODES_MAX,
  joinAtmNameList,
  normalizeAtmMachineCode,
  splitAtmMachineCodeList,
  type AtmMachineDto,
  type PageMeta,
  type Paginated,
} from '@ecms/contracts';
import { type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { fetchWholeBoard } from './whole-board';

/** The order the screen opens in — by code, as it always has. No header shows an arrow for it. */
export const MACHINES_DEFAULT_SORT = 'machineCode:asc';

/** Rows per page, before the reader chooses — the vehicles registry's. */
export const MACHINES_DEFAULT_PAGE_SIZE = 25;

/** The column filters, in the table's column order: Bank · ID · ATM Name · Area. */
export interface MachineFilters {
  banks: readonly string[];
  codes: readonly string[];
  name: string;
  areas: readonly string[];
}

/** Is anything narrowed? A name of only spaces narrows nothing. */
export const hasMachineFilters = (filters: MachineFilters): boolean =>
  filters.banks.length > 0 ||
  filters.codes.length > 0 ||
  filters.name.trim() !== '' ||
  filters.areas.length > 0;

/**
 * The filters as the API reads them — absent when not narrowed, never an empty list. ACTIVE
 * machines only, always: the page is the legacy /all_atm, which listed the active ones.
 */
export const machineFilterQuery = (filters: MachineFilters): Record<string, string> => {
  const name = filters.name.trim();
  return {
    isActive: 'true',
    ...(filters.banks.length > 0 ? { banks: joinAtmNameList(filters.banks) } : {}),
    ...(filters.codes.length > 0 ? { codes: filters.codes.join(',') } : {}),
    ...(name !== '' ? { name } : {}),
    ...(filters.areas.length > 0 ? { areas: joinAtmNameList(filters.areas) } : {}),
  };
};

/** A machine code holds no space or comma, so any of these ends one being typed. */
const CODE_SEPARATOR = /[\s,،;؛]/u;

/**
 * What is typed into the ID picker's box: the codes already COMPLETED — each followed by a
 * separator — and the fragment still being typed, which is what the picker searches for.
 * `0123 0456 78` takes 123 and 456 and leaves `78` in the box.
 */
export const readTypedMachineCodes = (raw: string): { chosen: string[]; typing: string } => {
  let last = -1;
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    if (CODE_SEPARATOR.test(raw.charAt(index))) {
      last = index;
      break;
    }
  }
  if (last === -1) return { chosen: [], typing: raw };
  return { chosen: splitAtmMachineCodeList(raw.slice(0, last)), typing: raw.slice(last + 1) };
};

/**
 * What the ID picker's box now holds, read against what it held a moment ago. TYPED — one
 * character at a time — it is `readTypedMachineCodes`: a code is taken once its separator follows.
 * PASTED — more than one character at once, a separator among them — it is a list, and EVERY code
 * in it is taken, the last one too. A browser pasting a column into a one-line box turns its new
 * lines into spaces and drops the final one, so the last code arrives with no separator after it;
 * read as typing, it stayed in the box and was lost when the list closed.
 */
export const readMachineCodeInput = (
  before: string,
  raw: string,
): { chosen: string[]; typing: string } =>
  raw.length - before.length > 1 && CODE_SEPARATOR.test(raw)
    ? { chosen: splitAtmMachineCodeList(raw), typing: '' }
    : readTypedMachineCodes(raw);

/**
 * The fragment the ID picker searches for, normalized as every stored code is
 * (`normalizeAtmMachineCode`): `0123` looks for machine 123, which a stored `0123` never is. Only
 * zeros ask for nothing in particular.
 */
export const machineCodeSearchTerm = (typing: string): string => normalizeAtmMachineCode(typing);

/**
 * `codes` added to the ID filter's `value`, each once, up to the most one filter may ask
 * (`ATM_MACHINE_CODES_MAX` — the API refuses a longer list, and the page would show nothing but
 * an error). `dropped` counts the codes that did not fit, so the reader can be told.
 */
export const addMachineCodes = (
  value: readonly string[],
  codes: readonly string[],
  max: number = ATM_MACHINE_CODES_MAX,
): { next: string[]; dropped: number } => {
  const next = value.slice(0, max);
  let dropped = value.length - next.length;
  for (const code of codes) {
    if (next.includes(code)) continue;
    if (next.length < max) next.push(code);
    else dropped += 1;
  }
  return { next, dropped };
};

/**
 * The last page, when the page asked for is past it — a branch switch or an old link keeps
 * `?page=5` over a set of two pages, and the screen said «no machines» beside counts saying thirty
 * — or `null` while it is in range. A set with nothing in it has no page to go to.
 */
export const pageBeyondEnd = (page: number, meta: PageMeta): number | null =>
  meta.totalItems > 0 && page > meta.totalPages ? Math.max(1, meta.totalPages) : null;

/**
 * The ID picker's list: what is chosen first — so it can always be seen and unticked, even when the
 * search has moved past it — then what the search found. A machine reads «code — name» in the
 * list and by its code alone in the trigger.
 */
export const machineCodeOptions = (
  found: readonly AtmMachineDto[],
  chosen: readonly string[],
): MultiSelectOption[] => {
  const byCode = new Map(found.map((machine) => [machine.machineCode, machine]));
  const option = (code: string): MultiSelectOption => {
    const machine = byCode.get(code);
    return machine === undefined
      ? { value: code, label: code }
      : { value: code, label: `${code} — ${machine.name}`, shortLabel: code };
  };
  return [
    ...chosen.map(option),
    ...found.filter((machine) => !chosen.includes(machine.machineCode)).map((m) => option(m.machineCode)),
  ];
};

/**
 * EVERY machine the filter matched, for the export — not the page in hand. The walk is the open
 * boards' (`fetchWholeBoard`): every page at the platform cap, each machine once, read again if the
 * pages disagree about how many there are. `fetchPage` carries the screen's filters and order.
 */
export const fetchMachinesForExport = async (
  fetchPage: (page: number, pageSize: number) => Promise<Paginated<AtmMachineDto>>,
): Promise<AtmMachineDto[]> => (await fetchWholeBoard(fetchPage)).items;

/**
 * The legacy export's four columns (all_atm.ejs:986), as CSV with a UTF-8 BOM so Excel opens the
 * Arabic correctly — a dependency-free equivalent recorded in the port doc.
 */
export const machinesCsv = (rows: readonly AtmMachineDto[]): string => {
  const escape = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const lines = [
    ['Bank', 'ID', 'ATM Name', 'Area'].join(','),
    ...rows.map((row) => [row.bankName, row.machineCode, row.name, row.area].map(escape).join(',')),
  ];
  // BOM: Excel misreads UTF-8 Arabic without it.
  return '﻿' + lines.join('\n');
};
