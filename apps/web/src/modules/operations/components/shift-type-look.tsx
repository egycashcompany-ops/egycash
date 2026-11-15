// How a type of «أنواع التشغيل» looks — on «لوحة التشغيلة» (its row's box, its list, the strip of
// counts) and on the reference screen's tab that keeps the catalog.
//
// THE COLOUR IS A NAME FROM THE CONTRACT, THE LOOK IS THE SCREEN'S. A type carries one of a small
// fixed palette (`OPERATIONS_SHIFT_TYPE_COLOURS`) — never a hex value somebody typed — so a type
// added on the reference screen reads as a coloured tag on the board in light and in dark without
// anybody choosing a shade. Each name maps here to whole class names, written out, because Tailwind
// only emits the classes it can read in the source.
import {
  type Locale,
  type OperationsShiftTypeColour,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { cn } from '../../../shared/lib/cn';

/** A type's colours: its tag (tint, text, ring) and its dot. */
export const SHIFT_TYPE_TONE: Record<OperationsShiftTypeColour, { tag: string; dot: string }> = {
  rose: {
    tag: 'bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  orange: {
    tag: 'bg-orange-500/15 text-orange-700 ring-orange-500/30 dark:text-orange-300',
    dot: 'bg-orange-500',
  },
  amber: {
    tag: 'bg-amber-600/15 text-amber-800 ring-amber-600/30 dark:text-amber-300',
    dot: 'bg-amber-600',
  },
  lime: {
    tag: 'bg-lime-500/20 text-lime-800 ring-lime-600/30 dark:text-lime-300',
    dot: 'bg-lime-500',
  },
  emerald: {
    tag: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  teal: {
    tag: 'bg-teal-500/15 text-teal-700 ring-teal-500/30 dark:text-teal-300',
    dot: 'bg-teal-500',
  },
  sky: {
    tag: 'bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  indigo: {
    tag: 'bg-indigo-500/15 text-indigo-700 ring-indigo-500/30 dark:text-indigo-300',
    dot: 'bg-indigo-500',
  },
  violet: {
    tag: 'bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
  fuchsia: {
    tag: 'bg-fuchsia-500/15 text-fuchsia-700 ring-fuchsia-500/30 dark:text-fuchsia-300',
    dot: 'bg-fuchsia-500',
  },
  slate: {
    tag: 'bg-slate-700/15 text-slate-800 ring-slate-500/40 dark:bg-slate-400/15 dark:text-slate-200',
    dot: 'bg-slate-700 dark:bg-slate-300',
  },
};

/**
 * A type's name in the reader's language. The catalog's Arabic name is the type's name; the
 * English one is optional (the areas' rule), so an English reader reads the Arabic name where
 * none was given rather than a blank.
 */
export const shiftTypeName = (type: OperationsShiftTypeDto, locale: Locale): string =>
  locale === 'en' && type.nameEn !== null ? type.nameEn : type.name;

/**
 * The type's dot — the colour alone, beside a name written in the box's own text colour. Its size
 * is a prop, not a class a caller adds: `cn` is a plain joiner, so a second `h-*` would land beside
 * this one and Tailwind's emission order would pick.
 */
export const ShiftTypeDot = ({
  colour,
  size = 'md',
}: {
  colour: OperationsShiftTypeColour;
  size?: 'sm' | 'md';
}): JSX.Element => (
  <span
    aria-hidden
    data-type-dot={colour}
    className={cn(
      'shrink-0 rounded-full',
      size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5',
      SHIFT_TYPE_TONE[colour].dot,
    )}
  />
);

/**
 * A type as a tag — in a list (`sm`), and on the reference screen (`md`, a size up). The size is a
 * prop for the dot's reason: one font size ever reaches the element.
 */
export const ShiftTypeTag = ({
  type,
  locale,
  size = 'sm',
  className,
}: {
  type: OperationsShiftTypeDto;
  locale: Locale;
  size?: 'sm' | 'md';
  /** Layout only — how the tag sits where it is put (`max-w-full`), never its look. */
  className?: string;
}): JSX.Element => (
  <span
    className={cn(
      'inline-flex min-w-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 font-black ring-1 ring-inset',
      size === 'md' ? 'text-[13px]' : 'text-[11.5px]',
      SHIFT_TYPE_TONE[type.colour].tag,
      className,
    )}
  >
    <span
      aria-hidden
      className={cn('h-2 w-2 shrink-0 rounded-full', SHIFT_TYPE_TONE[type.colour].dot)}
    />
    <span className="min-w-0 truncate">{shiftTypeName(type, locale)}</span>
  </span>
);
