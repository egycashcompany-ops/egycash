// A fixed-size image tile: a person's photo, a platform's logo, an organization's mark.
//
// The point is the BOX, not the picture. Every avatar in a list is the same square whether its
// image is a tall SVG, a wide PNG, or missing entirely — so a column of them lines up and a row's
// height never depends on what someone uploaded. `object-contain` is what keeps a non-square logo
// whole instead of cropping it to fit.
import { type ReactNode } from 'react';
import { cn } from '../lib/cn';

const SIZES = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
} as const;

export const Avatar = ({
  src,
  alt,
  fallback,
  size = 'sm',
  shape = 'rounded',
  className,
}: {
  /** `null` renders the fallback — a missing image is a normal state, not an error. */
  src?: string | null;
  alt: string;
  /** Shown when there is no image: a glyph or initials. */
  fallback: ReactNode;
  size?: keyof typeof SIZES;
  /** `circle` for people, `rounded` for things — a squared-off logo reads as a logo. */
  shape?: 'circle' | 'rounded';
  className?: string;
}): JSX.Element => (
  <span
    className={cn(
      SIZES[size],
      shape === 'circle' ? 'rounded-full' : 'rounded-lg',
      'grid shrink-0 place-items-center overflow-hidden border border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-800',
      className,
    )}
  >
    {src === null || src === undefined ? (
      fallback
    ) : (
      <img src={src} alt={alt} className="h-full w-full object-contain" loading="lazy" />
    )}
  </span>
);
