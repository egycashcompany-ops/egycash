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
// THE COLOURS (Round 34 D — «السهم اللي فوق رصاصي والسهم اللي تحت رصاصي واللي في النص بنفسجي …
// البنفسجي ده هو اللون الأشمل للويب سايت. أنا عايز تكون ألوان مختلفة»). Never grey, never the site's
// violet: the two one-way arrows share ONE hue, sky; the swap another, orange — both apart from the
// brand, from the cards' emerald «من 213» and rose «لم يُنقل», and from the amber «إجازة». At REST
// each arrow is plainly in its own colour (a tinted fill, a coloured border and glyph); under the
// pointer or the keyboard's focus it fills solid in it with a white glyph; PRESSED, it stays so
// while the data moves (`held`), its glyph nudging toward the receiving card (not under reduced
// motion), then rests again. The keyboard's focus also has a neutral outline outside the ring.
//
// NO WAY IS «SELECTED» (Round 34 D — «أنا يعتبر محدد اللي في النص»): the arrows are ACTIONS. A
// toolbar of three buttons — one in the Tab order, the arrow keys moving the focus among them in the
// reading direction (`modeStepOf`), Enter and Space pressing the one focused. An arrow that cannot
// act says why in its tooltip and its name (`aria-disabled`, still focusable, so the reason is read).
//
// AN ARROW THAT CANNOT ACT (Round 34 D critic) is what the window shows most — at opening nothing is
// ticked, and after a press the ticks it read are gone — so it keeps its colour whole: the same
// glyph as at rest (sky-700 5.9:1, orange-700 5.2:1 on white; dark sky-300 / orange-300), on no
// tint, a lighter border. It was softened to 60% — 2.6:1 and 2.5:1, faded. Round 34 H critic —
// under the pointer it stays exactly so: it does nothing, so it must not look pressable. Its soft
// tint there (sky-100 / orange-100, dark the 15% tint) was the very fill of an arrow that acts, at
// rest — the arrow lit up as if it could be pressed. The pointer reads «not allowed» and the
// tooltip says why.
import { cn } from '../../../shared/lib/cn';
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

/**
 * Each hue at rest, under the pointer or the focus (`active`), pressed (`held`), and unable to act
 * (`off`) — light and dark. Solid: white on sky-600 #0284c7 4.10:1, on orange-600 #ea580c 3.56:1 (a
 * glyph: 3:1 is the bar). At rest: sky-700 on sky-50 5.6:1, orange-700 on orange-50 4.9:1; dark,
 * sky-300 / orange-300 on their 15% tint over the window's navy, above 8:1. Off: the same glyphs on
 * the window itself (5.9:1, 5.2:1; dark above 9:1) — and nothing else, under the pointer too: no
 * `hover:` of its own (Round 34 H critic).
 */
export const SWAP_ARROW_LOOK: Record<
  SwapArrowTone,
  { rest: string; active: string; held: string; focus: string; off: string }
