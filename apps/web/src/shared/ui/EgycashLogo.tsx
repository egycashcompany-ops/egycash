// The EGYCASH logo with its name — the mark and the lettering — laid out as the company's horizontal
// logo lays them out: the same proportions and the same gap, measured off the supplied artwork, the
// lettering centred on the mark. Use it where the company's NAME belongs (the customer and applicant
// portals and the public pages, which speak for EGYCASH rather than for the ECMS product); where only
// the mark belongs, use `BrandMark`.
//
// Unlike `BrandMark` this one carries the name, so it is announced to assistive technology as an
// image labelled «EGYCASH» rather than hidden.
//
// `tone="auto"` follows the theme: the artwork's purples and navy on light surfaces, lifted tones
// and white lettering in dark mode. `tone="white"` is the reversed logo for a dark or brand panel
// that stays dark in both themes.
//
// In a flex column the SVG's box is stretched to the column's width and the artwork drawn in its
// middle; a caller that wants the logo at the start edge says so (`self-start`).
import { cn } from '../lib/cn';
import { MARK_BAND_PATH, MARK_HEIGHT, MARK_RIBBON_PATH } from './brand-mark-paths';
import { WORDMARK_HEIGHT, WORDMARK_PATH } from './egycash-wordmark-paths';

type Tone = 'auto' | 'white';

const COLOUR: Record<Tone, { ribbon: string; band: string; text: string }> = {
  auto: {
    ribbon: 'fill-[#3e4097] dark:fill-[#8c90e0]',
    band: 'fill-[#5d60a9] dark:fill-[#b5b8ec]',
    text: 'fill-[#222566] dark:fill-slate-50',
  },
  white: {
    ribbon: 'fill-white/[0.72]',
    band: 'fill-white',
    text: 'fill-white',
  },
};

// Geometry of the supplied horizontal logo, on a 2000-unit-wide canvas as tall as the mark.
const CANVAS_W = 2000;
const CANVAS_H = 669;
const MARK_SCALE = CANVAS_H / MARK_HEIGHT;
const TEXT_SCALE = 0.8508;
const WORD_X = 571;
const WORD_Y = (CANVAS_H - WORDMARK_HEIGHT * TEXT_SCALE) / 2;

export const EgycashLogo = ({
  tone = 'auto',
  className,
}: {
  tone?: Tone;
  /** Set the height (e.g. `h-10`); the width follows. */
  className?: string;
}): JSX.Element => {
  const c = COLOUR[tone];
  return (
    <svg
      viewBox={`0 0 ${String(CANVAS_W)} ${String(CANVAS_H)}`}
      role="img"
      aria-label="EGYCASH"
      className={cn('aspect-[2000/669] w-auto shrink-0', className)}
    >
      <g transform={`scale(${MARK_SCALE.toFixed(4)})`}>
        <path className={c.ribbon} d={MARK_RIBBON_PATH} />
        <path className={c.band} d={MARK_BAND_PATH} />
      </g>
      <path
        className={c.text}
        fillRule="evenodd"
        transform={`translate(${String(WORD_X)} ${WORD_Y.toFixed(1)}) scale(${String(TEXT_SCALE)})`}
        d={WORDMARK_PATH}
      />
    </svg>
  );
};
