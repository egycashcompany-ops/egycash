// The pieces of the two odometer forms (record a reading, correct one) that the design shell does
// not carry: the note's box, a driver seat's box and the swap between the two seats. One
// definition, so the reading form and the correction cannot drift apart.
//
// Everything here is forced over a control's own classes with `!`: `cn` joins classes rather than
// merging them, so a plain class would only compete with the control's base.
import { cn } from '../../../shared/lib/cn';

/** A `Textarea` in the design's box — it takes no `tone`, so the box is laid over its base. */
export const ODOMETER_NOTE_BOX = cn(
  '!rounded-xl !px-4 !py-3 !text-[15px] !font-medium shadow-inner transition-all',
  '!border-slate-200 !bg-slate-50 !text-slate-900 dark:!border-[#2b3b6b] dark:!bg-[#0a1233] dark:!text-white',
  'placeholder:!text-slate-500 dark:placeholder:!text-slate-400',
  'focus:!border-indigo-500 focus:!outline-none focus:!ring-1 focus:!ring-indigo-500',
);

/**
 * A driver seat (`OptionalDriverField`) in the design: the picker's trigger and the chosen name
 * drawn as the form's boxes, the open list on the form's surface as wide as its box, and the
 * picked option in the site's purple.
 */
export const ODOMETER_DRIVER_BOX = cn(
  // The picker's trigger, while the seat is empty.
  '[&_button[aria-haspopup]]:!rounded-xl [&_button[aria-haspopup]]:!px-4 [&_button[aria-haspopup]]:!py-3 [&_button[aria-haspopup]]:!text-[15px] [&_button[aria-haspopup]]:!font-medium [&_button[aria-haspopup]]:shadow-inner',
  '[&_button[aria-haspopup]]:!border-slate-200 dark:[&_button[aria-haspopup]]:!border-[#2b3b6b] [&_button[aria-haspopup]]:!bg-slate-50 dark:[&_button[aria-haspopup]]:!bg-[#0a1233] [&_button[aria-haspopup]]:!text-slate-900 dark:[&_button[aria-haspopup]]:!text-white',
  '[&_button[aria-haspopup]:focus]:!border-indigo-500 [&_button[aria-haspopup]:focus]:ring-1 [&_button[aria-haspopup]:focus]:ring-indigo-500',
  // The chosen driver, with its ✕.
  '[&>.justify-between]:!rounded-xl [&>.justify-between]:!border-slate-200 dark:[&>.justify-between]:!border-[#2b3b6b] [&>.justify-between]:!bg-slate-50 dark:[&>.justify-between]:!bg-[#0a1233] [&>.justify-between]:!px-4 [&>.justify-between]:!py-2.5 [&>.justify-between]:shadow-inner',
  '[&>.justify-between_span]:!text-[15px] [&>.justify-between_span]:!font-bold',
  // The open list.
  '[&_[role=listbox]]:!w-full [&_[role=listbox]]:!rounded-xl [&_[role=listbox]]:!border-slate-200 dark:[&_[role=listbox]]:!border-[#2b3b6b] [&_[role=listbox]]:!bg-white dark:[&_[role=listbox]]:!bg-[#131d35] [&_[role=listbox]]:!shadow-2xl',
  '[&_[role=option]:hover]:!bg-brand-500/15 [&_[role=option][aria-selected=true]]:!font-bold [&_[role=option][aria-selected=true]]:!text-brand-700 dark:[&_[role=option][aria-selected=true]]:!text-brand-200',
);

/** «تبديل السائقين»: the morning seat's driver to the evening seat and back — the design's plain button. */
export const ODOMETER_SWAP_BUTTON = cn(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 py-2.5 text-[13px] font-bold transition-all active:scale-95',
  'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-[#2b3b6b] dark:bg-[#1a2550] dark:text-slate-100 dark:hover:bg-slate-700/80',
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
);
