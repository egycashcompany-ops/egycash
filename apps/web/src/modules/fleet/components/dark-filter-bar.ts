import { cn } from '../../../shared/lib/cn';

/**
 * The dark filter bar of the Fleet boards (السيارات · بطاقات الوقود · شحن الكروت), laid over
 * `FilterBar`: the board's surface, dark boxes, the open lists on the board's surface. What the
 * reader presses or picks is the site's purple; green, amber and red are kept for a state.
 */
export const DARK_FILTER_BAR = cn(
  '[&>div]:!rounded-xl [&>div]:!border-slate-200 dark:[&>div]:!border-slate-800 [&>div]:!bg-white dark:[&>div]:!bg-[#111827] [&>div]:!p-4',
  '[&_input]:!border-slate-300 dark:[&_input]:!border-slate-700/80 [&_input]:!bg-slate-50 dark:[&_input]:!bg-[#080C14] [&_input]:!text-slate-900 dark:[&_input]:!text-slate-100 [&_input]:placeholder:!text-slate-500 dark:[&_input]:placeholder:!text-slate-400',
  '[&_button[aria-haspopup]]:!border-slate-300 dark:[&_button[aria-haspopup]]:!border-slate-700/80 [&_button[aria-haspopup]]:!bg-slate-50 dark:[&_button[aria-haspopup]]:!bg-[#080C14] [&_button[aria-haspopup]]:!text-slate-800 dark:[&_button[aria-haspopup]]:!text-slate-200',
  '[&_[role=listbox]]:!border-slate-300 dark:[&_[role=listbox]]:!border-slate-700 [&_[role=listbox]]:!bg-white dark:[&_[role=listbox]]:!bg-[#111827] [&_[role=listbox]]:!shadow-2xl [&_[role=listbox]]:!shadow-slate-900/10 dark:[&_[role=listbox]]:!shadow-black/60',
  '[&_[role=option]:hover]:!bg-brand-500/15 [&_[role=option][aria-selected=true]]:!font-bold [&_[role=option][aria-selected=true]]:!text-brand-700 dark:[&_[role=option][aria-selected=true]]:!text-brand-200',
  // Larger than a tablet: ONE row. Every filter shares the width evenly instead of holding its
  // own; the reset button keeps its size.
  'lg:[&>div]:!flex-nowrap lg:[&>div]:!gap-1.5 lg:[&>div>*]:!min-w-0 lg:[&>div>*]:!flex-1 lg:[&>div>.ms-auto]:!flex-none',
  // A small computer screen (1024–1279) takes the words a size down so they still read whole.
  'lg:max-xl:[&_input]:!px-1.5 lg:max-xl:[&_input]:!text-xs lg:max-xl:[&_button[aria-haspopup]]:!px-1.5 lg:max-xl:[&_button[aria-haspopup]]:!text-xs lg:max-xl:[&_button[aria-haspopup]_svg]:!h-3 lg:max-xl:[&_button[aria-haspopup]_svg]:!w-3',
);

/**
 * One answer out of a `MultiSelect`: the option just ticked replaces the one before, so a list of
 * two companies or of ready date windows reads as a single choice in the same control.
 */
export const pickOne = (previous: readonly string[], next: readonly string[]): string | null =>
  next.find((value) => !previous.includes(value)) ?? next[next.length - 1] ?? null;
