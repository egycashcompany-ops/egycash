/**
 * The dark filter bar of the Fleet boards (السيارات · بطاقات الوقود · شحن الكروت), laid over
 * `FilterBar` — shared since another module's screen wears the same bar (`shared/ui/dark-filter-bar`).
 */
export { DARK_FILTER_BAR } from '../../../shared/ui/dark-filter-bar';

/**
 * One answer out of a `MultiSelect`: the option just ticked replaces the one before, so a list of
 * two companies or of ready date windows reads as a single choice in the same control.
 */
export const pickOne = (previous: readonly string[], next: readonly string[]): string | null =>
  next.find((value) => !previous.includes(value)) ?? next[next.length - 1] ?? null;
