// The EGYCASH mark, in one place. Every surface that shows the product logo — the shell topbar, the
// sign-in screens, the public pages — renders this so the mark never drifts.
//
// It is the company's own artwork (the two folded ribbons), drawn inline rather than loaded as an
// image so it needs no request, survives a subpath deployment unchanged, and can follow the theme.
// The size keeps the HEIGHT the old letter tile had, so nothing laid out around it moves; the mark is
// taller than it is wide, so it takes a little less width than the tile did.
//
// `brand` is for ordinary chrome. It paints the artwork's own two purples on a light surface, and in
// dark mode the same hues lifted — the original darker tone sits at about 2:1 against slate-900,
// which is a mark that is technically there and practically not. `onBrand` is the reversed mark for
// the brand gradient itself (the sign-in panel), where any purple would disappear: the bands white,
// the ribbons white at 72%, so the fold still reads with the band in front, as it does in the logo.
// `muted` is the watermark: one faint tone, for an empty frame waiting for a photograph.
import { cn } from '../lib/cn';
import { MARK_BAND_PATH, MARK_HEIGHT, MARK_RIBBON_PATH, MARK_WIDTH } from './brand-mark-paths';

type BrandSize = 'sm' | 'md' | 'lg' | 'fill';
type BrandVariant = 'brand' | 'onBrand' | 'muted';

const HEIGHT: Record<BrandSize, string> = {
  sm: 'h-8',
  md: 'h-10',
  lg: 'h-12',
  // No height of its own: the caller sizes it. For a mark that fills a frame rather than sitting
  // in a row of chrome — `cn` is a plain joiner with no conflict resolution, so a caller's own
  // height would otherwise sit beside `h-10` and the winner would be whichever Tailwind emitted
  // last, not whichever the caller meant.
  fill: '',
};

const RIBBON: Record<BrandVariant, string> = {
  brand: 'fill-[#3e4097] dark:fill-[#8c90e0]',
  onBrand: 'fill-white/[0.72]',
  muted: 'fill-slate-300 dark:fill-white/[0.09]',
};

const BAND: Record<BrandVariant, string> = {
  brand: 'fill-[#5d60a9] dark:fill-[#b5b8ec]',
  onBrand: 'fill-white',
  // One tone, not two: as a watermark behind an empty photo frame the fold should read as a
  // single faint shape, and at 9% on dark the two-tone fold is just noise.
  muted: 'fill-slate-300 dark:fill-white/[0.09]',
};

export const BrandMark = ({
  size = 'md',
  variant = 'brand',
  className,
}: {
  size?: BrandSize;
  variant?: BrandVariant;
  className?: string;
}): JSX.Element => (
  // Decorative: every place that shows the mark names the product in text beside it.
  <svg
    viewBox={`0 0 ${String(MARK_WIDTH)} ${String(MARK_HEIGHT)}`}
    aria-hidden="true"
    focusable="false"
    className={cn('aspect-[558/789] w-auto shrink-0', HEIGHT[size], className)}
  >
    <path className={RIBBON[variant]} d={MARK_RIBBON_PATH} />
    <path className={BAND[variant]} d={MARK_BAND_PATH} />
  </svg>
);