> = {
  oneWay: {
    off: 'border-sky-300 bg-white text-sky-700 dark:border-sky-400/40 dark:bg-transparent dark:text-sky-300',
    focus:
      'focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#121c3f]',
    rest: 'border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400/70 dark:bg-sky-400/15 dark:text-sky-300',
    active:
      'hover:border-sky-600 hover:bg-sky-600 hover:text-white focus-visible:border-sky-600 focus-visible:bg-sky-600 focus-visible:text-white dark:hover:border-sky-500 dark:hover:bg-sky-600 dark:hover:text-white dark:focus-visible:border-sky-500 dark:focus-visible:bg-sky-600 dark:focus-visible:text-white',
    held: 'border-sky-600 bg-sky-600 text-white ring-2 ring-sky-500/60 ring-offset-2 ring-offset-white shadow-[0_8px_20px_-8px_rgba(2,132,199,0.95)] dark:border-sky-500 dark:bg-sky-600 dark:text-white dark:ring-sky-400/60 dark:ring-offset-[#121c3f]',
  },
  swap: {
    off: 'border-orange-300 bg-white text-orange-700 dark:border-orange-400/40 dark:bg-transparent dark:text-orange-300',
    focus:
      'focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#121c3f]',
    rest: 'border-orange-500 bg-orange-50 text-orange-700 dark:border-orange-400/70 dark:bg-orange-400/15 dark:text-orange-300',
    active:
      'hover:border-orange-600 hover:bg-orange-600 hover:text-white focus-visible:border-orange-600 focus-visible:bg-orange-600 focus-visible:text-white dark:hover:border-orange-500 dark:hover:bg-orange-600 dark:hover:text-white dark:focus-visible:border-orange-500 dark:focus-visible:bg-orange-600 dark:focus-visible:text-white',
    held: 'border-orange-600 bg-orange-600 text-white ring-2 ring-orange-500/60 ring-offset-2 ring-offset-white shadow-[0_8px_20px_-8px_rgba(234,88,12,0.95)] dark:border-orange-500 dark:bg-orange-600 dark:text-white dark:ring-orange-400/60 dark:ring-offset-[#121c3f]',
  },
};

/**
 * The button's frame, either hue: ≥ 44px on touch; the keyboard's focus a neutral outline outside
 * the ring, the ring in the arrow's own hue (`focus` — never the base layer's brand ring: none of an
 * arrow is the site's violet).
 */
export const SWAP_ARROW_BUTTON =
  'flex h-12 w-16 shrink-0 items-center justify-center rounded-xl border transition-colors duration-150 lg:w-14 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-slate-900 dark:focus-visible:outline-white';

/**
 * An arrow that cannot act now, and is not the one playing: whole in its own colour (never grey —
 * «مش عايز … رصاصي» — and never faded), on no tint, its reason in its tooltip; under the pointer
 * unchanged (`SWAP_ARROW_LOOK[…].off` has no `hover:`) — never the tint or the solid fill of an
 * arrow that acts. The pointer itself says it: «not allowed».
 */
export const SWAP_ARROW_OFF = 'cursor-not-allowed';

/**
 * An arrow's classes: its hue at rest, filled under the pointer and the focus, filled while held;
 * unable to act, its colour whole on no tint.
 */
export const swapArrowClasses = (
  mode: SwapMode,
  state: { held: boolean; disabled: boolean },
): string => {
  const look = SWAP_ARROW_LOOK[swapArrowTone(mode)];
  if (state.held) return cn(SWAP_ARROW_BUTTON, look.focus, look.held);
  if (state.disabled) return cn(SWAP_ARROW_BUTTON, look.focus, look.off, SWAP_ARROW_OFF);
  return cn(SWAP_ARROW_BUTTON, look.focus, look.rest, look.active);
};

/**
 * Drawn pointing right, each arrow its own group so a held glyph can nudge it toward where it
 * points: one arrow, or the swap's two (top → , bottom ←).
 */
const GLYPH: Record<SwapArrowTone, readonly (readonly string[])[]> = {
  oneWay: [['M4 12h15', 'M13 6l6 6-6 6']],
  swap: [
    ['M4 8h15', 'M15 4l4 4-4 4'],
    ['M20 16H5', 'M9 12l-4 4 4 4'],
  ],
};
/** Each group's nudge while held — along its own arrow in the drawing, so the turn carries it. */
const NUDGE = ['motion-safe:animate-swap-nudge', 'motion-safe:animate-swap-nudge-back'] as const;

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

