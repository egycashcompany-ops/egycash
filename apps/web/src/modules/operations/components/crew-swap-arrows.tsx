// Round 34 A — the three ways of «تبديل بين سيارتين» drawn as ARROWS. The owner: «السواب عايز يكون
// أسهم اللي أنا ببدل ما بينهم وبين عربيتين، اللي هو السهم الشمال أو السهم اليمين أو السهمين اللي تحت
// بعض، يكون السهمين اليمين والشمال نفس اللون والسهم اللي في النص لون مختلف».
//
// WHERE AN ARROW POINTS. Always from the card that sends to the card that receives, in every layout:
//   · side by side (lg and wider) the first card (A, the row the window was opened from) sits on the
//     start side — the RIGHT in Arabic, the left in English — so «A to B» points LEFT in Arabic and
//     RIGHT in English, «B to A» the other way; the three ways stand in a column, and the swap is the
//     two of them one under the other (⇄), its top arrow pointing as «A to B» above it does, its
//     bottom one as «B to A» below it;
//   · stacked (narrower than lg) A is on top and B under it, so «A to B» points DOWN, «B to A» UP;
//     the three ways stand in a row (right to left in Arabic, so «A to B» is on the right), and the
//     swap's two arrows stand side by side (⇅), each pointing as the one-way arrow beside it does —
//     ↑ ⇅ ↓ in Arabic, ↓ ⇅ ↑ in English (Round 34 critic: in English the swap was not mirrored
//     there, and read ↓ ↑↓ ↑, each of its arrows against its neighbour).
// Each glyph is drawn once, pointing right (the swap: its top arrow right, its bottom one left), and
// turned by CSS per layout — a rotation, and for the swap a mirror. `swapArrowAim` says in words
// where each arrow then points, in the order the eye meets them on screen; the spec turns the
// drawing by the classes' own matrix and holds the two to each other.
//
// THE COLOURS. The two one-way arrows share ONE hue, sky; the swap, the default way, the brand's
// indigo — two hues apart from each other and from the preview's emerald «من 213» and rose «يبقى».
// Off: a tinted outline and a soft fill in the way's hue; on: the hue solid, the glyph white, a ring
// in the hue around it and its shadow. The keyboard's focus is a neutral outline outside that ring.
import { cn } from '../../../shared/lib/cn';
import { StrokeIcon } from '../../../shared/ui/StrokeIcon';
import { SWAP_MODES, modeStepOf, type SwapMode } from '../lib/crew-swap';

/** A physical direction on the screen. */
export type ArrowWay = 'left' | 'right' | 'up' | 'down';

/** Where a way's arrows point — the swap's two in the order the eye meets them on screen. */
export interface SwapArrowAim {
  /** The cards side by side (lg and wider): A on the start side; the swap's two top, then bottom. */
  wide: readonly ArrowWay[];
  /** The cards stacked (narrower than lg): A above B; the swap's two left, then right. */
  stacked: readonly ArrowWay[];
}

export const swapArrowAim = (mode: SwapMode, rtl: boolean): SwapArrowAim => {
  const toB: ArrowWay = rtl ? 'left' : 'right';
  const toA: ArrowWay = rtl ? 'right' : 'left';
  if (mode === 'aToB') return { wide: [toB], stacked: ['down'] };
  if (mode === 'bToA') return { wide: [toA], stacked: ['up'] };
  // Stacked, the row runs in the reading direction: «B to A» (up) is on the LEFT in Arabic, «A to
  // B» (down) on the left in English — and the swap's left-hand arrow points as its left neighbour.
  return { wide: [toB, toA], stacked: rtl ? ['up', 'down'] : ['down', 'up'] };
};

/** The two hues: the one-way arrows' and the swap's. */
export type SwapArrowTone = 'oneWay' | 'swap';
export const swapArrowTone = (mode: SwapMode): SwapArrowTone =>
  mode === 'swap' ? 'swap' : 'oneWay';

/** Each hue off and on, dark and light (white on sky-600 4.1:1, on brand-600 6.3:1). */
export const SWAP_ARROW_LOOK: Record<SwapArrowTone, { off: string; on: string }> = {
  oneWay: {
    off: 'border-sky-300 bg-sky-50 text-sky-700 hover:border-sky-500 hover:bg-sky-100 dark:border-sky-400/45 dark:bg-sky-400/10 dark:text-sky-300 dark:hover:border-sky-300 dark:hover:bg-sky-400/20',
    on: 'border-sky-600 bg-sky-600 text-white ring-2 ring-sky-500/70 ring-offset-2 ring-offset-white shadow-[0_8px_20px_-8px_rgba(2,132,199,0.95)] dark:border-sky-500 dark:ring-sky-400/70 dark:ring-offset-[#121c3f]',
  },
  swap: {
    off: 'border-brand-300 bg-brand-50 text-brand-700 hover:border-brand-500 hover:bg-brand-100 dark:border-brand-400/45 dark:bg-brand-400/10 dark:text-brand-200 dark:hover:border-brand-300 dark:hover:bg-brand-400/20',
    on: 'border-brand-600 bg-brand-600 text-white ring-2 ring-brand-500/70 ring-offset-2 ring-offset-white shadow-[0_8px_20px_-8px_rgba(79,70,229,0.95)] dark:border-brand-500 dark:bg-brand-500 dark:ring-brand-400/70 dark:ring-offset-[#121c3f]',
  },
};

