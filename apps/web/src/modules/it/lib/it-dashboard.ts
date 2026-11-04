// The `/it` dashboard's rules, as plain functions — «عايزك تعمل فى الـ /it الرئيسية.. Dashboard بدل
// اللى موجود فيها يظهر إجمالى الأصول وإيه فى المخزن وإيه متسلم بس أقدر أفلتر بـالفئة.. من خلال Drop
// Down بـ Multiselection» (the sample approved: «ماشى تمام كمل»). The page renders; what a click
// writes and where a figure leads are decided here, where a spec can read them without a browser.
//
// THE FILTERS are the asset register's own: `category` (ids, comma-joined — `category-name-filter`)
// and `branch` (one id). So a dashboard narrowed to «لاب توب» in «أكتوبر» and the register it opens
// are the same view written the same way.
//
// EVERY FIGURE OPENS ITS LIST, carrying the dashboard's filters under the TARGET page's own names:
// a count the reader cannot open is a number they have to take on trust.
import { type ItAssetStatus, type ItAssetStatusCountsDto } from '@ecms/contracts';
import { capList, writeCategoryIds } from './category-name-filter';

export interface DashboardFilters {
  /** The categories chosen, in the order they were picked; none → every category. */
  categoryIds: readonly string[];
  /** One branch, or `''` for every branch the reader may see. */
  branchId: string;
}

/** What the dashboard asks the server: absent where not narrowed (`ItDashboardQuerySchema`). */
export const dashboardQuery = ({
  categoryIds,
  branchId,
}: DashboardFilters): { categoryId?: string; branchId?: string } => ({
  ...(categoryIds.length === 0 ? {} : { categoryId: writeCategoryIds(categoryIds) }),
  ...(branchId === '' ? {} : { branchId }),
});

/**
 * «حسب الفئة»: a click on a category adds it to the filter, a second click takes it out — the
 * dropdown's own tick, from the row. Capped as the dropdown is, so the URL never holds more than
 * is read back.
 */
export const toggleCategory = (chosen: readonly string[], categoryId: string): string[] =>
  chosen.includes(categoryId)
    ? chosen.filter((id) => id !== categoryId)
    : capList([...chosen, categoryId]);

/** «حسب الفرع»: a click shows that branch alone; a click on the branch already shown clears it. */
export const pickBranch = (current: string, branchId: string): string =>
  current === branchId ? '' : branchId;

/** A path and its query, the empty values left out. */
const href = (path: string, params: Record<string, string>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== '') query.set(key, value);
  const text = query.toString();
  return text === '' ? path : `${path}?${text}`;
};

/** The dashboard's filters as every IT register writes them: `category` and `branch`. */
const scope = ({ categoryIds, branchId }: DashboardFilters): Record<string, string> => ({
  category: writeCategoryIds(categoryIds),
  branch: branchId,
});

/**
 * A KPI tile's register: the asset list under the same filters, in that state — or in every state
 * for «إجمالي الأصول».
 *
 * NEVER A BARE URL. The register remembers how its reader left it and restores that view on a bare
 * arrival (`useRememberedFilters`), so «إجمالي الأصول» with nothing narrowed would open on
 * yesterday's «طابعات» and show a different number from the one pressed. An empty `status=` — the
 * status box's own «كل الحالات» — says "this exact view", and the register then forgets the old one.
 */
export const assetsLink = (filters: DashboardFilters, status: ItAssetStatus | null): string => {
  const link = href('/it/assets', { ...scope(filters), status: status ?? '' });
  return link === '/it/assets' ? '/it/assets?status=' : link;
};

/** «يحتاج متابعة»'s three custody rows (the fourth, the warranty, opens the asset list). */
export type AttentionRow = 'heldByLeavers' | 'receiptsAwaitingSignature' | 'overdueReturns';

/**
 * A custody row's register, in the custody page's own words: the intervals still out (`open`)
 * whose holder has left (`holderExited`), whose receipt waits for its signed copy
 * (`receipt=unsigned`), or that are past their «موعد الإعادة» (`overdue`, which is only ever
 * still out).
 */
export const custodyLink = (filters: DashboardFilters, row: AttentionRow): string => {
  const own: Record<AttentionRow, Record<string, string>> = {
    heldByLeavers: { open: 'true', holderExited: 'true' },
    receiptsAwaitingSignature: { open: 'true', receipt: 'unsigned' },
    overdueReturns: { overdue: 'true' },
  };
  return href('/it/custody', { ...own[row], ...scope(filters) });
};

/** «ضمان ينتهي خلال ٣٠ يومًا»: the asset list's own window, the setting's days. */
export const warrantyLink = (filters: DashboardFilters, days: number): string =>
  href('/it/assets', { warrantyEndsWithinDays: String(days), ...scope(filters) });

/**
 * «خطوط المحمول»: the lines carry no category, only the branch. Never the bare path: the lines page
 * restores the view its reader last left on a bare arrival, which would not be the lines the panel
 * counted — `status=` asks for every state, as the asset tile's link does.
 */
export const mobileLinesLink = (branchId: string): string =>
  branchId === '' ? '/it/mobile-lines?status=' : href('/it/mobile-lines', { branch: branchId });

/** «مستهلكات بلغت الحد الأدنى»: the store's own «ما بلغ الحد الأدنى فقط», in the same branch. */
export const consumablesLink = (branchId: string): string =>
  href('/it/consumables', { belowMin: 'true', branch: branchId });

/** A part's share of the whole, as a whole percent; nothing of nothing is 0, never NaN. */
export const share = (part: number, total: number): number =>
  total <= 0 ? 0 : Math.round((part * 100) / total);

/** The four states in the register's order, and the colour each wears on every panel. */
export const DASHBOARD_STATUSES: readonly ItAssetStatus[] = [
  'inStock',
  'assigned',
  'underMaintenance',
  'disposed',
];

/**
 * The colours of the approved sample: the accent (indigo) for what is handed over, emerald for what
 * is in the store, amber for maintenance, slate for the disposed. One map, so the KPI's icon, the
 * split's segment, its legend and the category bars cannot disagree.
 */
export const STATUS_FILL: Readonly<Record<ItAssetStatus, string>> = {
  inStock: 'bg-emerald-500 dark:bg-emerald-400',
  assigned: 'bg-brand-600 dark:bg-brand-400',
  underMaintenance: 'bg-amber-500 dark:bg-amber-400',
  disposed: 'bg-slate-400 dark:bg-slate-500',
};

/** Rows largest first — what the reader looks for — and by name where two are level. */
export const largestFirst = <T extends ItAssetStatusCountsDto>(
  rows: readonly T[],
  name: (row: T) => string,
): T[] => [...rows].sort((a, b) => b.total - a.total || name(a).localeCompare(name(b)));
