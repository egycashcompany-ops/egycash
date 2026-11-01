// The parameters a fleet-dashboard link carries to the screen behind a figure (plan §5.7, D10, R-02),
// turned into the request the same way on every screen that takes them.
//
// TWO KINDS:
//   · THE VEHICLE SET — «النوع» `type`, «التشغيل» `operation`, «الفرع» `branch`: comma lists in the
//     address bar, under the names the vehicles and maintenance screens already use, sent as
//     `typeIds`, `operationIds` and `branchIds`. Each screen's server resolves them against the
//     registry (deleted cars included) the way it resolves its own codes, so a figure narrowed to a
//     type links to a screen showing the same number however many cars the type holds.
//   · AN EXPIRY WINDOW NAMED IN DAYS — 'YYYY-MM-DD' bounds, sent as the FIRST instant of the first
//     day and the LAST instant of the last (`calendarDayBounds`, R-02). The dashboard counts with the
//     same bounds, so a licence stamped at a non-midnight instant on its expiry day is in both.
//
// Each page READS its own parameters (`readList(sp, 'type')`, `sp.get('licExpFrom')`), so its source
// names every parameter it takes: the remembered-filters census and the dashboard's link census both
// look for them there. What lives here is only what the pages would otherwise each spell out.
import { calendarDayBounds, isYmd, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { localized } from '../../../shared/lib/format';
import { type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { useVehicleTypes } from '../api/fleet-queries';

/** The vehicle set as a page read it from its own address bar. */
export interface VehicleSetFilter {
  /** `type` — vehicle type ids («الماركة» on the registry). */
  typeIds: readonly string[];
  /** `operation` — operation catalog ids. */
  operationIds: readonly string[];
  /** `branch` — the branch a car is registered to. */
  branchIds: readonly string[];
}

/** The list and summary endpoints' fields for the set (D10). */
export interface VehicleSetQuery {
  typeIds?: string[];
  operationIds?: string[];
  branchIds?: string[];
}

/**
 * The set as the request carries it: ONLY the lists that hold something.
 *
 * An empty list is an absent filter, never "match nothing", and leaving it out — rather than sending
 * it as `undefined` — keeps the request and its query key exactly what an un-narrowed screen asked
 * before these parameters existed.
 */
export const vehicleSetQuery = (set: VehicleSetFilter): VehicleSetQuery => ({
  ...(set.typeIds.length === 0 ? {} : { typeIds: [...set.typeIds] }),
  ...(set.operationIds.length === 0 ? {} : { operationIds: [...set.operationIds] }),
  ...(set.branchIds.length === 0 ? {} : { branchIds: [...set.branchIds] }),
});

/** Does the set narrow anything? The screens show its controls, and count it as a filter, only then. */
export const hasVehicleSet = (set: VehicleSetFilter): boolean =>
  set.typeIds.length > 0 || set.operationIds.length > 0 || set.branchIds.length > 0;

/** The whole set dropped in ONE write — for a screen's reset, beside its other filters. */
export const CLEAR_VEHICLE_SET = { type: null, operation: null, branch: null } as const;

/**
 * The vehicle types as a multi-select offers them, in the catalog's order — the list the registry's
 * «الماركة» filter reads (same cache entry). Asked for only while `enabled`, so a screen that shows
 * the control only when a link narrows it costs no request on an ordinary visit.
 */
export const useVehicleTypeOptions = (enabled: boolean): MultiSelectOption[] => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data } = useVehicleTypes({ pageSize: 100 }, enabled);
  return (data?.items ?? []).map((type) => ({
    value: type.id,
    label: localized(type.name, locale),
  }));
};

/**
 * One bound of an expiry window, as the request carries it.
 *
 * A real day becomes the first instant of `from` and the last instant of `before` (R-02: a document
 * is expired ON its expiry day, and a window [a, b] holds everything dated a … b whatever the time
 * it was stamped at). A value that is not a real day is sent as written, so the server answers it as
 * it always has — a refusal — instead of the page quietly dropping a narrowing its address bar shows.
 */
const bound = (value: string, side: 'from' | 'before'): string | undefined => {
  if (value === '') return undefined;
  if (!isYmd(value)) return value;
  const bounds = calendarDayBounds(value, value);
  return (side === 'from' ? bounds.from : bounds.before).toISOString();
};

/** An expiry window named in days ('YYYY-MM-DD'; '' = open on that side), as the request's two bounds. */
export const expiryWindowQuery = (
  from: string,
  before: string,
): { from: string | undefined; before: string | undefined } => ({
  from: bound(from, 'from'),
  before: bound(before, 'before'),
});

/** `2026-11-01` → `2026/11/01`, the way the Fleet boards write a day. */
const slashDay = (ymd: string): string => ymd.replace(/-/gu, '/');

/**
 * The window in words, for the control that shows it while it narrows the screen: «من 2026/11/02 إلى
 * 2026/12/01», «حتى 2026/11/01», «من 2026/11/02». `null` when neither side is set.
 */
export const expiryWindowLabel = (
  from: string,
  before: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null => {
  if (from !== '' && before !== '') {
    return t('fleet.filters.expiryWindow.between', { from: slashDay(from), to: slashDay(before) });
  }
  if (before !== '') return t('fleet.filters.expiryWindow.until', { to: slashDay(before) });
  if (from !== '') return t('fleet.filters.expiryWindow.from', { from: slashDay(from) });
  return null;
};
