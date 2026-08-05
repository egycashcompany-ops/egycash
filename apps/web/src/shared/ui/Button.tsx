// Button primitive: variants, sizes, and a loading state (spinner + disabled). Every feature
// button goes through this so styling and focus behaviour stay consistent.
import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Spinner } from './Spinner';

// The three `ghost-*` tones exist for INLINE ROW ACTIONS, where a row carries several controls and
// the colour is what tells them apart at a glance — publish reads as the constructive one, withdraw
// as the destructive one, without any of them shouting like a filled button would.
//
// They are variants rather than a class passed by the caller because `cn` is a plain joiner: a
// `text-red-600` handed in alongside ghost's own `text-slate-600` leaves the winner to stylesheet
// order, which is not something a call site can see or rely on. A variant has one colour, decided
// here.
type Variant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'ghost-brand'
  | 'ghost-warning'
  | 'ghost-danger';
type Size = 'sm' | 'md' | 'icon';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-400',
  secondary:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
  ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-400',
  'ghost-brand': 'text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950',
  'ghost-warning': 'text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950',
  'ghost-danger': 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  /** Square, for a button whose whole content is one icon — give it an `aria-label`. */
  icon: 'h-8 w-8 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
}

export const Button = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  leftIcon,
  className,
  children,
  disabled,
  type,
  ...rest
}: ButtonProps): JSX.Element => (
  <button
    type={type ?? 'button'}
    disabled={disabled === true || loading}
    className={cn(
      'inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70',
      VARIANT[variant],
      SIZE[size],
      className,
    )}
    {...rest}
  >
    {loading ? <Spinner className="h-4 w-4" /> : leftIcon}
    {children}
  </button>
);
