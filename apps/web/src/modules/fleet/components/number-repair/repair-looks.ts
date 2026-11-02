// «تصحيح أرقام الكروت» (6d) — the screen's shared classes, the approved sample's (`zz-6d-page`):
// the page column, the quiet buttons, the phone-only labels, the column heads and the two row grids.
import { cn } from '../../../../shared/lib/cn';
import { BOARD_FONT } from '../FuelCardBoard';

export const PAGE = cn(BOARD_FONT, 'space-y-5 text-slate-900 antialiased dark:text-slate-100');
export const BUTTON =
  'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-bold transition';
export const QUIET =
  'border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700';
/** A cell's name, shown on a phone only (the column heads say it on a wide screen). */
export const PHONE_LABEL = 'text-[11px] font-semibold text-slate-500 lg:hidden dark:text-slate-400';
export const COL_HEAD =
  'hidden border-b border-slate-200 bg-slate-50 px-4 py-2 text-[12px] font-semibold text-slate-500 lg:grid dark:border-[#1c293f] dark:bg-[#0c1322] dark:text-slate-400';
/** The 15's columns: car · name and balance · number · expiry · photo · the live check. */
export const CYCLE_GRID =
  'lg:grid lg:grid-cols-[6.5rem_minmax(0,1fr)_17rem_9.5rem_14rem_8.5rem] lg:items-center lg:gap-x-3';
/** The pair's: car · number (stays) · photo (stays) · name · balance · the live check. */
export const PAIR_GRID =
  'lg:grid lg:grid-cols-[6.5rem_12.5rem_7.5rem_minmax(0,1fr)_17rem_8.5rem] lg:items-center lg:gap-x-3';
/** The white panel of the header and the rule box. */
export const PANEL =
  'rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-[#111827]';
