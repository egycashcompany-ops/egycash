// The category and name filters of the two IT registers, as plain functions — «في الـ it/assets
// عايز فلتر الأسم يبقي بعد الفئات (فى الفلتر فقط) والبيانات اللى فى فلتر الفئات هي نفسها تتفلتر بناء
// على الفئات وعايز الأتنين دول يبقوا Multiselect · وفى /it/custody بردو عايز الصنف يبقي بعد الفئة».
// The asset list's «الاسم» and the custody register's «الصنف» ask the same question of the same
// names, so both screens read them through here and `useCategoryNameFilter` wires them up once.
//
// THE ADDRESS BAR. Both filters are lists, each ONE parameter: `category` the ids joined by commas
// (an id holds none), the names joined by the platform's name list (`joinNameList`) — an asset's
// name is free text and may hold a comma, which a plain split would cut in two. A link written
// when each filter took one value is a list of one, and reads exactly as it did.
//
// THE CASCADE. The names offered depend on the categories chosen — none chosen, every name. So a
// category change can leave a chosen name the new categories do not have: pick «طابعة HP» under
// «طابعات», switch to «لاب توب», and the register asked for laptops named «طابعة HP» and came up
// empty with nothing on screen to say why. A category change drops those names — but only once the
// new list has ARRIVED: pruning against a list still loading, being re-read, or that failed would
// erase a perfectly good choice. The ATM boards' bank → area filters follow the same rule, and this
// is their shape (`atm/lib/board-filters.ts`).
//
// A CHOICE THE LIST DOES NOT OFFER. Outside a category change nothing is dropped: a linked or
// remembered name stays chosen and stays LISTED (ticked) in its dropdown, so it can be seen and
// unticked, and an empty table says the filter matched nothing.
import { joinNameList, splitNameList, type ItAssetNamesDto } from '@ecms/contracts';
import { type MultiSelectOption } from '../../../shared/ui/MultiSelect';

/**
 * As many as the API takes in one list (`listQuery` / `nameListQuery`, 50): a longer link or
 * remembered view asks for the first ones rather than for a refused request.
 */
export const FILTER_LIST_MAX = 50;

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** The `category` parameter → the ids it carries, each once. */
export const readCategoryIds = (raw: string | null): string[] =>
  unique(
    (raw ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== ''),
  ).slice(0, FILTER_LIST_MAX);

/** A names parameter → the names it carries, each once — a name holding a comma arrives whole. */
export const readNames = (raw: string | null): string[] =>
  unique(splitNameList(raw ?? '')).slice(0, FILTER_LIST_MAX);

/**
 * The chosen names out of the address bar. The list lives in `param`; `legacy` is where the single
 * name filter kept its ONE name, written RAW — «Canon, imageCLASS» as it stands, never escaped —
 * so a link or a remembered view from then is read as that one name, whole, and never split at
 * its comma. The list's own parameter wins when both are there.
 */
export const readChosenNames = (sp: URLSearchParams, param: string, legacy?: string): string[] => {
  if (sp.has(param) || legacy === undefined) return readNames(sp.get(param));
  const single = (sp.get(legacy) ?? '').trim();
  return single === '' ? [] : [single];
};

/**
 * What a pick writes: each once, at most `FILTER_LIST_MAX` — capped where it is WRITTEN, so the
 * address bar never holds more than is read back, and a pick past the cap changes nothing rather
 * than leaving the screen waiting for a selection it can never show.
 */
export const capList = (values: readonly string[]): string[] =>
  unique(values).slice(0, FILTER_LIST_MAX);

/** Ids → one parameter value; `''` (no parameter at all) for none. */
export const writeCategoryIds = (ids: readonly string[]): string => ids.join(',');

/** Names → one parameter value, commas escaped; `''` (no parameter at all) for none. */
export const writeNames = (names: readonly string[]): string => joinNameList(names);

/**
 * The two as a list request carries them — the URL's own values, absent when not narrowed. Names
 * go as ONE escaped string: the request's `buildQuery` joins an array with plain commas, which is
 * right for ids and wrong for a name that holds one.
 */
export const categoryQuery = (ids: readonly string[]): string | undefined =>
  ids.length === 0 ? undefined : writeCategoryIds(ids);
export const namesQuery = (names: readonly string[]): string | undefined =>
  names.length === 0 ? undefined : writeNames(names);

/** One category selection as a key a pending prune is matched against — order does not matter. */
export const categoryKey = (ids: readonly string[]): string => [...ids].sort().join(',');

/**
 * The names dropdown's options: what the register offers for these categories, then — after it —
 * anything chosen it does not offer, so a choice is never invisible and can always be unticked.
 */
export const nameFilterOptions = (
  offered: readonly string[],
  chosen: readonly string[],
): MultiSelectOption[] => {
  const listed = new Set(offered);
  return [
    ...offered.map((name) => ({ value: name, label: name })),
    ...chosen.filter((name) => !listed.has(name)).map((name) => ({ value: name, label: name })),
  ];
};

