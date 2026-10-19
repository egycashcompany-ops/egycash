// The custody screen's own looks, shared by its three tabs — «العهدة» (`CustodyPage`), «المذكرات»
// and «سجل العهدة» — so each tab is drawn from the same surfaces: the filter bar on the dashboard's
// card, a table's card with its strip and foot, the table in the receipts board's look, the export
// pair's frame. `CustodyPage` imports these back, spelled as before; `PRESS_BUTTON` (the toolbar's
// purple) stays in it, the one class its purple guard strips.
import { cn } from '../../../shared/lib/cn';
import { TABLE_CARD } from './custody-dashboard-parts';
import { DARK_TABLE } from '../pages/VehiclesListPage';
import { ALARMS_TYPE } from '../pages/MaintenanceAlarmsPage';

/**
 * The filter bar on the dashboard's card (`CARD`, rounded-2xl) with the design's boxes — white on
 * slate-300 light, #0a0e17 on #223048 dark, rounded-xl — the open list on the card's surface and
 * what is picked emerald. Laid OVER `DARK_FILTER_BAR` (its one-row
 * layout stays), each selector doubled (`&&`) so it outranks the bar's own.
 */
export const CUSTODY_FILTER_LOOK = cn(
  '[&&>div]:!rounded-2xl [&&>div]:!p-4',
  '[&&>div]:!border-[#e2e8f0] dark:[&&>div]:!border-[rgba(42,58,84,.65)] [&&>div]:!bg-white dark:[&&>div]:!bg-transparent dark:[&&>div]:!bg-[linear-gradient(180deg,rgba(19,26,43,.82)_0%,rgba(13,18,30,.92)_100%)]',
  '[&&>div]:!shadow-[0_1px_3px_0_rgba(0,0,0,.05),0_1px_2px_-1px_rgba(0,0,0,.05)] dark:[&&>div]:!shadow-[0_8px_24px_-4px_rgba(0,0,0,.5),inset_0_1px_0_0_rgba(255,255,255,.04)]',
  '[&&_input]:!rounded-xl [&&_input]:!border-slate-300 [&&_input]:!bg-white dark:[&&_input]:!border-[#223048] dark:[&&_input]:!bg-[#0a0e17] dark:[&&_input]:!text-white',
  '[&&_input:focus]:!border-emerald-500 [&&_input:focus]:!ring-2 [&&_input:focus]:!ring-emerald-500/20 dark:[&&_input:focus]:!border-emerald-500/60',
  '[&&_button[aria-haspopup]]:!rounded-xl [&&_button[aria-haspopup]]:!border-slate-300 [&&_button[aria-haspopup]]:!bg-white dark:[&&_button[aria-haspopup]]:!border-[#223048] dark:[&&_button[aria-haspopup]]:!bg-[#0a0e17] dark:[&&_button[aria-haspopup]]:!text-white',
  '[&&_button[aria-haspopup]:focus-visible]:!border-emerald-500 [&&_button[aria-haspopup][aria-expanded=true]]:!border-emerald-500 dark:[&&_button[aria-haspopup][aria-expanded=true]]:!border-emerald-500/60',
  '[&&_[role=listbox]]:!rounded-xl [&&_[role=listbox]]:!border-[#e2e8f0] dark:[&&_[role=listbox]]:!border-[#223048] dark:[&&_[role=listbox]]:!bg-[#111726]',
  '[&&_[role=option]:hover]:!bg-emerald-500/10 [&&_[role=option][aria-selected=true]]:!text-emerald-700 dark:[&&_[role=option][aria-selected=true]]:!text-emerald-300',
);

/**
 * A table's card: the dashboard's table card (`TABLE_CARD` — rounded-2xl, the deeper shadow dark),
 * its rows clipped to the round corners. The board's table inside loses its own frame
 * (`EMBEDDED_TABLE`) and takes the design's body — white light, #0d1424 dark — and head — slate-100
 * light, #0c1322 over its #233552 rule dark.
 */
export const SECTION_CARD = cn(TABLE_CARD, 'overflow-hidden');
/** The strip over a table — the dashboard's `STRIP`, a little lower so the rows keep the room. */
export const SECTION_STRIP =
  'flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-[#1c293f] dark:bg-[#0a101b]';
/** The count beside «ملخص لكل سيارة» — the design's emerald chip. */
export const CARS_CHIP =
  'shrink-0 whitespace-nowrap rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:font-medium dark:text-emerald-400';