/** The button's frame, either hue: ≥ 44px on touch, the focus outside the selected ring. */
export const SWAP_ARROW_BUTTON =
  'flex h-12 w-16 shrink-0 items-center justify-center rounded-xl border transition-colors lg:w-14 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-slate-900 dark:focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none';

/** Drawn pointing right: one arrow, or the swap's two (top → , bottom ←). */
const GLYPH: Record<SwapArrowTone, readonly string[]> = {
  oneWay: ['M4 12h15', 'M13 6l6 6-6 6'],
  swap: ['M4 8h15', 'M15 4l4 4-4 4', 'M20 16H5', 'M9 12l-4 4 4 4'],
};

/**
 * The turn that makes the drawing point where `swapArrowAim` says, per layout. (Tailwind composes
 * `rotate(…) scaleX(…)`: the mirror is applied to the drawing first, then the turn.)
 */
export const swapArrowTurn = (mode: SwapMode, rtl: boolean): string => {
  if (mode === 'swap') {
    // Stacked: a quarter turn clockwise stands the swap's two side by side — its top arrow (→)
    // becomes the right-hand one, pointing down. Arabic wants that (↑ ⇅ ↓); English wants it the
    // other way round (↓ ⇅ ↑), so the drawing is mirrored first. Side by side: unturned, ⇄, and
    // mirrored in Arabic so its top arrow points left like «A to B» above it.
    return rtl
      ? 'rotate-90 lg:rotate-0 lg:-scale-x-100'
      : '-scale-x-100 rotate-90 lg:rotate-0 lg:scale-x-100';
  }
  // Stacked: a quarter turn clockwise points the drawing's → down, counter-clockwise up.
  const stacked = mode === 'bToA' ? '-rotate-90' : 'rotate-90';
  // Side by side: → stays for a way that goes right, a half turn for one that goes left.
  const wide = swapArrowAim(mode, rtl).wide[0] === 'right' ? 'lg:rotate-0' : 'lg:rotate-180';
  return cn(stacked, wide);
};

/** A way's arrow (or the swap's two), turned for the layout and the language. */
export const SwapArrowGlyph = ({ mode, rtl }: { mode: SwapMode; rtl: boolean }): JSX.Element => {
  const aim = swapArrowAim(mode, rtl);
  return (
    <span
      aria-hidden
      data-swap-arrow={swapArrowTone(mode)}
      data-swap-points={aim.wide.join(' ')}
      data-swap-points-stacked={aim.stacked.join(' ')}
      className={cn('flex h-7 w-7 items-center justify-center', swapArrowTurn(mode, rtl))}
    >
      <StrokeIcon d={GLYPH[swapArrowTone(mode)]} className="h-7 w-7" width={2.4} />
    </span>
  );
};

/**
 * The three ways as a radio group between the two cards — the arrows, one in the Tab order, the
 * arrow keys stepping in the reading direction (`modeStepOf`: in Arabic «←» is the next way, the
 * row running right to left; «↓» in the column). No hooks of its own: the window hands it the way
 * on, the names and what to do on a pick — so what a key does is the element's own handler, which
 * a suite can call.
 */
export const SwapWays = ({
  mode,
  rtl,
  groupLabel,
  nameOf,
  disabled,
  onPick,
  buttonRef,
}: {
  mode: SwapMode;
  rtl: boolean;
  groupLabel: string;
  /** Each way's name and tooltip — what it does, with both vans. */
  nameOf: (mode: SwapMode) => string;
  /** No second van yet: none to press. */
  disabled: boolean;
  /** A way picked — by a click, or by an arrow key (the window then moves the focus to it). */
  onPick: (mode: SwapMode, by: 'click' | 'key') => void;
  buttonRef?: (mode: SwapMode, node: HTMLButtonElement | null) => void;
}): JSX.Element => (
  <div
    role="radiogroup"
    aria-label={groupLabel}
    data-swap-modes="true"
    onKeyDown={(event) => {
      const by = modeStepOf(event.key, rtl);
      if (by === 0) return;
      event.preventDefault();
      const at = SWAP_MODES.indexOf(mode);
      onPick(SWAP_MODES[(at + by + SWAP_MODES.length) % SWAP_MODES.length] as SwapMode, 'key');
    }}
    className="flex flex-row items-center justify-center gap-3.5 lg:flex-col"
  >
    {/* Round 34 A — each way an ARROW from the sending card to the receiving one (side by side:
        left or right by the language; stacked: down or up), the two one-way arrows in one hue
        and the swap's two, one under the other, in another. No word on the button: its name and
        its tooltip say what it does, with both vans' names. */}
    {SWAP_MODES.map((one) => {
      const on = mode === one;
      const label = nameOf(one);
      return (
        <button
          key={one}
          ref={buttonRef === undefined ? undefined : (node) => buttonRef(one, node)}
          type="button"
          role="radio"
          aria-checked={on}
          aria-label={label}
          tabIndex={on ? 0 : -1}
          data-swap-mode={one}
          disabled={disabled}
          title={label}
          onClick={() => onPick(one, 'click')}
          className={cn(SWAP_ARROW_BUTTON, SWAP_ARROW_LOOK[swapArrowTone(one)][on ? 'on' : 'off'])}
        >
          <SwapArrowGlyph mode={one} rtl={rtl} />
        </button>
      );
    })}
  </div>
);
