// «توزيع المحصنات» — the two filter bars (Round 25).
//
// THE OWNER: «عاوز بقى الجنب اللى على الشمال اللى فيه المحصنات قبل ما تتعين احط فلتر فوق يبقى خانة اقدر
// ابحث عن البنك او الفرع و خانة للمنطقة» and «عاوز بقى الجنب اللى على اليمين اللى فيه العربيات احط فلتر
// فوق يبقى خانة اقدر ابحث عن كود العربيه و خانة البنك او الفرع و خانة للمنطقة».
//
//   · THE LEFT (the محصنات on no van): one box for the bank OR the branch — the billed bank's name, or
//     either branch with its own bank — and the area, chosen among the areas those محصنات name;
//   · THE RIGHT (the vans): the van's code (or «بدون سيارة (n)»), the bank or branch (a van answers
//     when one of the محصنات on it does), and the area (a van answers when its direction names it, or
//     one of its محصنات is of it). Round 26b — «وعاوز اضيف اسم القائد فى الفلاتر بعد العربيه»: the
//     captain's name, after the code — a van answers when ANY of its captains does, by his name or
//     his employee code (the card shows the first; the box finds him whichever he is).
// Every box folds as the pools' search does («الاهلى» finds «الأهلي», «١٠٤» finds 104); the boxes of a
// bar are AND-ed. VIEW ONLY: a filtered-out van keeps what the person put on it, and «حفظ» saves every
// change, seen or not; a محصنة hidden on the left is still moved by «نقل إلى…» or proposed.
import { foldOperationsAreaName } from '@ecms/contracts';
import { fold, foldIncludes } from '../../../shared/lib/fold';
import { directionParts } from './crew-plan-filter';

/** The area box's «بلا منطقة» — a محصنة that names none. */
export const NO_AREA = 'none';

export interface UnplacedFilter {
  /** A bank or a branch, as typed. Blank — every محصنة. */
  search: string;
  /** A folded area (`foldOperationsAreaName`), `NO_AREA`, or '' — every area. */
  area: string;
}

export interface VanFilter {
  /** A van's code, as typed. Blank — every van. */
  code: string;
  /** A captain's name (or employee code), as typed — Round 26b. Blank — every van. */
  captain: string;
  /** A bank or a branch, as typed: a van answers through its محصنات. */
  search: string;
  /** A folded area, `NO_AREA` (a van with no direction), or '' — every van. */
  area: string;
}

export const EMPTY_UNPLACED_FILTER: UnplacedFilter = { search: '', area: '' };
export const EMPTY_VAN_FILTER: VanFilter = { code: '', captain: '', search: '', area: '' };

export const isUnplacedFiltering = (filter: UnplacedFilter): boolean =>
  filter.search.trim() !== '' || filter.area !== '';

export const isVanFiltering = (filter: VanFilter): boolean =>
  filter.code.trim() !== '' ||
  filter.captain.trim() !== '' ||
  filter.search.trim() !== '' ||
  filter.area !== '';

/** The facts of a محصنة the filters read — the specs build rows with no more. */
export interface FilterShipment {
  mainBankId: string;
  areaName: string | null;
  origin: { name: string; bankName: string } | null;
  destination: { name: string; bankName: string } | null;
}

/**
 * Does the محصنة answer the bank-or-branch box? Its billed bank (every name the page knows it by —
 * `bankWordsOf`), its two branches by name, and each branch's own bank.
 */
export const shipmentMatchesSearch = (
  row: FilterShipment,
  search: string,
  bankWordsOf: (bankId: string) => readonly string[],
): boolean => {
  if (fold(search) === '') return true;
  const words = [
    ...bankWordsOf(row.mainBankId),
    row.origin?.name ?? '',
    row.origin?.bankName ?? '',
    row.destination?.name ?? '',
    row.destination?.bankName ?? '',
  ];
  return words.some((word) => word !== '' && foldIncludes(word, search));
};

/** The محصنة's area, folded the server's way — '' for one that names none. */
const areaOf = (row: Pick<FilterShipment, 'areaName'>): string =>
  row.areaName === null || row.areaName.trim() === '' ? '' : foldOperationsAreaName(row.areaName);

/** Is the محصنة of this area (`NO_AREA`: of none)? An empty choice takes every one. */
export const shipmentMatchesArea = (row: Pick<FilterShipment, 'areaName'>, area: string): boolean =>
  area === '' || (area === NO_AREA ? areaOf(row) === '' : areaOf(row) === area);

/** One محصنة on the left against its bar, AND-ed. */
export const matchesUnplacedFilter = (
  row: FilterShipment,
  filter: UnplacedFilter,
  bankWordsOf: (bankId: string) => readonly string[],
): boolean =>
  shipmentMatchesArea(row, filter.area) && shipmentMatchesSearch(row, filter.search, bankWordsOf);

/**
 * The left area box's choices: every area the محصنات given name, once (folded, so «المعادى» and
 * «المعادي» are one), by its first spelling, in Arabic order — then «بلا منطقة» when one names none
 * (the page words it). An area chosen that the list no longer has stays offered (`keep`), so the box
 * never shows a choice it cannot name.
 */
