// The ECMS identity mark, in one place. Every surface that shows the product logo — the shell
// topbar, the login screen, future places — renders this so the mark never drifts. `brand` is the
// gradient tile for light chrome; `onBrand` is a frosted-glass tile for use on the brand gradient
// itself (the login panel), where a gradient tile would disappear.
import { cn } from '../lib/cn';

type BrandSize = 'sm' | 'md' | 'lg';
type BrandVariant = 'brand' | 'onBrand';

const TILE: Record<BrandSize, string> = {
  sm: 'h-8 w-8 rounded-lg text-sm',
  md: 'h-10 w-10 rounded-xl text-base',
  lg: 'h-12 w-12 rounded-2xl text-xl',
};

const VARIANT: Record<BrandVariant, string> = {
  brand: 'bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm',
  onBrand: 'bg-white/15 text-white ring-1 ring-inset ring-white/25 backdrop-blur-sm',
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
  <span
    aria-hidden="true"
    className={cn('grid shrink-0 place-items-center font-bold', TILE[size], VARIANT[variant], className)}
  >
    E
  </span>
);