/** The count beside «كل الحركات» — the design's slate chip. */
export const MOVES_CHIP =
  'shrink-0 whitespace-nowrap rounded border border-slate-200 bg-slate-200/80 px-2 py-0.5 text-xs font-bold text-slate-700 dark:border-slate-700/60 dark:bg-[#142135] dark:font-medium dark:text-slate-300';
export const EMBEDDED_TABLE = cn(
  '[&&>div]:!rounded-none [&&>div]:!border-0 [&&>div]:!bg-white dark:[&&>div]:!bg-[#0d1424]/85',
  'dark:[&&_thead_tr]:!bg-[#0c1322] [&&_thead_th]:shadow-[inset_0_-1px_0_#cbd5e1] dark:[&&_thead_th]:shadow-[inset_0_-1px_0_#233552]',
  'dark:[&&_tbody_tr]:!border-slate-800/80 dark:[&&_tbody_tr:hover]:!bg-slate-800/40',
  // The design's thin scrollbars (`SCROLLBAR`) on the table's own scroller, dark only.
  'dark:[&>div::-webkit-scrollbar]:h-1.5 dark:[&>div::-webkit-scrollbar]:w-1.5 dark:[&>div::-webkit-scrollbar-track]:bg-[#090d16] dark:[&>div::-webkit-scrollbar-thumb]:rounded dark:[&>div::-webkit-scrollbar-thumb]:bg-[#1e293b] dark:[&>div::-webkit-scrollbar-thumb:hover]:bg-[#334155]',
);
/** The pager in the card's foot — the design's strip under the log. */
export const SECTION_FOOT =
  'shrink-0 border-t border-slate-200 bg-slate-50/80 px-4 dark:border-slate-800 dark:bg-[#0a101b]';

/**
 * Both tables: the receipts board's (the vehicles table with no line between the columns, every
 * value heavy in Cairo's own bold) in the alarms board's TYPE — see `ALARMS_TYPE`. The row-filling
 * part (`BOARD_TABLE_FILL`) goes on the movements only: the per-car table keeps its own bound.
 */
export const CUSTODY_TABLE = cn(
  DARK_TABLE,
  '[&_td+td]:!border-s-0 [&_th+th]:!border-s-0',
  "[&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif] [&_td_*]:!font-bold",
  ALARMS_TYPE,
);
/**
 * The same table on «المذكرات» and «سجل العهدة»: the head in the dashboard's darker ink (slate-700
 * light, slate-300 dark), and the last column (the row's actions) clear of the card's edge.
 */
export const CUSTODY_TAB_TABLE = cn(
  CUSTODY_TABLE,
  '[&_thead_tr_th]:!text-slate-700 dark:[&_thead_tr_th]:!text-slate-300',
  '[&_td:last-child]:!pl-3 [&_th:last-child]:!pl-3',
);

/**
 * «الإجمالي» as the dashboard's foot: slate-100 light, #090e18 dark; the design's 2px emerald-500
 * rule over every cell (an inset shadow — the table's own row borders are `!important`); and the
 * fund's total in its emerald box — the light map's emerald-50 with emerald-200 sides, the design's
 * #122238 with its faint line under the rule. Black type on the light map, as the foot's.
 */
export const GRAND_ROW = cn(
  'bg-slate-100 dark:bg-[#090e18]',
  '[&>td]:shadow-[inset_0_2px_0_#10b981]',
  '[&>td:last-child]:bg-emerald-50 dark:[&>td:last-child]:bg-[#122238]',
  '[&>td:last-child]:shadow-[inset_0_2px_0_#10b981,inset_1px_0_0_#a7f3d0,inset_-1px_0_0_#a7f3d0] dark:[&>td:last-child]:shadow-[inset_0_2px_0_#10b981,inset_0_3px_0_rgba(16,185,129,0.3)]',
  '[&>td_span]:!font-black dark:[&>td_span]:!font-bold',
);

/**
 * A button inside a framed group (the Excel / PDF pair, the fund's three actions) — slate ink, a
 * size down on a phone; each button adds its own hover tone.
 */
export const PILL_BUTTON =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 transition active:scale-95 disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs dark:text-slate-200';
/** The frame such a group sits in — the board's export pair's. */
export const PILL_FRAME =
  'inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/80';
/** A link or button in the site's purple, as licence expenses' «إعداد النماذج». */
export const BRAND_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:text-brand-200';
/** «+ مذكرة جديدة» — licence expenses' add button, the brand gradient. */
export const ADD_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-2 py-1.5 text-[11px] font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 sm:gap-1.5 sm:px-3.5 sm:py-2 sm:text-xs active:scale-95';