export const shipmentAreaOptions = (
  rows: readonly Pick<FilterShipment, 'areaName'>[],
  keep = '',
): { value: string; label: string }[] => {
  const byValue = new Map<string, string>();
  let none = false;
  for (const row of rows) {
    const value = areaOf(row);
    if (value === '') none = true;
    else if (!byValue.has(value)) byValue.set(value, (row.areaName ?? '').trim());
  }
  const options = [...byValue.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  if (keep !== '' && keep !== NO_AREA && !byValue.has(keep))
    options.push({ value: keep, label: keep });
  if (none || keep === NO_AREA) options.push({ value: NO_AREA, label: '' });
  return options;
};

/** The facts of a van the right bar reads. */
export interface FilterVan {
  vehicleCode: string | null;
  direction: string | null;
  /** Its captains, in the order put on the row — every one, not only the one the card shows. */
  captains?: readonly { fullNameAr: string | null; code: string | null }[];
}

/**
 * Does the van answer the code box? Its code, or — a crew without a van — the name the screen gives
 * it («بدون سيارة (2)», `name`), folded: «١٠٤» finds 104, «بدون» every crew without one.
 */
export const vanMatchesCode = (van: FilterVan, code: string, name: string): boolean => {
  if (fold(code) === '') return true;
  return foldIncludes(van.vehicleCode ?? '', code) || foldIncludes(name, code);
};

/**
 * A name or a code folded for the captain box, its spaces gone too (R26b critic): «عبدالرحمن» finds
 * «عبد الرحمن» (the compound names are written both ways), «br 108» finds «BR-108».
 */
const squash = (value: string): string => fold(value).replace(/\s+/g, '');

/**
 * Which of the van's captains answers the captain box (Round 26b) — the index in the order put on
 * the row, the first who does; null when none does, or the box is blank. By his name or his employee
 * code, folded as every box here is («احمد» finds «أحمد», «مصطفي» «مصطفى», «الشناويه» «الشناوية»,
 * «br-107» «BR-107»), spaces aside.
 */
export const vanCaptainMatch = (van: FilterVan, captain: string): number | null => {
  const needle = squash(captain);
  if (needle === '') return null;
  const at = (van.captains ?? []).findIndex(
    (one) =>
      squash(one.fullNameAr ?? '').includes(needle) ||
      (one.code !== null && one.code !== '' && squash(one.code).includes(needle)),
  );
  return at === -1 ? null : at;
};

/**
 * Does the van answer the captain box? ANY of its captains — the first, the one the card shows, or
 * the second (the card then says which, `vanCaptainMatch`). A van with no captain answers no typed
 * name.
 */
export const vanMatchesCaptain = (van: FilterVan, captain: string): boolean =>
  squash(captain) === '' || vanCaptainMatch(van, captain) !== null;

/**
 * Is the van of this area: its direction names it (a direction of two areas, «المعادي - حلوان», is
 * of each — `directionParts`, the board's own reading), or one of its محصنات is of it. `NO_AREA` — a
 * van with no direction.
 */
export const vanMatchesArea = (
  van: FilterVan,
  load: readonly Pick<FilterShipment, 'areaName'>[],
  area: string,
  areaNames: readonly string[] = [],
): boolean => {
  if (area === '') return true;
  const parts = directionParts(van.direction, areaNames);
  if (area === NO_AREA) return parts.length === 0;
  return parts.some((part) => part.value === area) || load.some((row) => areaOf(row) === area);
};

/**
 * One van against the right bar, AND-ed: its code, its captains (Round 26b), the bank or branch of its
 * محصنات, the area.
 */
export const matchesVanFilter = (
  van: FilterVan,
  load: readonly FilterShipment[],
  filter: VanFilter,
  context: {
    /** The van's name on the screen — «بدون سيارة (2)» for a crew without one. */
    name: string;
    bankWordsOf: (bankId: string) => readonly string[];
    areaNames?: readonly string[];
  },
): boolean =>
  vanMatchesCode(van, filter.code, context.name) &&
  vanMatchesCaptain(van, filter.captain) &&
  (fold(filter.search) === '' ||
    load.some((row) => shipmentMatchesSearch(row, filter.search, context.bankWordsOf))) &&
  vanMatchesArea(van, load, filter.area, context.areaNames);

/**
 * The right area box's choices: every area the vans' directions name and every area their محصنات
 * name, once, in Arabic order — then «بلا اتجاه» (`NO_AREA`) when a van has no direction.
 */
export const vanAreaOptions = (
  vans: readonly { van: FilterVan; rows: readonly Pick<FilterShipment, 'areaName'>[] }[],
  areaNames: readonly string[] = [],
  keep = '',
): { value: string; label: string }[] => {
  const byValue = new Map<string, string>();
  let none = false;
  for (const { van, rows } of vans) {
    const parts = directionParts(van.direction, areaNames);
    if (parts.length === 0) none = true;
    for (const part of parts) if (!byValue.has(part.value)) byValue.set(part.value, part.label);
    for (const row of rows) {
      const value = areaOf(row);
      if (value !== '' && !byValue.has(value)) byValue.set(value, (row.areaName ?? '').trim());
    }
  }
  const options = [...byValue.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  if (keep !== '' && keep !== NO_AREA && !byValue.has(keep))
    options.push({ value: keep, label: keep });
  if (none || keep === NO_AREA) options.push({ value: NO_AREA, label: '' });
  return options;
};