/** The names query, as the dropdown and the prune read it. */
export interface NamesQuery {
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  isPlaceholderData: boolean;
  data: ItAssetNamesDto | undefined;
}

/**
 * The dropdown's options out of the names query, and what its empty list should say.
 *
 * `loading` while this choice's names are on their way — the first read, or a retry after a
 * failure. `failed` when they could not be read and nothing is being tried: the list then says so
 * instead of «no results», which would claim no asset has the name being typed.
 */
export const nameFilterList = (
  query: Pick<NamesQuery, 'isFetching' | 'isError' | 'isPlaceholderData' | 'data'>,
  chosen: readonly string[],
): { options: MultiSelectOption[]; loading: boolean; failed: boolean } => {
  const offered = query.isPlaceholderData ? undefined : query.data?.names;
  return {
    options: nameFilterOptions(offered ?? [], chosen),
    loading: offered === undefined && (query.isFetching || !query.isError),
    failed: offered === undefined && query.isError && !query.isFetching,
  };
};

/** Where the names for the CURRENT categories stand, for pruning. */
export type NamesRead =
  | { status: 'loading' }
  | { status: 'error' }
  /** `truncated`: the list is capped and does not hold every name — absence proves nothing. */
  | { status: 'ready'; names: readonly string[]; truncated: boolean };

/**
 * The names query, read for pruning. Anything being fetched is `loading` — including cached names
 * being re-read, which may be a minute old; a failure is `error` even if older names are still
 * held; placeholder data is another choice's answer, so `loading` too.
 */
export const namesRead = (query: NamesQuery): NamesRead => {
  if (query.isFetching) return { status: 'loading' };
  if (query.isError) return { status: 'error' };
  if (query.isPlaceholderData) return { status: 'loading' };
  if (query.isSuccess && query.data !== undefined) {
    return { status: 'ready', names: query.data.names, truncated: query.data.truncated };
  }
  return { status: 'loading' };
};

/** A category change the reader just made while names were chosen: the selection before, and after. */
export interface PendingCategoryChange {
  from: string;
  to: string;
  /**
   * The address bar has shown `to`. Until it does, showing `from` means the router has not caught
   * up yet; once it has, showing `from` again is a Back press — the reader left the change.
   */
  arrived: boolean;
}

/** The change a category pick records, before the address bar has shown it. */
export const pendingCategoryChange = (
  from: readonly string[],
  to: readonly string[],
): PendingCategoryChange => ({ from: categoryKey(from), to: categoryKey(to), arrived: false });

export type NamePrune =
  /** Nothing pending, or the pending change is settled without a write. */
  | { kind: 'none' }
  /** A category change is waiting — for the address bar to show it, or for its names. */
  | { kind: 'wait' }
  /** Write these names (some chosen ones are not offered under the new categories). */
  | { kind: 'prune'; names: string[] };

/**
 * What a pending category change does to the chosen names.
 *
 * The address bar decides which case this is. Still showing the selection BEFORE the change, and
 * never yet the one chosen, it has not caught up: wait. Showing the selection the reader chose:
 * prune against that selection's names once they have arrived. Showing anything else — another
 * link, a reset, or a Back press after it showed the new one — moved it somewhere the reader did
 * not just choose, and nothing is pruned. A failed read prunes nothing either: it knows nothing
 * about which names exist, and the choice stays visible to untick by hand.
 */
export const decideNamePrune = ({
  pending,
  categoryIds,
  names,
  read,
}: {
  pending: PendingCategoryChange | null;
  categoryIds: readonly string[];
  names: readonly string[];
  read: NamesRead;
}): NamePrune => {
  // A pick that left the categories as they were changes nothing to settle.
  if (pending === null || names.length === 0 || pending.from === pending.to) {
    return { kind: 'none' };
  }
  const shown = categoryKey(categoryIds);
  if (shown !== pending.to) {
    return shown === pending.from && !pending.arrived ? { kind: 'wait' } : { kind: 'none' };
  }
  if (read.status === 'loading') return { kind: 'wait' };
  if (read.status === 'error') return { kind: 'none' };
  // A capped list does not hold every name: a chosen name missing from it may well exist.
  if (read.truncated) return { kind: 'none' };
  const offered = new Set(read.names);
  const kept = names.filter((name) => offered.has(name));
  return kept.length === names.length ? { kind: 'none' } : { kind: 'prune', names: kept };
};

/**
 * The pending change after a render that decided `prune`: gone once settled (anything but `wait`),
 * marked `arrived` the first time the address bar shows the selection the reader chose, and
 * otherwise the very same object — so the hook writes no state when nothing moved, and a settled
 * change can never be decided twice.
 */
export const nextPendingCategoryChange = (
  pending: PendingCategoryChange | null,
  categoryIds: readonly string[],
  prune: NamePrune,
): PendingCategoryChange | null => {
  if (pending === null || prune.kind !== 'wait') return null;
  if (!pending.arrived && categoryKey(categoryIds) === pending.to) {
    return { ...pending, arrived: true };
  }
  return pending;
};
