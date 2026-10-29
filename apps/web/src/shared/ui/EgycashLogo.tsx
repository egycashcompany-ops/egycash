// The full EGYCASH logo — the mark, the wordmark and, where there is room, the tagline — laid out as
// the company's horizontal logo lays them out: the same proportions, the same gaps, measured off the
// supplied artwork. Use it where the company's NAME belongs (the customer and applicant portals,
// which speak for EGYCASH rather than for the ECMS product); where only the mark belongs, use
// `BrandMark`.
//
// Unlike `BrandMark` this one carries the name, so it is announced to assistive technology as an
// image labelled «EGYCASH» rather than hidden.
//
// `tone="auto"` follows the theme: the artwork's purples and navy on light surfaces, lifted tones
// and white lettering in dark mode. `tone="white"` is the reversed logo for a dark or brand panel
// that stays dark in both themes.
import { cn } from '../lib/cn';
import { MARK_BAND_PATH, MARK_HEIGHT, MARK_RIBBON_PATH } from './brand-mark-paths';
import { TAGLINE_PATH, WORDMARK_HEIGHT, WORDMARK_PATH } from './egycash-wordmark-paths';

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

// Geometry of the supplied horizontal logo, on its own 2000-unit-wide canvas.
const CANVAS_W = 2000;
const MARK_H = 669;
const MARK_SCALE = MARK_H / MARK_HEIGHT;
const TEXT_SCALE = 0.8508;
const WORD_X = 571;

export const EgycashLogo = ({
  tone = 'auto',
  tagline = true,
  className,
}: {
  tone?: Tone;
  /** The tagline is 6% of the logo's height; drop it wherever the logo is drawn small. */
  tagline?: boolean;
  /** Set the height (e.g. `h-10`); the width follows. */
  className?: string;
}): JSX.Element => {
  const c = COLOUR[tone];
  // Without the tagline the wordmark is centred on the mark instead of sitting above the tagline.
  const canvasH = tagline ? 672 : MARK_H;
  const wordY = tagline ? 138 : (MARK_H - WORDMARK_HEIGHT * TEXT_SCALE) / 2;
  return (
    <svg
      viewBox={`0 0 ${String(CANVAS_W)} ${String(canvasH)}`}
      role="img"
      aria-label="EGYCASH"
      className={cn(
        'w-auto shrink-0',
        tagline ? 'aspect-[2000/672]' : 'aspect-[2000/669]',
        className,
      )}
    >
      <g transform={`translate(${tagline ? '1 1' : '0 0'}) scale(${MARK_SCALE.toFixed(4)})`}>
        <path className={c.ribbon} d={MARK_RIBBON_PATH} />
        <path className={c.band} d={MARK_BAND_PATH} />
      </g>
      <path
        className={c.text}
        fillRule="evenodd"
        transform={`translate(${String(WORD_X)} ${wordY.toFixed(1)}) scale(${String(TEXT_SCALE)})`}
        d={WORDMARK_PATH}
      />
      {tagline && (
        <path
          className={c.text}
          fillRule="evenodd"
          transform={`translate(577 460) scale(${String(TEXT_SCALE)})`}
          d={TAGLINE_PATH}
        />
      )}
    </svg>
  );
};
