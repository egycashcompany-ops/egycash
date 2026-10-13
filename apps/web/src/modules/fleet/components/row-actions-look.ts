// «اعملى الالوان دى» — the owner's picture of a row's actions, for every Fleet table. He sent it
// twice; the second picture («مش عجبانى» of the first) is the one drawn here.
//
// A row's icons sit together in ONE box — a soft square (rounded-lg), a fill a shade lighter than
// the row and a faint border — each icon in its own colour, taken from the picture (the dark
// theme's hex is the picture's own; the light theme takes the nearest Tailwind shade):
//
//   view   (eye)        green   — emerald-600 / dark #68c098
//   edit   (pen)        blue    — blue-600 / dark #58a8e8; an upload is the same blue
//   print  (printer)    grey    — slate-500 / dark #a8b0b8
//   delete (bin)        red     — red-500 / dark #e86870
//
// and in that order: in a right-to-left row the eye is the first on the right and the bin the last
// on the left. Whatever else a screen offers on a row goes between the pen and the printer, in a
// calm colour of its own that is none of the four: a change of status or a check-out violet, a
// reopen or a transfer indigo, a log or a move slate. No yellow, orange or amber on an action.
// Pointing at an icon lays a faint wash of its own colour behind it.
//
// ONE EXCEPTION, the owner's own earlier word, kept until he says the picture replaces it: the
// accidents screen's log of a car turns yellow once that car has paid from or to another car at
// least once («لو السجل فى عمليه واحده على الاقل يخليه باللون الاصفر») — a fact about the car,
// not the colour of the action. fleet-row-actions-look.spec.tsx names it as the only yellow.
//
// The image cells follow the same picture: no image → a small dashed square with the cloud upload
// in blue; an image → the same box as the actions', with the eye, the replace arrow, the printer
// where the cell prints the image, and the bin.
//
// The boards' table (`DARK_TABLE`, and the notices' copy of it) sizes every button in a cell at
// 28px (22–24px on a laptop) and closes up a `gap-1`. Those rules are `.x td button` — one class
// and two elements. The sizes here are written `[&&]:` — the class twice — which outweighs them
// without touching the table every other board shares.
import { cn } from '../../../shared/lib/cn';

export type RowActionKind =
  | 'view'
  | 'edit'
  | 'upload'
  | 'print'
  | 'delete'
  | 'status'
  | 'reopen'
  | 'transfer'
  | 'history'
  | 'move';

/** The colour of each kind, and the faint wash of the same colour behind it on hover. */
const TONE: Record<RowActionKind, string> = {
  view: 'text-emerald-600 hover:bg-emerald-500/10 focus-visible:ring-emerald-500/40 dark:text-[#68c098]',
  edit: 'text-blue-600 hover:bg-blue-500/10 focus-visible:ring-blue-500/40 dark:text-[#58a8e8]',
  upload: 'text-blue-600 hover:bg-blue-500/10 focus-visible:ring-blue-500/40 dark:text-[#58a8e8]',
  print: 'text-slate-500 hover:bg-slate-500/10 focus-visible:ring-slate-500/40 dark:text-[#a8b0b8]',
  delete: 'text-red-500 hover:bg-red-500/10 focus-visible:ring-red-500/40 dark:text-[#e86870]',
  status:
    'text-violet-600 hover:bg-violet-500/10 focus-visible:ring-violet-500/40 dark:text-violet-400',
  reopen:
    'text-indigo-600 hover:bg-indigo-500/10 focus-visible:ring-indigo-500/40 dark:text-indigo-400',
  transfer:
    'text-indigo-600 hover:bg-indigo-500/10 focus-visible:ring-indigo-500/40 dark:text-indigo-400',
  history:
    'text-slate-600 hover:bg-slate-500/10 focus-visible:ring-slate-500/40 dark:text-slate-300',
  move: 'text-slate-600 hover:bg-slate-500/10 focus-visible:ring-slate-500/40 dark:text-slate-300',
};

/**
 * One icon's square: 24px around a 16px icon, so two icons stand 16px apart in the box's `gap-2`
 * and 12px from its sides — the picture's roomy spacing. `[&&]:` holds the size inside the boards'
 * table; see the head of this file.
 */
const ICON_SQUARE =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-30 [&&]:!h-6 [&&]:!w-6';

/** A row icon of the given kind: its square, its colour, its hover wash. */
export const actionTone = (kind: RowActionKind): string => cn(ICON_SQUARE, TONE[kind]);

/** Only the colour of a kind — for a control that keeps its own shape (a labelled button). */
export const actionColour = (kind: RowActionKind): string => TONE[kind];

/**
 * A pressed toggle among the actions — a fine collected, a notice closed: the same violet, filled.
 * `PARTLY_PRESSED` is a year where some of the fines are collected and some not.
 */
export const PRESSED =
  '!bg-violet-600 !text-white hover:!bg-violet-500 dark:!bg-violet-500 dark:!text-white';
export const PARTLY_PRESSED = 'bg-violet-500/15 ring-1 ring-inset ring-violet-500/50';

/**
 * The box a row's icons sit in: a soft square (rounded-lg), a fill a shade lighter than the row and
 * a faint border — 34px tall around the 24px squares, as in the picture.
 *
 * `empty:hidden`: a reader allowed none of a row's actions (a view-only reader on receipts, a car
 * in the workshop on the roster…) gets an EMPTY box, and an empty bordered box is a small blob in
 * the cell. Hidden when it holds nothing, the cell reads as blank — as it did before the box.
 */
export const ACTION_GROUP =
  'inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 align-middle empty:hidden dark:border-white/[0.08] dark:bg-white/[0.03]';

/** The box an image's icons sit in — the same box as the actions'. */
export const IMAGE_GROUP =
  'inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 align-middle dark:border-white/[0.08] dark:bg-white/[0.03]';

/** No image yet: the dashed square that holds the cloud upload, filled like the boxes. */
export const IMAGE_EMPTY_BOX =
  'inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-blue-600 transition-colors hover:bg-blue-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-50 dark:border-white/[0.14] dark:bg-white/[0.03] dark:text-[#58a8e8] [&&]:!h-8 [&&]:!w-8';