/** A way's arrow (or the swap's two), turned for the layout and the language; nudging while held. */
export const SwapArrowGlyph = ({
  mode,
  rtl,
  moving = false,
}: {
  mode: SwapMode;
  rtl: boolean;
  moving?: boolean;
}): JSX.Element => {
  const aim = swapArrowAim(mode, rtl);
  return (
    <span
      aria-hidden
      data-swap-arrow={swapArrowTone(mode)}
      data-swap-points={aim.wide.join(' ')}
      data-swap-points-stacked={aim.stacked.join(' ')}
      className={cn('flex h-7 w-7 items-center justify-center', swapArrowTurn(mode, rtl))}
    >
      <svg
        className="h-7 w-7 overflow-visible"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {GLYPH[swapArrowTone(mode)].map((part, at) => (
          <g
            key={part.join(' ')}
            data-swap-nudge={moving ? String(at) : undefined}
            className={moving ? NUDGE[at] : undefined}
          >
            {part.map((d) => (
              <path key={d} d={d} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} />
            ))}
          </g>
        ))}
      </svg>
    </span>
  );
};

/**
 * The three arrows between the two cards — a toolbar of ACTIONS. No hooks of its own: the window
 * hands it each arrow's name, why it cannot act (or null), the one held, the one in the Tab order,
 * and what a press does — so what a key or a click does is the element's own handler, which a suite
 * can call.
 */
export const SwapArrows = ({
  rtl,
  label,
  nameOf,
  whyOf,
  held,
  focusWay,
  onFocusWay,
  onPress,
  buttonRef,
}: {
  rtl: boolean;
  /** The toolbar's name. */
  label: string;
  /** Each arrow's name and tooltip — what it does, with both vans. */
  nameOf: (mode: SwapMode) => string;
  /** Why the arrow cannot act now, in words — or null when it can. */
  whyOf: (mode: SwapMode) => string | null;
  /** The arrow just pressed, filled while the data moves — or null, all at rest. */
  held: SwapMode | null;
  /** The arrow in the Tab order (the toolbar's roving stop). */
  focusWay: SwapMode;
  /** The focus moved to an arrow — by the arrow keys (the window then focuses it), or by Tab. */
  onFocusWay: (mode: SwapMode, by: 'key' | 'focus') => void;
  /** An arrow pressed (a click, Enter or Space) — only ever one that can act. */
  onPress: (mode: SwapMode) => void;
  buttonRef?: (mode: SwapMode, node: HTMLButtonElement | null) => void;
}): JSX.Element => (
  <div
    role="toolbar"
    aria-label={label}
    data-swap-modes="true"
    onKeyDown={(event) => {
      const by = modeStepOf(event.key, rtl);
      if (by === 0) return;
      event.preventDefault();
      const at = SWAP_MODES.indexOf(focusWay);
      onFocusWay(SWAP_MODES[(at + by + SWAP_MODES.length) % SWAP_MODES.length] as SwapMode, 'key');
    }}
    className="flex flex-row items-center justify-center gap-3.5 lg:flex-col"
  >
    {/* Round 34 A — each way an ARROW from the sending card to the receiving one (side by side:
        left or right by the language; stacked: down or up), the two one-way arrows in one hue
        and the swap's two, one under the other, in another. No word on the button: its name and
        its tooltip say what it does, with both vans' names — and, when it cannot act, why. */}
    {SWAP_MODES.map((one) => {
      const why = whyOf(one);
      const isHeld = held === one;
      const name = why === null ? nameOf(one) : `${nameOf(one)} — ${why}`;
      return (
        <button
          key={one}
          ref={buttonRef === undefined ? undefined : (node) => buttonRef(one, node)}
          type="button"
          aria-label={name}
          aria-disabled={why === null ? undefined : true}
          tabIndex={focusWay === one ? 0 : -1}
          data-swap-mode={one}
          data-swap-held={isHeld ? 'true' : undefined}
          title={name}
          onFocus={() => onFocusWay(one, 'focus')}
          onClick={() => {
            if (why === null) onPress(one);
          }}
          className={swapArrowClasses(one, { held: isHeld, disabled: why !== null })}
        >
          <SwapArrowGlyph mode={one} rtl={rtl} moving={isHeld} />
        </button>
      );
    })}
  </div>
);
